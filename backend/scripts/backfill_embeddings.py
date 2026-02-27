"""One-time: generate embeddings for all existing topics with OG posts."""

import asyncio

from sqlalchemy import select

from app.db import async_session
from app.models.topic import Topic
from app.models.tweet import Tweet
from app.services.embeddings import embed_text


async def main():
    async with async_session() as db:
        topics = (
            await db.execute(select(Topic).where(Topic.og_tweet_id.isnot(None)))
        ).scalars().all()

        print(f"Found {len(topics)} topics with OG posts")
        for topic in topics:
            if topic.embedding is not None:
                print(f"  {topic.title}: already embedded, skipping")
                continue
            og = await db.get(Tweet, topic.og_tweet_id)
            if not og:
                print(f"  {topic.title}: OG tweet not found, skipping")
                continue
            source = f"{topic.title} {og.text or ''} {og.grok_context or ''}"
            topic.embedding = embed_text(source)
            print(f"  {topic.title}: embedded")
        await db.commit()
        print("Done")


asyncio.run(main())
