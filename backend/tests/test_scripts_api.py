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


async def _create_topic_with_tweets(client):
    """Helper: create a topic with assigned tweets."""
    # Create two tweets
    await client.post("/api/tweets", json={"tweet_id": "111"})
    await client.post("/api/tweets", json={"tweet_id": "222"})

    # Create topic
    resp = await client.post("/api/topics", json={"title": "Test Topic", "date": "2026-02-25"})
    topic_id = resp.json()["id"]

    # Get tweet DB IDs
    tweets_resp = await client.get("/api/tweets")
    tweet_ids = [t["id"] for t in tweets_resp.json()]

    # Assign tweets to topic
    await client.post("/api/tweets/assign", json={"tweet_ids": tweet_ids, "topic_id": topic_id, "category": "context"})

    return topic_id, tweet_ids


@pytest.mark.asyncio
async def test_generate_script(client):
    topic_id, tweet_ids = await _create_topic_with_tweets(client)

    mock_blocks = [
        {"type": "text", "text": "Test narrative about AI."},
        {"type": "tweet", "tweet_id": "111"},
    ]

    with patch("app.routers.scripts.generate_script", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = mock_blocks
        with patch("app.services.grok_api.fetch_grok_context", new_callable=AsyncMock) as mock_grok:
            mock_grok.return_value = "Context about the tweet."

            resp = await client.post(
                f"/api/topics/{topic_id}/script/generate",
                json={"model": "grok-4-1-fast-reasoning", "fetch_grok_context": True},
            )

    assert resp.status_code == 200
    data = resp.json()
    assert data["version"] == 1
    assert data["is_active"] is True
    assert len(data["content"]) == 2


@pytest.mark.asyncio
async def test_get_active_script(client):
    topic_id, _ = await _create_topic_with_tweets(client)

    # No script yet — 404
    resp = await client.get(f"/api/topics/{topic_id}/script")
    assert resp.status_code == 404

    # Generate one
    mock_blocks = [{"type": "text", "text": "Narrative."}]
    with patch("app.routers.scripts.generate_script", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = mock_blocks
        with patch("app.services.grok_api.fetch_grok_context", new_callable=AsyncMock) as mock_grok:
            mock_grok.return_value = "Context."
            await client.post(f"/api/topics/{topic_id}/script/generate", json={"model": "grok-3"})

    resp = await client.get(f"/api/topics/{topic_id}/script")
    assert resp.status_code == 200
    assert resp.json()["version"] == 1


@pytest.mark.asyncio
async def test_regenerate_with_feedback(client):
    topic_id, _ = await _create_topic_with_tweets(client)

    # Generate v1
    with patch("app.routers.scripts.generate_script", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = [{"type": "text", "text": "V1."}]
        with patch("app.services.grok_api.fetch_grok_context", new_callable=AsyncMock) as mock_grok:
            mock_grok.return_value = "Context."
            await client.post(f"/api/topics/{topic_id}/script/generate", json={"model": "grok-3"})

    # Generate v2 with feedback
    with patch("app.routers.scripts.generate_script", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = [{"type": "text", "text": "V2 with feedback."}]
        with patch("app.services.grok_api.fetch_grok_context", new_callable=AsyncMock) as mock_grok:
            mock_grok.return_value = "Context."
            resp = await client.post(
                f"/api/topics/{topic_id}/script/generate",
                json={"model": "grok-3", "feedback": "make it punchier"},
            )

    assert resp.json()["version"] == 2
    assert resp.json()["feedback"] == "make it punchier"

    # Check versions
    versions_resp = await client.get(f"/api/topics/{topic_id}/script/versions")
    versions = versions_resp.json()
    assert len(versions) == 2
    assert versions[0]["is_active"] is False
    assert versions[1]["is_active"] is True


@pytest.mark.asyncio
async def test_generate_nonexistent_topic(client):
    with patch("app.routers.scripts.generate_script", new_callable=AsyncMock):
        resp = await client.post("/api/topics/9999/script/generate", json={"model": "grok-3"})
    assert resp.status_code == 404
