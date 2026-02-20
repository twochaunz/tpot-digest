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
