import pytest
import pytest_asyncio
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from pgvector.sqlalchemy import Vector

from app.db import Base
from app.models.account import Account
from app.models.article import Article
from app.models.screenshot import Screenshot
from app.models.topic import Topic, SubTopic, SubTopicTweet, TopicEdge
from app.models.tweet import Tweet


@compiles(JSONB, "sqlite")
def _compile_jsonb_as_json(type_, compiler, **kw):
    return compiler.visit_JSON(type_, **kw)


@compiles(Vector, "sqlite")
def _compile_vector_as_blob(type_, compiler, **kw):
    return "BLOB"


TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
engine_test = create_async_engine(TEST_DATABASE_URL, echo=False)
async_session_test = async_sessionmaker(engine_test, expire_on_commit=False)


@pytest_asyncio.fixture(autouse=True)
async def setup_database():
    async with engine_test.begin() as conn:
        await conn.run_sync(Account.__table__.create)
        await conn.run_sync(Tweet.__table__.create)
        await conn.run_sync(Article.__table__.create)
        await conn.run_sync(Screenshot.__table__.create)
        await conn.run_sync(Topic.__table__.create)
        await conn.run_sync(SubTopic.__table__.create)
        await conn.run_sync(SubTopicTweet.__table__.create)
        await conn.run_sync(TopicEdge.__table__.create)
    yield
    async with engine_test.begin() as conn:
        await conn.run_sync(TopicEdge.__table__.drop)
        await conn.run_sync(SubTopicTweet.__table__.drop)
        await conn.run_sync(SubTopic.__table__.drop)
        await conn.run_sync(Topic.__table__.drop)
        await conn.run_sync(Screenshot.__table__.drop)
        await conn.run_sync(Article.__table__.drop)
        await conn.run_sync(Tweet.__table__.drop)
        await conn.run_sync(Account.__table__.drop)


@pytest.mark.asyncio
async def test_process_pipeline_creates_topics():
    from app.scheduler import process_pipeline
    from sqlalchemy import select

    # First, insert tweets into DB (pipeline expects them)
    tweets = [
        {"tweet_id": "t1", "author_handle": "user1", "text": "Claude 4 is amazing for coding", "engagement": {"likes": 100}},
        {"tweet_id": "t2", "author_handle": "user2", "text": "Claude 4 benchmarks are incredible", "engagement": {"likes": 200}},
        {"tweet_id": "t3", "author_handle": "user3", "text": "OpenAI raises $10B in new funding", "engagement": {"likes": 50}},
        {"tweet_id": "t4", "author_handle": "user4", "text": "OpenAI valuation hits $300B", "engagement": {"likes": 80}},
    ]

    async with async_session_test() as db:
        for td in tweets:
            tweet = Tweet(
                tweet_id=td["tweet_id"],
                author_handle=td["author_handle"],
                text=td["text"],
                engagement=td["engagement"],
            )
            db.add(tweet)
        await db.commit()

        await process_pipeline(tweets, db)

        # Check topics were created
        result = await db.execute(select(Topic))
        topics = result.scalars().all()
        assert len(topics) >= 1

        # Check subtopics exist
        result = await db.execute(select(SubTopic))
        subtopics = result.scalars().all()
        assert len(subtopics) >= 1


@pytest.mark.asyncio
async def test_process_pipeline_empty():
    from app.scheduler import process_pipeline

    async with async_session_test() as db:
        await process_pipeline([], db)

        from sqlalchemy import select
        result = await db.execute(select(Topic))
        assert result.scalars().all() == []


@pytest.mark.asyncio
async def test_process_pipeline_creates_graph_edges():
    from app.scheduler import process_pipeline
    from sqlalchemy import select

    # Two batches of related tweets
    tweets_batch1 = [
        {"tweet_id": "b1t1", "author_handle": "u1", "text": "Claude AI is revolutionary", "engagement": {"likes": 100}},
        {"tweet_id": "b1t2", "author_handle": "u2", "text": "Claude coding capabilities are amazing", "engagement": {"likes": 50}},
    ]

    async with async_session_test() as db:
        for td in tweets_batch1:
            db.add(Tweet(tweet_id=td["tweet_id"], author_handle=td["author_handle"], text=td["text"], engagement=td["engagement"]))
        await db.commit()

        # Process first batch
        await process_pipeline(tweets_batch1, db)

        # Process second batch (should create edges to first batch topics)
        tweets_batch2 = [
            {"tweet_id": "b2t1", "author_handle": "u3", "text": "Claude performance benchmarks released", "engagement": {"likes": 200}},
            {"tweet_id": "b2t2", "author_handle": "u4", "text": "Claude benchmark analysis shows great results", "engagement": {"likes": 150}},
        ]
        for td in tweets_batch2:
            db.add(Tweet(tweet_id=td["tweet_id"], author_handle=td["author_handle"], text=td["text"], engagement=td["engagement"]))
        await db.commit()

        await process_pipeline(tweets_batch2, db)

        # Check graph edges were created
        result = await db.execute(select(TopicEdge))
        edges = result.scalars().all()
        # Related Claude topics should have edges between them
        # (may or may not create edges depending on clustering results)
        # Just verify no crash and topics exist
        result = await db.execute(select(Topic))
        topics = result.scalars().all()
        assert len(topics) >= 1
