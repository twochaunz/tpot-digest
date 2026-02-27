import sys
import types
from unittest.mock import AsyncMock, MagicMock, patch

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

# Mock sentence_transformers before app.services.embeddings is imported
_FAKE_EMBEDDING = [0.1] * 384

if "sentence_transformers" not in sys.modules:
    _st_mod = types.ModuleType("sentence_transformers")
    _st_mod.SentenceTransformer = MagicMock()
    sys.modules["sentence_transformers"] = _st_mod

# Now ensure the embeddings module uses our mock embed_text
if "app.services.embeddings" not in sys.modules:
    _embed_mod = types.ModuleType("app.services.embeddings")
    _embed_mod.embed_text = lambda text: _FAKE_EMBEDDING
    _embed_mod.embed_texts = lambda texts: [_FAKE_EMBEDDING] * len(texts)
    sys.modules["app.services.embeddings"] = _embed_mod


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
    _orig_session = db_module.async_session
    db_module.async_session = async_session
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    app.dependency_overrides.pop(get_db, None)
    db_module.async_session = _orig_session


MOCK_X_API_RESULT = {
    "author_handle": "testuser",
    "author_display_name": "Test User",
    "author_avatar_url": "https://pbs.twimg.com/profile/test_normal.jpg",
    "author_verified": False,
    "text": "Test tweet text",
    "url": "https://x.com/testuser/status/111222333",
    "media_urls": [],
    "engagement": {"likes": 10, "retweets": 2, "replies": 1},
    "is_quote_tweet": False,
    "is_reply": False,
    "quoted_tweet_id": None,
    "reply_to_tweet_id": None,
    "created_at": "2026-02-23T12:00:00.000Z",
}


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


@pytest.mark.asyncio
async def test_create_topic(client: AsyncClient):
    resp = await client.post("/api/topics", json={
        "title": "Claude 4 Launch",
        "date": "2026-02-20",
        "color": "#E8A838",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Claude 4 Launch"
    assert data["date"] == "2026-02-20"


@pytest.mark.asyncio
async def test_list_topics_by_date(client: AsyncClient):
    await client.post("/api/topics", json={"title": "Topic A", "date": "2026-02-20"})
    await client.post("/api/topics", json={"title": "Topic B", "date": "2026-02-20"})
    await client.post("/api/topics", json={"title": "Topic C", "date": "2026-02-19"})

    resp = await client.get("/api/topics", params={"date": "2026-02-20"})
    assert resp.status_code == 200
    assert len(resp.json()) == 2


@pytest.mark.asyncio
async def test_update_topic(client: AsyncClient):
    create_resp = await client.post("/api/topics", json={
        "title": "Old Title",
        "date": "2026-02-20",
    })
    topic_id = create_resp.json()["id"]

    resp = await client.patch(f"/api/topics/{topic_id}", json={"title": "New Title"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "New Title"


@pytest.mark.asyncio
async def test_delete_topic(client: AsyncClient):
    create_resp = await client.post("/api/topics", json={
        "title": "Delete Me",
        "date": "2026-02-20",
    })
    topic_id = create_resp.json()["id"]

    resp = await client.delete(f"/api/topics/{topic_id}")
    assert resp.status_code == 204

    list_resp = await client.get("/api/topics", params={"date": "2026-02-20"})
    assert len(list_resp.json()) == 0


@pytest.mark.asyncio
async def test_set_og_tweet_on_topic(client: AsyncClient):
    # Create a tweet first
    tweet_resp = await client.post("/api/tweets", json={"tweet_id": "111222333"})
    tweet_db_id = tweet_resp.json()["id"]

    # Create a topic
    topic_resp = await client.post("/api/topics", json={"title": "Test OG", "date": "2026-02-23"})
    topic_id = topic_resp.json()["id"]

    # Assign tweet to topic
    await client.post("/api/tweets/assign", json={"tweet_ids": [tweet_db_id], "topic_id": topic_id})

    # Set OG
    resp = await client.patch(f"/api/topics/{topic_id}", json={"og_tweet_id": tweet_db_id})
    assert resp.status_code == 200
    assert resp.json()["og_tweet_id"] == tweet_db_id


@pytest.mark.asyncio
async def test_clear_og_tweet(client: AsyncClient):
    topic_resp = await client.post("/api/topics", json={"title": "Test Clear OG", "date": "2026-02-23"})
    topic_id = topic_resp.json()["id"]

    resp = await client.patch(f"/api/topics/{topic_id}", json={"og_tweet_id": None})
    assert resp.status_code == 200
    assert resp.json()["og_tweet_id"] is None


@pytest.mark.asyncio
async def test_og_tweet_must_be_assigned(client: AsyncClient):
    # Create tweet but don't assign to topic
    tweet_resp = await client.post("/api/tweets", json={"tweet_id": "444555666"})
    tweet_db_id = tweet_resp.json()["id"]

    topic_resp = await client.post("/api/topics", json={"title": "Test Unassigned OG", "date": "2026-02-23"})
    topic_id = topic_resp.json()["id"]

    # Setting OG on unassigned tweet should auto-assign it
    resp = await client.patch(f"/api/topics/{topic_id}", json={"og_tweet_id": tweet_db_id})
    assert resp.status_code == 200
    assert resp.json()["og_tweet_id"] == tweet_db_id


@pytest.mark.asyncio
async def test_setting_og_triggers_grok_fetch(client: AsyncClient):
    # Create a tweet with a URL
    tweet_resp = await client.post("/api/tweets", json={"tweet_id": "777888999"})
    tweet_db_id = tweet_resp.json()["id"]

    # Manually set a URL on the tweet (since X API is mocked/unavailable in tests)
    await client.patch(f"/api/tweets/{tweet_db_id}", json={"url": "https://x.com/user/status/777888999"})

    topic_resp = await client.post("/api/topics", json={"title": "Grok Test", "date": "2026-02-23"})
    topic_id = topic_resp.json()["id"]

    await client.post("/api/tweets/assign", json={"tweet_ids": [tweet_db_id], "topic_id": topic_id})

    with patch("app.routers.topics.fetch_grok_context", new_callable=AsyncMock) as mock_grok:
        mock_grok.return_value = "Auto-fetched context"
        resp = await client.patch(f"/api/topics/{topic_id}", json={"og_tweet_id": tweet_db_id})
        assert resp.status_code == 200
        mock_grok.assert_called_once()
