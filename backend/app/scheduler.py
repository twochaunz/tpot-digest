from apscheduler.schedulers.asyncio import AsyncIOScheduler
from app.config import settings

scheduler = AsyncIOScheduler()


async def scrape_job():
    """
    Scheduled job: scrape both feeds, filter, and store tweets to DB.
    This is the orchestration function that ties together the scraper and pipeline.
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
            print("Twitter session expired. Please re-authenticate.")
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

        # Store to database (upsert: skip if tweet_id already exists)
        async with async_session() as db:
            for tweet_data in filtered:
                existing = await db.execute(
                    select(Tweet).where(Tweet.tweet_id == tweet_data["tweet_id"])
                )
                if existing.scalar_one_or_none():
                    continue  # Skip duplicates

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

        print(f"Scrape complete: {len(filtered)} tweets stored from {len(all_tweets)} scraped")

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
