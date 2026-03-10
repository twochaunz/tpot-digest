"""Classification services: embed, fetch Grok, categorize tweets in topics."""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.db as db_module
from app.models.assignment import TweetAssignment
from app.models.topic import Topic
from app.models.tweet import Tweet
from app.services.claude_api import categorize_single_tweet

logger = logging.getLogger(__name__)


async def prepare_tweet(tweet_id: int) -> None:
    """Embed tweet text and fetch Grok context. Run as background task on save."""
    async with db_module.async_session() as db:
        tweet = await db.get(Tweet, tweet_id)
        if not tweet or not tweet.text:
            return

        # Embed tweet text
        from app.services.embeddings import embed_text
        if not tweet.embedding:
            tweet.embedding = embed_text(tweet.text)
            await db.commit()

        # Grok context is only fetched when a tweet is set as OG for a topic
        # (see topics.py update_topic), not on every save.
        # if not tweet.grok_context and tweet.url:
        #     grok_context = await _fetch_grok_safe(tweet)
        #     if grok_context:
        #         tweet.grok_context = grok_context
        #         await db.commit()


async def categorize_assigned_tweet(tweet_id: int, topic_id: int) -> None:
    """Auto-categorize a tweet that was assigned to a topic without explicit category.

    Uses Claude to determine the category based on the topic's OG post.
    """
    async with db_module.async_session() as db:
        topic = await db.get(Topic, topic_id)
        if not topic or not topic.og_tweet_id:
            return

        og_tweet = await db.get(Tweet, topic.og_tweet_id)
        if not og_tweet:
            return

        tweet = await db.get(Tweet, tweet_id)
        if not tweet or not tweet.text or tweet.ai_override:
            return

        # Skip if this tweet IS the OG tweet
        if tweet_id == topic.og_tweet_id:
            return

        # Categorize using Claude
        from app.services.claude_api import categorize_single_tweet
        try:
            category = await categorize_single_tweet(
                topic_title=topic.title,
                og_text=og_tweet.text or "",
                og_grok_context=og_tweet.grok_context,
                tweet_text=tweet.text,
                tweet_grok_context=tweet.grok_context,
            )
        except Exception as e:
            logger.error("Category classification failed for tweet %d: %s", tweet_id, e)
            return

        # Update the assignment
        assignment = (await db.execute(
            select(TweetAssignment).where(
                TweetAssignment.tweet_id == tweet_id,
                TweetAssignment.topic_id == topic_id,
            )
        )).scalar_one_or_none()
        if assignment:
            assignment.category = category
            await db.commit()
            logger.info("Tweet %d categorized as '%s' in topic %d", tweet_id, category, topic_id)


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

        # Categorize each tweet individually for accuracy
        # (batch classification loses nuance and misclassifies)
        count = 0
        for t in tweets_to_categorize:
            try:
                category = await categorize_single_tweet(
                    topic_title=topic.title,
                    og_text=og_tweet.text or "",
                    og_grok_context=og_tweet.grok_context,
                    tweet_text=t["text"],
                    tweet_grok_context=t.get("grok_context"),
                )
                if t["id"] in assignment_map:
                    assignment_map[t["id"]].category = category
                    count += 1
            except Exception as e:
                logger.warning("Recategorization failed for tweet %d: %s", t["id"], e)

        await db.commit()
        logger.info("Recategorized %d tweets in topic %d", count, topic_id)


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
