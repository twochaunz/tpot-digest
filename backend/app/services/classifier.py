"""Full classification pipeline: embed -> grok -> pgvector -> claude -> store."""

from __future__ import annotations

import asyncio
import logging
from collections import Counter
from datetime import date, timedelta

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

import app.db as db_module
from app.models.assignment import TweetAssignment
from app.models.topic import Topic
from app.models.tweet import Tweet
from app.services.claude_api import TopicCandidate, classify_tweet, recategorize_topic

logger = logging.getLogger(__name__)


def _build_category_summary(assignments: list[TweetAssignment]) -> str:
    """Build a concise summary like '3 context, 2 pushback, 1 kek'."""
    counts = Counter(a.category for a in assignments if a.category)
    if not counts:
        return "no categorized tweets"
    return ", ".join(f"{v} {k}" for k, v in counts.most_common())


async def classify_pipeline(tweet_id: int) -> None:
    """Run the full classification pipeline for a tweet.

    Steps:
    1. Embed tweet text (local, ~10ms)
    2. Fetch Grok context (parallel, ~3-5s) + pgvector similarity search (~5ms)
    3. Claude classification (~1-2s)
    4. Store suggestion on tweet
    """
    async with db_module.async_session() as db:
        tweet = await db.get(Tweet, tweet_id)
        if not tweet or not tweet.text:
            logger.info("Tweet %d has no text yet, skipping classification", tweet_id)
            return

        # Step 1: Embed tweet text
        from app.services.embeddings import embed_text
        tweet_embedding = embed_text(tweet.text)
        tweet.embedding = tweet_embedding
        await db.commit()

        # Step 2: Grok context + pgvector search in parallel
        grok_task = _fetch_grok_safe(tweet)
        candidates_task = _find_candidate_topics(db, tweet_embedding)

        grok_context, candidates = await asyncio.gather(grok_task, candidates_task)

        # Store grok context if fetched
        if grok_context and not tweet.grok_context:
            tweet.grok_context = grok_context
            await db.commit()

        # Step 3: Claude classification
        try:
            result = await classify_tweet(
                tweet_text=tweet.text,
                grok_context=grok_context or tweet.grok_context,
                candidates=candidates,
            )
        except Exception as e:
            logger.error("Claude classification failed for tweet %d: %s", tweet_id, e)
            return

        # Step 4: Store suggestion
        tweet.ai_topic_id = result.get("topic_id")
        tweet.ai_category = result.get("category")
        tweet.ai_new_topic_title = result.get("new_topic_title")
        tweet.ai_related_topic_id = result.get("related_topic_id")
        await db.commit()

        logger.info(
            "Tweet %d classified: topic=%s category=%s confidence=%.2f",
            tweet_id,
            result.get("topic_id") or result.get("new_topic_title"),
            result.get("category"),
            result.get("confidence", 0),
        )


async def _fetch_grok_safe(tweet: Tweet) -> str | None:
    """Fetch Grok context, return None on failure."""
    from app.services.grok_api import GrokAPIError, fetch_grok_context

    if tweet.grok_context:
        return tweet.grok_context
    if not tweet.url:
        return None
    try:
        return await fetch_grok_context(tweet.url)
    except GrokAPIError as e:
        logger.warning("Grok fetch failed for tweet %d: %s", tweet.id, e)
        return None


async def _find_candidate_topics(
    db: AsyncSession,
    tweet_embedding: list[float],
    lookback_days: int = 3,
    limit: int = 5,
    min_similarity: float = 0.3,
) -> list[TopicCandidate]:
    """Find candidate topics using pgvector similarity search."""
    cutoff_date = date.today() - timedelta(days=lookback_days)

    # pgvector cosine distance: <=> operator, similarity = 1 - distance
    # Use CAST() instead of :: to avoid SQLAlchemy bind-param conflict
    rows = (await db.execute(
        text("""
            SELECT t.id, t.title, t.date::text, t.og_tweet_id,
                   1 - (t.embedding <=> CAST(:vec AS vector)) as similarity
            FROM topics t
            WHERE t.embedding IS NOT NULL
              AND t.date >= :cutoff
            ORDER BY t.embedding <=> CAST(:vec AS vector)
            LIMIT :lim
        """),
        {"vec": str(tweet_embedding), "cutoff": cutoff_date, "lim": limit},
    )).all()

    candidates = []
    for row in rows:
        if row.similarity < min_similarity:
            continue

        # Fetch OG tweet text + grok context
        og_text = ""
        og_grok = None
        if row.og_tweet_id:
            og_tweet = await db.get(Tweet, row.og_tweet_id)
            if og_tweet:
                og_text = og_tweet.text or ""
                og_grok = og_tweet.grok_context

        # Build category summary from assignments
        assignments = (await db.execute(
            select(TweetAssignment).where(TweetAssignment.topic_id == row.id)
        )).scalars().all()

        candidates.append(TopicCandidate(
            topic_id=row.id,
            title=row.title,
            date=row.date,
            og_text=og_text,
            og_grok_context=og_grok,
            category_summary=_build_category_summary(assignments),
            similarity=row.similarity,
        ))

    return candidates


async def recategorize_topic_tweets(topic_id: int) -> None:
    """Re-categorize all tweets in a topic relative to the OG post.

    Skips tweets with ai_override=True.
    """
    async with db_module.async_session() as db:
        topic = await db.get(Topic, topic_id)
        if not topic or not topic.og_tweet_id:
            return

        og_tweet = await db.get(Tweet, topic.og_tweet_id)
        if not og_tweet:
            return

        # Get all assignments for this topic
        assignments = (await db.execute(
            select(TweetAssignment).where(TweetAssignment.topic_id == topic_id)
        )).scalars().all()

        # Load tweets, skip OG and overridden
        tweets_to_categorize = []
        assignment_map: dict[int, TweetAssignment] = {}
        for a in assignments:
            if a.tweet_id == topic.og_tweet_id:
                continue
            tweet = await db.get(Tweet, a.tweet_id)
            if not tweet or tweet.ai_override:
                continue
            tweets_to_categorize.append({
                "id": tweet.id,
                "text": tweet.text or "",
                "grok_context": tweet.grok_context,
            })
            assignment_map[tweet.id] = a

        if not tweets_to_categorize:
            return

        try:
            new_categories = await recategorize_topic(
                og_text=og_tweet.text or "",
                og_grok_context=og_tweet.grok_context,
                tweets=tweets_to_categorize,
            )
        except Exception as e:
            logger.error("Recategorization failed for topic %d: %s", topic_id, e)
            return

        # Update assignments
        for tweet_id, category in new_categories.items():
            if tweet_id in assignment_map:
                assignment_map[tweet_id].category = category

        await db.commit()
        logger.info("Recategorized %d tweets in topic %d", len(new_categories), topic_id)
