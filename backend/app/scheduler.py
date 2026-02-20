import logging
from datetime import date

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


async def process_pipeline(tweets: list[dict], db: AsyncSession):
    """
    Process filtered tweets through the full pipeline:
    cluster → sub-cluster → store topics → filesystem → screenshots → articles → graph edges.
    """
    from app.models.topic import Topic, SubTopic, SubTopicTweet, TopicEdge
    from app.models.tweet import Tweet
    from app.models.article import Article
    from app.pipeline.clustering import cluster_with_fallback, identify_subtopics
    from app.pipeline.lifecycle import update_topic_lifecycle
    from app.pipeline.graph import find_related_topics
    from app.storage import write_topic_metadata, write_subtopic_metadata
    from app.scraper.article import detect_article_urls, fetch_article

    today = date.today()

    if not tweets:
        logger.info("No tweets to process")
        return

    # Step 1: Cluster tweets into topics
    topic_clusters = await cluster_with_fallback(tweets)
    logger.info(f"Clustered {len(tweets)} tweets into {len(topic_clusters)} topics")

    # Track created topics for graph edge computation
    created_topics: list[dict] = []

    for rank, cluster in enumerate(topic_clusters, start=1):
        title = cluster.get("title", "Untitled")
        summary = cluster.get("summary", "")
        sentiment = cluster.get("sentiment", "neutral")
        tags = cluster.get("tags", [])
        tweet_indices = cluster.get("tweet_indices", [])

        # Create Topic in DB
        topic = Topic(
            date=today,
            title=title,
            summary=summary,
            rank=rank,
            sentiment=sentiment,
            tags={"tags": tags} if tags else None,
        )
        db.add(topic)
        await db.flush()  # Get topic.id

        # Get the actual tweet dicts for this topic
        topic_tweets = [tweets[i] for i in tweet_indices if i < len(tweets)]

        # Step 2: Identify sub-topics within this topic
        subtopic_clusters = await identify_subtopics(title, topic_tweets)
        logger.info(f"  Topic '{title}': {len(subtopic_clusters)} sub-topics")

        for st_rank, st_cluster in enumerate(subtopic_clusters, start=1):
            st_title = st_cluster.get("title", "General")
            st_summary = st_cluster.get("summary", "")
            st_sentiment = st_cluster.get("sentiment", "neutral")
            st_tweet_indices = st_cluster.get("tweet_indices", [])

            # Create SubTopic in DB
            subtopic = SubTopic(
                topic_id=topic.id,
                title=st_title,
                summary=st_summary,
                sentiment=st_sentiment,
                rank=st_rank,
            )
            db.add(subtopic)
            await db.flush()

            # Link tweets to this subtopic
            subtopic_tweets_data = []
            for ti in st_tweet_indices:
                if ti < len(topic_tweets):
                    tweet_data = topic_tweets[ti]
                    # Find the Tweet record in DB
                    tweet_id = tweet_data.get("tweet_id")
                    if tweet_id:
                        result = await db.execute(
                            select(Tweet).where(Tweet.tweet_id == tweet_id)
                        )
                        tweet_record = result.scalar_one_or_none()
                        if tweet_record:
                            link = SubTopicTweet(
                                subtopic_id=subtopic.id,
                                tweet_id=tweet_record.id,
                                relevance_score=st_cluster.get("relevance_score", 0.5),
                                stance=st_cluster.get("stance"),
                            )
                            db.add(link)
                            subtopic_tweets_data.append(tweet_data)

            # Write subtopic filesystem metadata
            try:
                write_subtopic_metadata(
                    d=today,
                    topic_title=title,
                    topic_rank=rank,
                    subtopic_title=st_title,
                    subtopic_rank=st_rank,
                    summary=st_summary,
                    sentiment=st_sentiment,
                    tweets=subtopic_tweets_data,
                )
            except Exception as e:
                logger.warning(f"Failed to write subtopic metadata: {e}")

        # Write topic filesystem metadata
        try:
            write_topic_metadata(
                d=today,
                topic_title=title,
                topic_rank=rank,
                summary=summary,
                subtopics=subtopic_clusters,
                lifecycle_status="emerging",
                sentiment=sentiment,
                tags=tags,
            )
        except Exception as e:
            logger.warning(f"Failed to write topic metadata: {e}")

        # Track for graph edges
        created_topics.append({
            "id": topic.id,
            "title": title,
            "summary": summary,
            "embedding": None,  # Embeddings computed separately
            "tags": tags,
        })

        # Step 3: Extract articles from tweet URLs
        for tweet_data in topic_tweets:
            article_urls = list(tweet_data.get("article_urls") or [])
            text = tweet_data.get("text", "")
            article_urls.extend(detect_article_urls(text))

            for article_url in set(article_urls):  # Deduplicate
                # Check if article already exists
                existing = await db.execute(
                    select(Article).where(Article.url == article_url)
                )
                if existing.scalar_one_or_none():
                    continue

                try:
                    article_data = await fetch_article(article_url)
                    if article_data.get("success"):
                        article = Article(
                            url=article_url,
                            archive_url=article_data.get("archive_url"),
                            title=article_data.get("title"),
                            author=article_data.get("author"),
                            publication=article_data.get("publication"),
                            full_text=article_data.get("full_text"),
                        )
                        db.add(article)
                except Exception as e:
                    logger.warning(f"Failed to fetch article {article_url}: {e}")

    # Step 4: Update topic lifecycle for all today's topics
    try:
        result = await db.execute(
            select(Topic).where(Topic.date == today)
        )
        todays_topics = result.scalars().all()
        for t in todays_topics:
            await update_topic_lifecycle(db, t.id)
    except Exception as e:
        logger.warning(f"Failed to update topic lifecycle: {e}")

    # Step 5: Compute graph edges between new and existing topics
    if created_topics:
        # Get all existing topics for graph comparison
        result = await db.execute(select(Topic))
        all_topics_records = result.scalars().all()
        all_topics_for_graph = [
            {
                "id": t.id,
                "title": t.title,
                "summary": t.summary or "",
                "embedding": None,
                "tags": list(t.tags.get("tags", [])) if t.tags else [],
            }
            for t in all_topics_records
        ]

        for new_topic in created_topics:
            # Exclude self from candidates
            candidates = [t for t in all_topics_for_graph if t["id"] != new_topic["id"]]
            related = find_related_topics(
                new_topic["title"],
                new_topic.get("summary", ""),
                new_topic.get("embedding"),
                candidates,
                threshold=0.3,
            )
            for rel in related:
                edge = TopicEdge(
                    source_topic_id=new_topic["id"],
                    target_topic_id=rel["target_topic_id"],
                    relationship_type=rel["relationship_type"],
                    strength=rel["strength"],
                )
                db.add(edge)

    await db.commit()
    logger.info(f"Pipeline complete: {len(topic_clusters)} topics, {len(created_topics)} with graph edges")


