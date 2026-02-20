import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db import Base, get_db
from app.main import app
from app.models.account import Account  # noqa: F401 — FK target
from app.models.article import Article  # noqa: F401 — FK target from screenshots
from app.models.screenshot import Screenshot  # noqa: F401 — loaded via Tweet relationship
from app.models.topic import SubTopic, SubTopicTweet, Topic, TopicEdge  # noqa: F401 — registers models
from app.models.tweet import Tweet  # noqa: F401 — FK target for subtopic_tweets

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
        await conn.run_sync(TopicEdge.__table__.create)
    yield
    async with engine_test.begin() as conn:
        await conn.run_sync(TopicEdge.__table__.drop)
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
# Helper
# ---------------------------------------------------------------------------


async def create_topic(client: AsyncClient, **kwargs) -> dict:
    payload = {
        "date": "2026-02-19",
        "title": "Default Topic",
        "rank": 1,
        **kwargs,
    }
    resp = await client.post("/api/topics", json=payload)
    assert resp.status_code == 201
    return resp.json()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_graph_empty(client: AsyncClient):
    response = await client.get("/api/graph")
    assert response.status_code == 200
    data = response.json()
    assert data["nodes"] == []
    assert data["edges"] == []


@pytest.mark.asyncio
async def test_get_graph_with_topics(client: AsyncClient):
    await create_topic(client, title="Topic Alpha", date="2026-02-19")
    await create_topic(client, title="Topic Beta", date="2026-02-20")

    response = await client.get("/api/graph", params={
        "date_from": "2026-02-19",
        "date_to": "2026-02-20",
    })
    assert response.status_code == 200
    data = response.json()
    titles = {n["title"] for n in data["nodes"]}
    assert "Topic Alpha" in titles
    assert "Topic Beta" in titles
    assert len(data["nodes"]) == 2
    assert data["edges"] == []


@pytest.mark.asyncio
async def test_get_graph_with_edges(client: AsyncClient):
    t1 = await create_topic(client, title="Topic One", date="2026-02-19")
    t2 = await create_topic(client, title="Topic Two", date="2026-02-19")

    # Create an edge via POST /api/graph/link
    link_resp = await client.post("/api/graph/link", json={
        "source_topic_id": t1["id"],
        "target_topic_id": t2["id"],
        "relationship_type": "manual",
    })
    assert link_resp.status_code == 201

    response = await client.get("/api/graph", params={
        "date_from": "2026-02-19",
        "date_to": "2026-02-19",
    })
    assert response.status_code == 200
    data = response.json()
    assert len(data["nodes"]) == 2
    assert len(data["edges"]) == 1
    edge = data["edges"][0]
    assert edge["source_topic_id"] == t1["id"]
    assert edge["target_topic_id"] == t2["id"]
    assert edge["strength"] == 1.0


@pytest.mark.asyncio
async def test_get_graph_filter_by_date(client: AsyncClient):
    await create_topic(client, title="Early Topic", date="2026-01-01")
    await create_topic(client, title="Mid Topic", date="2026-02-15")
    await create_topic(client, title="Late Topic", date="2026-03-01")

    response = await client.get("/api/graph", params={
        "date_from": "2026-02-01",
        "date_to": "2026-02-28",
    })
    assert response.status_code == 200
    data = response.json()
    titles = {n["title"] for n in data["nodes"]}
    assert titles == {"Mid Topic"}


@pytest.mark.asyncio
async def test_get_graph_filter_by_entity(client: AsyncClient):
    await create_topic(client, title="Claude AI Discussion", summary="About Claude models")
    await create_topic(client, title="Unrelated Topic", summary="Nothing special here")

    response = await client.get("/api/graph", params={"entity": "Claude"})
    assert response.status_code == 200
    data = response.json()
    titles = {n["title"] for n in data["nodes"]}
    assert "Claude AI Discussion" in titles
    assert "Unrelated Topic" not in titles


@pytest.mark.asyncio
async def test_search_topics(client: AsyncClient):
    await create_topic(client, title="Claude 4 Release", summary="New Claude model released")
    await create_topic(client, title="GPT-5 News", summary="OpenAI announcements")

    response = await client.get("/api/graph/search", params={"q": "Claude"})
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["title"] == "Claude 4 Release"


@pytest.mark.asyncio
async def test_search_topics_empty(client: AsyncClient):
    await create_topic(client, title="Some Topic", summary="Some summary")

    response = await client.get("/api/graph/search", params={"q": "nonexistent_xyz_123"})
    assert response.status_code == 200
    data = response.json()
    assert data == []


@pytest.mark.asyncio
async def test_manual_link_topics(client: AsyncClient):
    t1 = await create_topic(client, title="Source Topic")
    t2 = await create_topic(client, title="Target Topic")

    response = await client.post("/api/graph/link", json={
        "source_topic_id": t1["id"],
        "target_topic_id": t2["id"],
        "relationship_type": "related",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["source_topic_id"] == t1["id"]
    assert data["target_topic_id"] == t2["id"]
    assert data["relationship_type"] == "related"
    assert data["strength"] == 1.0
    assert data["id"] is not None


@pytest.mark.asyncio
async def test_manual_link_404(client: AsyncClient):
    t1 = await create_topic(client, title="Existing Topic")

    # Non-existent target
    response = await client.post("/api/graph/link", json={
        "source_topic_id": t1["id"],
        "target_topic_id": 99999,
        "relationship_type": "manual",
    })
    assert response.status_code == 404

    # Non-existent source
    response = await client.post("/api/graph/link", json={
        "source_topic_id": 99999,
        "target_topic_id": t1["id"],
        "relationship_type": "manual",
    })
    assert response.status_code == 404
