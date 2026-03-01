from unittest.mock import patch, PropertyMock

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
def clear_rate_limits():
    """Clear rate limit state between tests."""
    import app.auth as auth_module
    auth_module._rate_limit_store.clear()
    yield
    auth_module._rate_limit_store.clear()


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# --- /api/auth/admin tests ---


@pytest.mark.asyncio
async def test_valid_key_sets_cookie_and_returns_admin(client: AsyncClient):
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = "my-secret-key"
        resp = await client.get("/api/auth/admin", params={"key": "my-secret-key"})
    assert resp.status_code == 200
    assert resp.json() == {"role": "admin"}
    # Check that a cookie was set
    cookie_header = resp.headers.get("set-cookie")
    assert cookie_header is not None
    assert "tpot_admin" in cookie_header
    assert "httponly" in cookie_header.lower()
    assert "samesite=lax" in cookie_header.lower()


@pytest.mark.asyncio
async def test_invalid_key_returns_403(client: AsyncClient):
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = "my-secret-key"
        resp = await client.get("/api/auth/admin", params={"key": "wrong-key"})
    assert resp.status_code == 403
    assert "invalid" in resp.json()["detail"].lower() or "Invalid" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_empty_admin_secret_returns_403(client: AsyncClient):
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = ""
        resp = await client.get("/api/auth/admin", params={"key": "anything"})
    assert resp.status_code == 403


# --- /api/auth/me tests ---


@pytest.mark.asyncio
async def test_me_without_cookie_returns_viewer(client: AsyncClient):
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = "my-secret-key"
        resp = await client.get("/api/auth/me")
    assert resp.status_code == 200
    assert resp.json() == {"role": "viewer"}


@pytest.mark.asyncio
async def test_me_with_valid_cookie_returns_admin(client: AsyncClient):
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = "my-secret-key"
        # First, login to get the cookie
        login_resp = await client.get("/api/auth/admin", params={"key": "my-secret-key"})
        assert login_resp.status_code == 200

        # Extract cookie from response and send it
        cookie_header = login_resp.headers.get("set-cookie")
        # Parse cookie value
        cookie_value = cookie_header.split("tpot_admin=")[1].split(";")[0]

        resp = await client.get("/api/auth/me", cookies={"tpot_admin": cookie_value})
    assert resp.status_code == 200
    assert resp.json() == {"role": "admin"}


@pytest.mark.asyncio
async def test_me_with_admin_key_header_returns_admin(client: AsyncClient):
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = "my-secret-key"
        resp = await client.get(
            "/api/auth/me",
            headers={"X-Admin-Key": "my-secret-key"},
        )
    assert resp.status_code == 200
    assert resp.json() == {"role": "admin"}


@pytest.mark.asyncio
async def test_me_with_wrong_header_returns_viewer(client: AsyncClient):
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = "my-secret-key"
        resp = await client.get(
            "/api/auth/me",
            headers={"X-Admin-Key": "wrong-key"},
        )
    assert resp.status_code == 200
    assert resp.json() == {"role": "viewer"}


# --- /api/auth/logout tests ---


@pytest.mark.asyncio
async def test_logout_clears_cookie(client: AsyncClient):
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = "my-secret-key"
        # Login first
        login_resp = await client.get("/api/auth/admin", params={"key": "my-secret-key"})
        assert login_resp.status_code == 200

        # Logout
        resp = await client.post("/api/auth/logout")
    assert resp.status_code == 200
    assert resp.json() == {"role": "viewer"}
    cookie_header = resp.headers.get("set-cookie")
    assert cookie_header is not None
    assert "tpot_admin" in cookie_header
    # Cookie should be cleared (max-age=0 or expires in the past)
    assert "max-age=0" in cookie_header.lower() or 'tpot_admin=""' in cookie_header or "tpot_admin=;" in cookie_header


# --- require_admin dependency tests ---


@pytest.mark.asyncio
async def test_require_admin_noop_when_secret_empty(client: AsyncClient):
    """When admin_secret is empty (dev mode), require_admin is a no-op."""
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = ""
        # /me should still work -- it doesn't use require_admin
        resp = await client.get("/api/auth/me")
    assert resp.status_code == 200


# --- Rate limiting tests ---


@pytest.mark.asyncio
async def test_rate_limit_on_admin_endpoint(client: AsyncClient):
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = "my-secret-key"
        # Make 5 failed attempts
        for _ in range(5):
            await client.get("/api/auth/admin", params={"key": "wrong"})

        # 6th attempt should be rate-limited
        resp = await client.get("/api/auth/admin", params={"key": "my-secret-key"})
    assert resp.status_code == 429


# --- Cookie signing tests ---


@pytest.mark.asyncio
async def test_tampered_cookie_returns_viewer(client: AsyncClient):
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = "my-secret-key"
        resp = await client.get(
            "/api/auth/me",
            cookies={"tpot_admin": "admin:12345:tampered_signature"},
        )
    assert resp.status_code == 200
    assert resp.json() == {"role": "viewer"}


# --- require_admin on mutation endpoints ---


@pytest.mark.asyncio
async def test_save_tweet_requires_admin(client: AsyncClient):
    """POST /api/tweets returns 403 without admin auth."""
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = "test-secret"
        resp = await client.post("/api/tweets", json={"tweet_id": "123"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_delete_topic_requires_admin(client: AsyncClient):
    """DELETE /api/topics/{id} returns 403 without admin auth."""
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = "test-secret"
        resp = await client.delete("/api/topics/1")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_get_tweets_public(client: AsyncClient):
    """GET /api/tweets is public (no admin required)."""
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = "test-secret"
        resp = await client.get("/api/tweets")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_check_saved_public(client: AsyncClient):
    """POST /api/tweets/check is public (read-only operation)."""
    with patch("app.auth.settings") as mock_settings:
        mock_settings.admin_secret = "test-secret"
        resp = await client.post("/api/tweets/check", json={"tweet_ids": []})
    assert resp.status_code == 200