async def scrape_job():
    """
    Scheduled job: scrape both feeds, filter, and process through full pipeline.
    """
    from app.scraper.browser import get_browser_context, check_session_valid
    from app.scraper.feed import scrape_feed
    from app.pipeline.quality import filter_tweets
    from app.db import async_session
    from app.models.tweet import Tweet
    from app.models.account import Account
    from sqlalchemy import select

    # Get browser context
    context = await get_browser_context()

    try:
        # Check if session is valid
        if not await check_session_valid(context):
            logger.warning("Twitter session expired. Please re-authenticate.")
            return

        # Get seed handles and filter lists from DB
        async with async_session() as db:
            result = await db.execute(select(Account))
            accounts = result.scalars().all()

        seed_handles = {a.handle for a in accounts if a.is_active}
        blocked = {a.handle for a in accounts if a.is_blocked}
        boosted = {a.handle for a in accounts if a.is_boosted}

        # Scrape both feeds
        all_tweets = []
        for feed_type in ["for_you", "following"]:
            tweets = await scrape_feed(context, feed_type, max_scrolls=settings.scrape_max_scrolls)
            all_tweets.extend(tweets)

        # Filter through quality pipeline
        filtered = await filter_tweets(all_tweets, seed_handles, blocked, boosted)

        # Store tweets to DB first
        async with async_session() as db:
            for tweet_data in filtered:
                existing = await db.execute(
                    select(Tweet).where(Tweet.tweet_id == tweet_data["tweet_id"])
                )
                if existing.scalar_one_or_none():
                    continue

                tweet = Tweet(
                    tweet_id=tweet_data["tweet_id"],
                    author_handle=tweet_data["author_handle"],
                    text=tweet_data["text"],
                    media_urls=tweet_data.get("media_urls"),
                    article_urls=tweet_data.get("article_urls"),
                    engagement=tweet_data.get("engagement"),
                    engagement_velocity=None,
                    is_retweet=tweet_data.get("is_retweet", False),
                    is_quote_tweet=tweet_data.get("is_quote_tweet", False),
                    quoted_tweet_id=tweet_data.get("quoted_tweet_id"),
                    quality_score=tweet_data.get("quality_score"),
                    feed_source=tweet_data.get("feed_source"),
                )
                db.add(tweet)
            await db.commit()

            # Now process through the full pipeline
            await process_pipeline(filtered, db)

        logger.info(f"Scrape complete: {len(filtered)} tweets stored from {len(all_tweets)} scraped")

    finally:
        await context.close()


def start_scheduler():
    """Start the APScheduler with the scrape job."""
    scheduler.add_job(
        scrape_job,
        "interval",
        hours=settings.scrape_interval_hours,
        id="scrape_feed",
        replace_existing=True,
    )
    scheduler.start()


def stop_scheduler():
    """Stop the scheduler."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
