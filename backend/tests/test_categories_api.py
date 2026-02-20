import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles

from app.db import Base, get_db
from app.main import app
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


@pytest.mark.asyncio
async def test_create_category(client: AsyncClient):
    resp = await client.post("/api/categories", json={
        "name": "commentary",
        "color": "#4ECDC4",
    })
    assert resp.status_code == 201
    assert resp.json()["name"] == "commentary"


@pytest.mark.asyncio
async def test_list_categories(client: AsyncClient):
    await client.post("/api/categories", json={"name": "commentary"})
    await client.post("/api/categories", json={"name": "reaction"})
    await client.post("/api/categories", json={"name": "callout"})

    resp = await client.get("/api/categories")
    assert resp.status_code == 200
    assert len(resp.json()) == 3


@pytest.mark.asyncio
async def test_update_category(client: AsyncClient):
    create_resp = await client.post("/api/categories", json={"name": "old_name"})
    cat_id = create_resp.json()["id"]

    resp = await client.patch(f"/api/categories/{cat_id}", json={"name": "new_name"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "new_name"


@pytest.mark.asyncio
async def test_delete_category(client: AsyncClient):
    create_resp = await client.post("/api/categories", json={"name": "delete_me"})
    cat_id = create_resp.json()["id"]

    resp = await client.delete(f"/api/categories/{cat_id}")
    assert resp.status_code == 204

    list_resp = await client.get("/api/categories")
    assert len(list_resp.json()) == 0
