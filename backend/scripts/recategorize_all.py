"""Rename signal-boost -> echo and re-categorize all topics."""
import asyncio
import app.db as db_module
from sqlalchemy import text
from app.services.classifier import recategorize_topic_tweets


async def main():
    # Rename existing signal-boost to echo
    async with db_module.async_session() as db:
        result = await db.execute(
            text("UPDATE tweet_assignments SET category = 'echo' WHERE category = 'signal-boost'")
        )
        await db.commit()
        print(f"Updated signal-boost -> echo: {result.rowcount} rows")

    # Re-categorize all topics with OG tweets
    async with db_module.async_session() as db:
        topics = (await db.execute(
            text("SELECT id, title FROM topics WHERE og_tweet_id IS NOT NULL")
        )).all()
        print(f"Topics to re-categorize: {len(topics)}")

    for t in topics:
        print(f"  Re-categorizing: {t.title}")
        try:
            await recategorize_topic_tweets(t.id)
        except Exception as e:
            print(f"    Failed: {e}")

    print("Done!")


asyncio.run(main())
