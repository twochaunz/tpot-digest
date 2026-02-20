import pytest
import pytest_asyncio
from datetime import date, datetime, timezone
from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles

from app.db import Base
from app.models.tweet import Tweet
from app.models.topic import Topic
from app.models.category import Category
from app.models.assignment import TweetAssignment


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):
    return compiler.visit_JSON(type_, **kw)


TEST_DB_URL = "sqlite+aiosqlite:///:memory:"
engine = create_async_engine(TEST_DB_URL, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)


@pytest_asyncio.fixture(autouse=True)
async def db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as session:
        yield session
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.mark.asyncio
async def test_create_tweet(db):
    tweet = Tweet(
        tweet_id="123456",
        author_handle="karpathy",
        author_display_name="Andrej Karpathy",
        text="Hello world",
        feed_source="for_you",
    )
    db.add(tweet)
    await db.commit()
    await db.refresh(tweet)
    assert tweet.id is not None
    assert tweet.tweet_id == "123456"
    assert tweet.saved_at is not None


@pytest.mark.asyncio
async def test_create_topic(db):
    topic = Topic(title="Claude 4 Launch", date=date(2026, 2, 20), color="#E8A838")
    db.add(topic)
    await db.commit()
    await db.refresh(topic)
    assert topic.id is not None
    assert topic.position == 0


@pytest.mark.asyncio
async def test_create_category(db):
    cat = Category(name="commentary", color="#4ECDC4")
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    assert cat.id is not None


@pytest.mark.asyncio
async def test_assign_tweet_to_topic(db):
    tweet = Tweet(tweet_id="999", author_handle="test", text="test")
    topic = Topic(title="Test Topic", date=date(2026, 2, 20))
    cat = Category(name="reaction", color="#FF0000")
    db.add_all([tweet, topic, cat])
    await db.flush()

    assignment = TweetAssignment(tweet_id=tweet.id, topic_id=topic.id, category_id=cat.id)
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    assert assignment.id is not None


@pytest.mark.asyncio
async def test_tweet_thread_fields(db):
    tweet = Tweet(
        tweet_id="111",
        author_handle="test",
        text="Thread tweet",
        thread_id="100",
        thread_position=2,
        is_reply=True,
        reply_to_tweet_id="100",
        reply_to_handle="author",
    )
    db.add(tweet)
    await db.commit()
    await db.refresh(tweet)
    assert tweet.thread_id == "100"
    assert tweet.thread_position == 2
    assert tweet.is_reply is True
