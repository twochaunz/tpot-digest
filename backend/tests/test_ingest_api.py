import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
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

TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4"
    "nGNgYPgPAAEDAQAIicLsAAAABJRU5ErkJggg=="
)


@pytest_asyncio.fixture(autouse=True)
async def setup_database(tmp_path, monkeypatch):
    """Create tables before each test and drop them after.

    Uses tmp_path for screenshot file output so tests don't write to
    the real data directory.
    """
    monkeypatch.setattr("app.routers.ingest.settings.data_dir", str(tmp_path))
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
async def test_ingest_single_tweet(client: AsyncClient):
    payload = {
        "tweet_id": "1234567890",
        "author_handle": "karpathy",
        "author_display_name": "Andrej Karpathy",
        "text": "Hello world!",
        "media_urls": ["https://pbs.twimg.com/media/abc.jpg"],
        "engagement": {"likes": 100, "retweets": 42},
        "is_retweet": False,
        "is_quote_tweet": False,
        "feed_source": "for_you",
        "screenshot_base64": TINY_PNG_B64,
    }
    response = await client.post("/api/ingest", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["tweet_id"] == "1234567890"
    assert data["author_handle"] == "karpathy"
    assert data["status"] == "saved"
    assert data["id"] is not None


@pytest.mark.asyncio
async def test_ingest_duplicate_returns_existing(client: AsyncClient):
    payload = {
        "tweet_id": "dup_tweet_001",
        "author_handle": "elonmusk",
        "text": "First ingest",
        "screenshot_base64": TINY_PNG_B64,
    }
    # First ingest — should be saved
    resp1 = await client.post("/api/ingest", json=payload)
    assert resp1.status_code == 201
    data1 = resp1.json()
    assert data1["status"] == "saved"

    # Second ingest — same tweet_id, should be duplicate
    resp2 = await client.post("/api/ingest", json=payload)
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["status"] == "duplicate"
    assert data2["tweet_id"] == "dup_tweet_001"
    assert data2["id"] == data1["id"]


@pytest.mark.asyncio
async def test_ingest_batch(client: AsyncClient):
    payload = {
        "tweets": [
            {
                "tweet_id": "batch_001",
                "author_handle": "alice",
                "text": "First batch tweet",
                "screenshot_base64": TINY_PNG_B64,
            },
            {
                "tweet_id": "batch_002",
                "author_handle": "bob",
                "text": "Second batch tweet",
                "screenshot_base64": TINY_PNG_B64,
            },
        ]
    }
    response = await client.post("/api/ingest/batch", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["saved_count"] == 2
    assert data["duplicate_count"] == 0
    assert len(data["results"]) == 2
    assert data["results"][0]["status"] == "saved"
    assert data["results"][1]["status"] == "saved"


@pytest.mark.asyncio
async def test_ingest_batch_with_duplicates(client: AsyncClient):
    # Pre-create one tweet via single ingest
    pre_payload = {
        "tweet_id": "existing_001",
        "author_handle": "charlie",
        "text": "Already exists",
        "screenshot_base64": TINY_PNG_B64,
    }
    resp = await client.post("/api/ingest", json=pre_payload)
    assert resp.status_code == 201

    # Batch with the existing tweet + a new one
    batch_payload = {
        "tweets": [
            {
                "tweet_id": "existing_001",
                "author_handle": "charlie",
                "text": "Already exists",
                "screenshot_base64": TINY_PNG_B64,
            },
            {
                "tweet_id": "new_001",
                "author_handle": "dave",
                "text": "Brand new tweet",
                "screenshot_base64": TINY_PNG_B64,
            },
        ]
    }
    response = await client.post("/api/ingest/batch", json=batch_payload)
    assert response.status_code == 200
    data = response.json()
    assert data["saved_count"] == 1
    assert data["duplicate_count"] == 1
    assert data["results"][0]["status"] == "duplicate"
    assert data["results"][1]["status"] == "saved"
