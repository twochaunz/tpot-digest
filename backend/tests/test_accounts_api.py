import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db import Base, get_db
from app.main import app
from app.models.account import Account  # noqa: F401 — registers the model with Base


# ---------------------------------------------------------------------------
# Test database setup — async SQLite in-memory
# ---------------------------------------------------------------------------

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

engine_test = create_async_engine(TEST_DATABASE_URL, echo=False)
async_session_test = async_sessionmaker(engine_test, expire_on_commit=False)


async def override_get_db():
    async with async_session_test() as session:
        yield session


app.dependency_overrides[get_db] = override_get_db


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(autouse=True)
async def setup_database():
    """Create tables before each test and drop them after."""
    async with engine_test.begin() as conn:
        # Only create the accounts table (avoids PG-specific types in other models)
        await conn.run_sync(Account.__table__.create)
    yield
    async with engine_test.begin() as conn:
        await conn.run_sync(Account.__table__.drop)


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_account(client: AsyncClient):
    response = await client.post("/api/accounts", json={"handle": "karpathy"})
    assert response.status_code == 201
    data = response.json()
    assert data["handle"] == "karpathy"
    assert data["source"] == "seed"
    assert data["priority"] == 2
    assert data["is_active"] is True
    assert data["is_blocked"] is False
    assert data["is_boosted"] is False


@pytest.mark.asyncio
async def test_list_accounts(client: AsyncClient):
    # Seed two accounts with different priorities
    await client.post("/api/accounts", json={"handle": "user_a", "priority": 3})
    await client.post("/api/accounts", json={"handle": "user_b", "priority": 1})

    response = await client.get("/api/accounts")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 2
    # Should be ordered by priority ascending
    assert data[0]["handle"] == "user_b"
    assert data[1]["handle"] == "user_a"


@pytest.mark.asyncio
async def test_update_account(client: AsyncClient):
    # Create an account first
    create_resp = await client.post("/api/accounts", json={"handle": "update_me"})
    account_id = create_resp.json()["id"]

    # Update priority
    response = await client.patch(f"/api/accounts/{account_id}", json={"priority": 1})
    assert response.status_code == 200
    assert response.json()["priority"] == 1


@pytest.mark.asyncio
async def test_delete_account(client: AsyncClient):
    # Create an account first
    create_resp = await client.post("/api/accounts", json={"handle": "delete_me"})
    account_id = create_resp.json()["id"]

    # Delete it
    response = await client.delete(f"/api/accounts/{account_id}")
    assert response.status_code == 204

    # Verify it's gone
    list_resp = await client.get("/api/accounts")
    handles = [a["handle"] for a in list_resp.json()]
    assert "delete_me" not in handles


@pytest.mark.asyncio
async def test_update_nonexistent_account(client: AsyncClient):
    response = await client.patch("/api/accounts/9999", json={"priority": 1})
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_delete_nonexistent_account(client: AsyncClient):
    response = await client.delete("/api/accounts/9999")
    assert response.status_code == 404
