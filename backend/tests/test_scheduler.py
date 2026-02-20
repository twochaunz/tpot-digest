"""Tests for scheduler control endpoints and pipeline function."""

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db import get_db
from app.main import app
from app.models.account import Account  # noqa: F401 — needed for FK target
from app.models.article import Article  # noqa: F401 — FK target from screenshots
from app.models.screenshot import Screenshot  # noqa: F401 — loaded via Tweet relationship
from app.models.topic import Topic, SubTopic, SubTopicTweet  # noqa: F401
from app.models.tweet import Tweet  # noqa: F401


# ---------------------------------------------------------------------------
# Compilation shims for SQLite compatibility
# ---------------------------------------------------------------------------

from sqlalchemy.ext.compiler import compiles  # noqa: E402


@compiles(JSONB, "sqlite")
def _compile_jsonb_as_json(type_, compiler, **kw):
    return compiler.visit_JSON(type_, **kw)


from pgvector.sqlalchemy import Vector  # noqa: E402


@compiles(Vector, "sqlite")
def _compile_vector_as_blob(type_, compiler, **kw):
    return "BLOB"


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
    """Create tables before each test and drop them after."""
    app.dependency_overrides[get_db] = override_get_db
    async with engine_test.begin() as conn:
        await conn.run_sync(Account.__table__.create)
        await conn.run_sync(Tweet.__table__.create)
        await conn.run_sync(Article.__table__.create)
        await conn.run_sync(Screenshot.__table__.create)
        await conn.run_sync(Topic.__table__.create)
        await conn.run_sync(SubTopic.__table__.create)
        await conn.run_sync(SubTopicTweet.__table__.create)
    yield
    async with engine_test.begin() as conn:
        await conn.run_sync(SubTopicTweet.__table__.drop)
        await conn.run_sync(SubTopic.__table__.drop)
        await conn.run_sync(Topic.__table__.drop)
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
# Scheduler status endpoint tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scheduler_status(client: AsyncClient):
    """GET /api/scheduler/status returns on-demand mode status."""
    response = await client.get("/api/scheduler/status")

    assert response.status_code == 200
    data = response.json()
    assert data["running"] is False
    assert data["next_run_time"] is None
    assert data["mode"] == "on_demand"


# ---------------------------------------------------------------------------
# Trigger endpoint test
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_trigger_pipeline_no_tweets(client: AsyncClient):
    """POST /api/scheduler/trigger returns message when no unclustered tweets."""
    response = await client.post("/api/scheduler/trigger")

    assert response.status_code == 202
    data = response.json()
    assert "No unclustered tweets" in data["message"]
