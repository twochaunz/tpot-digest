import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles

from app.db import Base, get_db
from app.main import app

# Import all models so Base.metadata knows about them
from app.models import Tweet, Topic, Category, TweetAssignment  # noqa: F401


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


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


TINY_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4"
    "nGNgYPgPAAEDAQAIicLsAAAABJRU5ErkJggg=="
)


@pytest.mark.asyncio
async def test_save_tweet(client: AsyncClient):
    payload = {
        "tweet_id": "123456",
        "author_handle": "karpathy",
        "author_display_name": "Andrej Karpathy",
        "text": "Claude 4 is amazing",
        "engagement": {"likes": 5000, "retweets": 1200, "replies": 300},
        "screenshot_base64": TINY_PNG,
        "feed_source": "for_you",
    }
    resp = await client.post("/api/tweets", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["tweet_id"] == "123456"
    assert data["author_handle"] == "karpathy"


@pytest.mark.asyncio
async def test_save_duplicate_returns_200(client: AsyncClient):
    payload = {
        "tweet_id": "123456",
        "author_handle": "karpathy",
        "text": "test",
        "screenshot_base64": TINY_PNG,
    }
    resp1 = await client.post("/api/tweets", json=payload)
    assert resp1.status_code == 201

    resp2 = await client.post("/api/tweets", json=payload)
    assert resp2.status_code == 200
    assert resp2.json()["status"] == "duplicate"


@pytest.mark.asyncio
async def test_list_tweets(client: AsyncClient):
    for i in range(3):
        await client.post("/api/tweets", json={
            "tweet_id": str(i),
            "author_handle": "test",
            "text": f"Tweet {i}",
            "screenshot_base64": TINY_PNG,
        })
    resp = await client.get("/api/tweets")
    assert resp.status_code == 200
    assert len(resp.json()) == 3


@pytest.mark.asyncio
async def test_delete_tweet(client: AsyncClient):
    await client.post("/api/tweets", json={
        "tweet_id": "del1",
        "author_handle": "test",
        "text": "Delete me",
        "screenshot_base64": TINY_PNG,
    })
    tweets = (await client.get("/api/tweets")).json()
    tweet_id = tweets[0]["id"]

    resp = await client.delete(f"/api/tweets/{tweet_id}")
    assert resp.status_code == 204

    tweets_after = (await client.get("/api/tweets")).json()
    assert len(tweets_after) == 0


@pytest.mark.asyncio
async def test_list_unassigned_tweets(client: AsyncClient):
    # Save 2 tweets
    for i in range(2):
        await client.post("/api/tweets", json={
            "tweet_id": f"unassigned_{i}",
            "author_handle": "test",
            "text": f"Tweet {i}",
            "screenshot_base64": TINY_PNG,
        })
    resp = await client.get("/api/tweets", params={"unassigned": True})
    assert resp.status_code == 200
    assert len(resp.json()) == 2


@pytest.mark.asyncio
async def test_search_tweets(client: AsyncClient):
    await client.post("/api/tweets", json={
        "tweet_id": "s1",
        "author_handle": "test",
        "text": "Claude 4 is incredible",
        "screenshot_base64": TINY_PNG,
    })
    await client.post("/api/tweets", json={
        "tweet_id": "s2",
        "author_handle": "test",
        "text": "OpenAI raises funding",
        "screenshot_base64": TINY_PNG,
    })
    resp = await client.get("/api/tweets", params={"q": "Claude"})
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert "Claude" in resp.json()[0]["text"]


@pytest.mark.asyncio
async def test_list_thread_tweets(client: AsyncClient):
    for i in range(3):
        await client.post("/api/tweets", json={
            "tweet_id": f"thread_{i}",
            "author_handle": "test",
            "text": f"Thread part {i}",
            "thread_id": "thread_0",
            "thread_position": i,
            "screenshot_base64": TINY_PNG,
        })
    resp = await client.get("/api/tweets", params={"thread_id": "thread_0"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 3
    assert data[0]["thread_position"] == 0
    assert data[2]["thread_position"] == 2
