import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db import Base, get_db
from app.main import app
from app.models.account import Account  # noqa: F401 — needed for FK target
from app.models.article import Article  # noqa: F401 — needed for FK target from screenshots
from app.models.screenshot import Screenshot  # noqa: F401 — loaded via Tweet relationship
from app.models.tweet import Tweet  # noqa: F401 — registers the model with Base


# ---------------------------------------------------------------------------
# JSONB → JSON compilation shim for SQLite
# ---------------------------------------------------------------------------
# PostgreSQL's JSONB type is not supported by the SQLite dialect.  We register
# a custom compilation rule so that SQLAlchemy emits "JSON" instead of "JSONB"
# when targeting SQLite, allowing the same model definitions to be used in
# both production (PostgreSQL) and testing (SQLite) environments.

from sqlalchemy.ext.compiler import compiles  # noqa: E402


@compiles(JSONB, "sqlite")
def _compile_jsonb_as_json(type_, compiler, **kw):
    return compiler.visit_JSON(type_, **kw)


# ---------------------------------------------------------------------------
# Test database setup — async SQLite in-memory
# ---------------------------------------------------------------------------

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

engine_test = create_async_engine(TEST_DATABASE_URL, echo=False)
async_session_test = async_sessionmaker(engine_test, expire_on_commit=False)


async def override_get_db():
    async with async_session_test() as session:
        yield session


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(autouse=True)
async def setup_database():
    """Create tables before each test and drop them after.

    The Tweet model eagerly loads the ``screenshots`` relationship
    (``lazy="selectin"``), so we must also create the screenshots and
    articles tables (the latter is a FK target from screenshots).

    The dependency override is applied/restored per-test so that running
    this file alongside other test modules (e.g. test_accounts_api) does
    not cause cross-contamination of the ``app.dependency_overrides``.
    """
    app.dependency_overrides[get_db] = override_get_db
    async with engine_test.begin() as conn:
        await conn.run_sync(Account.__table__.create)
        await conn.run_sync(Tweet.__table__.create)
        await conn.run_sync(Article.__table__.create)
        await conn.run_sync(Screenshot.__table__.create)
    yield
    async with engine_test.begin() as conn:
        await conn.run_sync(Screenshot.__table__.drop)
        await conn.run_sync(Article.__table__.drop)
        await conn.run_sync(Tweet.__table__.drop)
        await conn.run_sync(Account.__table__.drop)
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_tweet(client: AsyncClient):
    payload = {
        "tweet_id": "1234567890",
        "author_handle": "karpathy",
        "text": "Hello world!",
        "media_urls": {"images": ["https://pbs.twimg.com/media/abc.jpg"]},
        "engagement": {"likes": 100, "retweets": 42},
        "is_retweet": False,
        "is_quote_tweet": False,
        "feed_source": "home",
    }
    response = await client.post("/api/tweets", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["tweet_id"] == "1234567890"
    assert data["author_handle"] == "karpathy"
    assert data["text"] == "Hello world!"
    assert data["media_urls"] == {"images": ["https://pbs.twimg.com/media/abc.jpg"]}
    assert data["engagement"] == {"likes": 100, "retweets": 42}
    assert data["is_retweet"] is False
    assert data["is_quote_tweet"] is False
    assert data["feed_source"] == "home"
    assert data["scraped_at"] is not None
    assert data["id"] is not None


@pytest.mark.asyncio
async def test_list_tweets(client: AsyncClient):
    # Create two tweets
    await client.post("/api/tweets", json={
        "tweet_id": "111",
        "author_handle": "alice",
        "text": "First tweet",
    })
    await client.post("/api/tweets", json={
        "tweet_id": "222",
        "author_handle": "bob",
        "text": "Second tweet",
    })

    # List all
    response = await client.get("/api/tweets")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2

    # Filter by author
    response = await client.get("/api/tweets", params={"author": "alice"})
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["author_handle"] == "alice"


@pytest.mark.asyncio
async def test_get_tweet_by_tweet_id(client: AsyncClient):
    # Create a tweet
    await client.post("/api/tweets", json={
        "tweet_id": "9876543210",
        "author_handle": "elonmusk",
        "text": "Testing get endpoint",
    })

    # Fetch by tweet_id
    response = await client.get("/api/tweets/9876543210")
    assert response.status_code == 200
    data = response.json()
    assert data["tweet_id"] == "9876543210"
    assert data["author_handle"] == "elonmusk"
    assert data["text"] == "Testing get endpoint"


@pytest.mark.asyncio
async def test_get_tweet_not_found(client: AsyncClient):
    response = await client.get("/api/tweets/nonexistent")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_create_tweet_from_url_xcom(client: AsyncClient):
    response = await client.post("/api/tweets/from-url", json={
        "url": "https://x.com/karpathy/status/1234567890123456789",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["tweet_id"] == "1234567890123456789"
    assert data["author_handle"] == "karpathy"
    assert data["text"] == "[Pending scrape]"


@pytest.mark.asyncio
async def test_create_tweet_from_url_twitter(client: AsyncClient):
    response = await client.post("/api/tweets/from-url", json={
        "url": "https://twitter.com/elonmusk/status/9999999999999999999",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["tweet_id"] == "9999999999999999999"
    assert data["author_handle"] == "elonmusk"
    assert data["text"] == "[Pending scrape]"


@pytest.mark.asyncio
async def test_create_tweet_from_url_invalid(client: AsyncClient):
    response = await client.post("/api/tweets/from-url", json={
        "url": "https://example.com/not-a-tweet",
    })
    assert response.status_code == 400
