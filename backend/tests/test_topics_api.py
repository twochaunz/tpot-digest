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
from app.models.topic import SubTopic, SubTopicTweet, Topic  # noqa: F401 — registers models
from app.models.tweet import Tweet  # noqa: F401 — FK target for subtopic_tweets


# ---------------------------------------------------------------------------
# Compilation shims for SQLite compatibility
# ---------------------------------------------------------------------------
# PostgreSQL's JSONB type is not supported by the SQLite dialect.  We register
# a custom compilation rule so that SQLAlchemy emits "JSON" instead of "JSONB"
# when targeting SQLite.

from sqlalchemy.ext.compiler import compiles  # noqa: E402


@compiles(JSONB, "sqlite")
def _compile_jsonb_as_json(type_, compiler, **kw):
    return compiler.visit_JSON(type_, **kw)


# pgvector's Vector type is not supported by SQLite.  We compile it as BLOB
# so that table creation succeeds.  We never actually store/query embeddings
# in tests.

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
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_topic(client: AsyncClient):
    payload = {
        "date": "2026-02-19",
        "title": "AI Alignment Debate",
        "summary": "Discussion on AI safety approaches",
        "rank": 1,
        "lifecycle_status": "emerging",
        "sentiment": "mixed",
        "tags": {"category": "ai"},
    }
    response = await client.post("/api/topics", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "AI Alignment Debate"
    assert data["date"] == "2026-02-19"
    assert data["rank"] == 1
    assert data["lifecycle_status"] == "emerging"
    assert data["sentiment"] == "mixed"
    assert data["tags"] == {"category": "ai"}
    assert data["subtopics"] == []
    assert data["id"] is not None
    assert data["created_at"] is not None


@pytest.mark.asyncio
async def test_list_topics_by_date(client: AsyncClient):
    # Create topics for two different dates
    await client.post("/api/topics", json={
        "date": "2026-02-19",
        "title": "Topic A",
        "rank": 2,
    })
    await client.post("/api/topics", json={
        "date": "2026-02-19",
        "title": "Topic B",
        "rank": 1,
    })
    await client.post("/api/topics", json={
        "date": "2026-02-18",
        "title": "Topic C",
        "rank": 1,
    })

    # List for 2026-02-19 — should get 2 topics ordered by rank
    response = await client.get("/api/topics", params={"date": "2026-02-19"})
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    assert data[0]["title"] == "Topic B"  # rank 1 first
    assert data[1]["title"] == "Topic A"  # rank 2 second

    # List for 2026-02-18 — should get 1 topic
    response = await client.get("/api/topics", params={"date": "2026-02-18"})
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["title"] == "Topic C"


@pytest.mark.asyncio
async def test_get_topic_detail_with_subtopics(client: AsyncClient):
    # Create a topic
    resp = await client.post("/api/topics", json={
        "date": "2026-02-19",
        "title": "Topic with subtopics",
    })
    topic_id = resp.json()["id"]

    # Add a subtopic
    await client.post(f"/api/topics/{topic_id}/subtopics", json={
        "title": "SubTopic Alpha",
        "summary": "First subtopic",
        "rank": 1,
    })

    # Get topic detail
    response = await client.get(f"/api/topics/{topic_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Topic with subtopics"
    assert len(data["subtopics"]) == 1
    assert data["subtopics"][0]["title"] == "SubTopic Alpha"
    assert data["subtopics"][0]["summary"] == "First subtopic"


@pytest.mark.asyncio
async def test_update_topic_lifecycle_status(client: AsyncClient):
    # Create a topic
    resp = await client.post("/api/topics", json={
        "date": "2026-02-19",
        "title": "Evolving Topic",
    })
    topic_id = resp.json()["id"]
    assert resp.json()["lifecycle_status"] == "emerging"

    # Update lifecycle_status
    response = await client.patch(f"/api/topics/{topic_id}", json={
        "lifecycle_status": "trending",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["lifecycle_status"] == "trending"


@pytest.mark.asyncio
async def test_create_subtopic(client: AsyncClient):
    # Create a topic first
    resp = await client.post("/api/topics", json={
        "date": "2026-02-19",
        "title": "Parent Topic",
    })
    topic_id = resp.json()["id"]

    # Create a subtopic under it
    payload = {
        "title": "Child SubTopic",
        "summary": "A subtopic summary",
        "sentiment": "positive",
        "rank": 5,
    }
    response = await client.post(f"/api/topics/{topic_id}/subtopics", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Child SubTopic"
    assert data["summary"] == "A subtopic summary"
    assert data["sentiment"] == "positive"
    assert data["rank"] == 5
    assert data["topic_id"] == topic_id
    assert data["id"] is not None


@pytest.mark.asyncio
async def test_link_tweet_to_subtopic(client: AsyncClient):
    # Create a tweet first (needed as FK target)
    tweet_resp = await client.post("/api/tweets", json={
        "tweet_id": "9999",
        "author_handle": "testuser",
        "text": "A relevant tweet",
    })
    tweet_pk = tweet_resp.json()["id"]

    # Create a topic and subtopic
    topic_resp = await client.post("/api/topics", json={
        "date": "2026-02-19",
        "title": "Link Test Topic",
    })
    topic_id = topic_resp.json()["id"]

    sub_resp = await client.post(f"/api/topics/{topic_id}/subtopics", json={
        "title": "Link Test SubTopic",
    })
    subtopic_id = sub_resp.json()["id"]

    # Link the tweet to the subtopic
    response = await client.post(f"/api/subtopics/{subtopic_id}/tweets", json={
        "tweet_id": tweet_pk,
        "relevance_score": 0.85,
        "stance": "supportive",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["subtopic_id"] == subtopic_id
    assert data["tweet_id"] == tweet_pk
    assert data["relevance_score"] == 0.85
    assert data["stance"] == "supportive"
