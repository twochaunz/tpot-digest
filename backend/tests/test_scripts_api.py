from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles

from app.db import Base, get_db
from app.main import app

# Import all models so Base.metadata knows about them
from app.models import Tweet, Topic, TopicScript, TweetAssignment  # noqa: F401


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):
    return compiler.visit_JSON(type_, **kw)


TEST_DB_URL = "sqlite+aiosqlite:///:memory:"
engine = create_async_engine(TEST_DB_URL, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)


async def override_get_db():
    async with async_session() as session:
        yield session


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    app.dependency_overrides[get_db] = override_get_db
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture(autouse=True)
def mock_fetch_tweet():
    mock = AsyncMock(return_value={
        "author_handle": "testuser",
        "author_display_name": "Test User",
        "author_avatar_url": "https://pbs.twimg.com/profile/test_normal.jpg",
        "author_verified": False,
        "text": "Test tweet for scripts",
        "url": "https://x.com/testuser/status/100",
        "media_urls": [],
        "engagement": {"likes": 10, "retweets": 2, "replies": 1},
        "is_quote_tweet": False,
        "is_reply": False,
        "quoted_tweet_id": None,
        "reply_to_tweet_id": None,
        "created_at": "2026-02-20T15:30:00.000Z",
    })
    with patch("app.services.x_api.fetch_tweet", mock):
        yield mock


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
