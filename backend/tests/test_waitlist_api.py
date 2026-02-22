import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles

from app.db import Base, get_db
from app.main import app

# Import all models so Base.metadata knows about them
from app.models import Tweet, Topic, Category, TweetAssignment, WaitlistEntry  # noqa: F401


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


@pytest.mark.asyncio
async def test_join_waitlist(client: AsyncClient):
    resp = await client.post("/api/waitlist", json={"email": "hello@example.com"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["message"] == "You're on the list!"
    assert data["already_registered"] is False


@pytest.mark.asyncio
async def test_join_waitlist_duplicate(client: AsyncClient):
    await client.post("/api/waitlist", json={"email": "hello@example.com"})
    resp = await client.post("/api/waitlist", json={"email": "hello@example.com"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["already_registered"] is True


@pytest.mark.asyncio
async def test_join_waitlist_invalid_email(client: AsyncClient):
    resp = await client.post("/api/waitlist", json={"email": "not-an-email"})
    assert resp.status_code == 422
