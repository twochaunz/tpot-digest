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
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    app.dependency_overrides.pop(get_db, None)


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
async def test_save_tweet(client: AsyncClient):
    payload = {
        "tweet_id": "123456",
        "feed_source": "for_you",
    }
    resp = await client.post("/api/tweets", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["tweet_id"] == "123456"
    assert data["author_handle"] == "karpathy"


@pytest.mark.asyncio
async def test_save_duplicate_returns_200(client: AsyncClient):
    payload = {"tweet_id": "123456"}
    resp1 = await client.post("/api/tweets", json=payload)
    assert resp1.status_code == 201

    resp2 = await client.post("/api/tweets", json=payload)
    assert resp2.status_code == 200
    assert resp2.json()["status"] == "duplicate"


@pytest.mark.asyncio
async def test_list_tweets(client: AsyncClient):
    for i in range(3):
        await client.post("/api/tweets", json={"tweet_id": str(i)})
    resp = await client.get("/api/tweets")
    assert resp.status_code == 200
    assert len(resp.json()) == 3


@pytest.mark.asyncio
async def test_delete_tweet(client: AsyncClient):
    await client.post("/api/tweets", json={"tweet_id": "del1"})
    tweets = (await client.get("/api/tweets")).json()
    tweet_id = tweets[0]["id"]

    resp = await client.delete(f"/api/tweets/{tweet_id}")
    assert resp.status_code == 204

    tweets_after = (await client.get("/api/tweets")).json()
    assert len(tweets_after) == 0


@pytest.mark.asyncio
async def test_list_unassigned_tweets(client: AsyncClient):
    for i in range(2):
        await client.post("/api/tweets", json={"tweet_id": f"unassigned_{i}"})
    resp = await client.get("/api/tweets", params={"unassigned": True})
    assert resp.status_code == 200
    assert len(resp.json()) == 2


@pytest.mark.asyncio
async def test_search_tweets(client: AsyncClient):
    # All tweets get the same text from mock: "Claude 4 is amazing"
    await client.post("/api/tweets", json={"tweet_id": "s1"})
    await client.post("/api/tweets", json={"tweet_id": "s2"})
    resp = await client.get("/api/tweets", params={"q": "Claude"})
    assert resp.status_code == 200
    # Both tweets match since they all have "Claude 4 is amazing" from mock
    assert len(resp.json()) == 2
    assert "Claude" in resp.json()[0]["text"]


@pytest.mark.asyncio
async def test_patch_tweet_memo(client: AsyncClient):
    await client.post("/api/tweets", json={"tweet_id": "patch1"})
    tweets = (await client.get("/api/tweets")).json()
    tid = tweets[0]["id"]

    resp = await client.patch(f"/api/tweets/{tid}", json={"memo": "use as opener"})
    assert resp.status_code == 200
    assert resp.json()["memo"] == "use as opener"


@pytest.mark.asyncio
async def test_patch_tweet_saved_at(client: AsyncClient):
    await client.post("/api/tweets", json={"tweet_id": "patch2"})
    tweets = (await client.get("/api/tweets")).json()
    tid = tweets[0]["id"]

    resp = await client.patch(f"/api/tweets/{tid}", json={"saved_at": "2026-02-18T12:00:00Z"})
    assert resp.status_code == 200
    assert "2026-02-18" in resp.json()["saved_at"]


@pytest.mark.asyncio
async def test_save_tweet_url_from_api(client: AsyncClient):
    payload = {"tweet_id": "url1"}
    resp = await client.post("/api/tweets", json=payload)
    assert resp.status_code == 201
    # URL comes from mock X API data
    assert resp.json()["url"] == "https://x.com/karpathy/status/123456"


@pytest.mark.asyncio
async def test_check_saved_tweets(client: AsyncClient):
    for i in range(3):
        await client.post("/api/tweets", json={"tweet_id": f"check_{i}"})
    resp = await client.post("/api/tweets/check", json={
        "tweet_ids": ["check_0", "check_2", "not_saved"],
    })
    assert resp.status_code == 200
    saved = resp.json()["saved"]
    assert "check_0" in saved
    assert "check_2" in saved
    assert "not_saved" not in saved


@pytest.mark.asyncio
async def test_list_thread_tweets(client: AsyncClient):
    for i in range(3):
        await client.post("/api/tweets", json={
            "tweet_id": f"thread_{i}",
            "thread_id": "thread_0",
            "thread_position": i,
        })
    resp = await client.get("/api/tweets", params={"thread_id": "thread_0"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 3
    assert data[0]["thread_position"] == 0
    assert data[2]["thread_position"] == 2


@pytest.mark.asyncio
async def test_x_api_failure_returns_502(client: AsyncClient, mock_fetch_tweet):
    from app.services.x_api import XAPIError
    mock_fetch_tweet.side_effect = XAPIError("X API rate limit exceeded")

    resp = await client.post("/api/tweets", json={"tweet_id": "fail1"})
    assert resp.status_code == 502
    assert "rate limit" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_grok_endpoint(client: AsyncClient):
    # Create a tweet first
    await client.post("/api/tweets", json={"tweet_id": "grok1"})
    tweets = (await client.get("/api/tweets")).json()
    tid = tweets[0]["id"]

    # Mock the grok API
    with patch("app.services.grok_api.fetch_grok_context", new_callable=AsyncMock) as mock_grok:
        mock_grok.return_value = "This tweet discusses Claude 4 and its capabilities."

        resp = await client.post(f"/api/tweets/{tid}/grok")
        assert resp.status_code == 200
        assert resp.json()["grok_context"] == "This tweet discusses Claude 4 and its capabilities."
        mock_grok.assert_called_once_with(
            "https://x.com/karpathy/status/123456",
        )

        # Second call returns cached (no re-fetch)
        mock_grok.reset_mock()
        resp2 = await client.post(f"/api/tweets/{tid}/grok")
        assert resp2.status_code == 200
        assert resp2.json()["grok_context"] == "This tweet discusses Claude 4 and its capabilities."
        mock_grok.assert_not_called()

        # Force refresh calls API again
        mock_grok.return_value = "Updated context."
        resp3 = await client.post(f"/api/tweets/{tid}/grok", params={"force": True})
        assert resp3.status_code == 200
        assert resp3.json()["grok_context"] == "Updated context."
        mock_grok.assert_called_once()


@pytest.mark.asyncio
async def test_grok_endpoint_not_found(client: AsyncClient):
    resp = await client.post("/api/tweets/99999/grok")
    assert resp.status_code == 404
