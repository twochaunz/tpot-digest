from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles

import app.db as db_module
from app.db import Base, get_db
from app.main import app
from app.models import Tweet, Topic, TweetAssignment  # noqa: F401


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):
    return compiler.visit_JSON(type_, **kw)


TEST_DB_URL = "sqlite+aiosqlite:///:memory:"
engine = create_async_engine(TEST_DB_URL, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)


async def override_get_db():
    async with async_session() as session:
        yield session


MOCK_X_API_RESULT = {
    "author_handle": "karpathy",
    "author_display_name": "Andrej Karpathy",
    "author_avatar_url": "https://pbs.twimg.com/profile/karpathy_normal.jpg",
    "author_verified": True,
    "text": "Claude 4 is amazing",
    "url": "https://x.com/karpathy/status/123456",
    "media_urls": [],
    "engagement": {"likes": 5000, "retweets": 1200, "replies": 300},
    "is_quote_tweet": False,
    "is_reply": False,
    "quoted_tweet_id": None,
    "reply_to_tweet_id": None,
    "created_at": "2026-02-20T15:30:00.000Z",
}


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    app.dependency_overrides[get_db] = override_get_db
    _orig_session = db_module.async_session
    db_module.async_session = async_session
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    app.dependency_overrides.pop(get_db, None)
    db_module.async_session = _orig_session


@pytest_asyncio.fixture(autouse=True)
def mock_fetch_tweet():
    mock = AsyncMock(return_value=MOCK_X_API_RESULT.copy())
    with patch("app.services.x_api.fetch_tweet", mock):
        yield mock


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def _create_tweets(client, count=3):
    ids = []
    for i in range(count):
        resp = await client.post("/api/tweets", json={
            "tweet_id": f"assign_{i}",
        })
        ids.append(resp.json()["id"])
    return ids


@pytest.mark.asyncio
async def test_bulk_assign(client: AsyncClient):
    tweet_ids = await _create_tweets(client, 3)
    topic = (await client.post("/api/topics", json={"title": "Test", "date": "2026-02-20"})).json()

    resp = await client.post("/api/tweets/assign", json={
        "tweet_ids": tweet_ids,
        "topic_id": topic["id"],
        "category": "hot-take",
    })
    assert resp.status_code == 200
    assert resp.json()["assigned"] == 3

    # Verify tweets show up under the topic with category
    filtered = await client.get("/api/tweets", params={"topic_id": topic["id"]})
    assert len(filtered.json()) == 3
    assert filtered.json()[0]["category"] == "hot-take"


@pytest.mark.asyncio
async def test_bulk_unassign(client: AsyncClient):
    tweet_ids = await _create_tweets(client, 2)
    topic = (await client.post("/api/topics", json={"title": "Test", "date": "2026-02-20"})).json()

    await client.post("/api/tweets/assign", json={
        "tweet_ids": tweet_ids,
        "topic_id": topic["id"],
    })

    resp = await client.post("/api/tweets/unassign", json={
        "tweet_ids": tweet_ids,
        "topic_id": topic["id"],
    })
    assert resp.status_code == 200

    # Tweets should now be unassigned
    unassigned = await client.get("/api/tweets", params={"unassigned": True})
    assert len(unassigned.json()) == 2


@pytest.mark.asyncio
async def test_assign_updates_category(client: AsyncClient):
    tweet_ids = await _create_tweets(client, 1)
    topic = (await client.post("/api/topics", json={"title": "Test", "date": "2026-02-20"})).json()

    # Assign with category
    await client.post("/api/tweets/assign", json={
        "tweet_ids": tweet_ids,
        "topic_id": topic["id"],
        "category": "hot-take",
    })

    # Re-assign with different category
    await client.post("/api/tweets/assign", json={
        "tweet_ids": tweet_ids,
        "topic_id": topic["id"],
        "category": "kek",
    })

    # Should have only 1 assignment (updated, not duplicated)
    filtered = await client.get("/api/tweets", params={"topic_id": topic["id"]})
    assert len(filtered.json()) == 1
    assert filtered.json()[0]["category"] == "kek"
