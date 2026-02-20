import pytest
import pytest_asyncio
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from pgvector.sqlalchemy import Vector

from app.db import Base, get_db
from app.main import app
from app.models.account import Account, AccountSource
from app.models.article import Article
from app.models.screenshot import Screenshot
from app.models.topic import Topic, SubTopic, SubTopicTweet, TopicEdge
from app.models.tweet import Tweet


@compiles(JSONB, "sqlite")
def _compile_jsonb_as_json(type_, compiler, **kw):
    return compiler.visit_JSON(type_, **kw)


@compiles(Vector, "sqlite")
def _compile_vector_as_blob(type_, compiler, **kw):
    return "BLOB"


TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
engine_test = create_async_engine(TEST_DATABASE_URL, echo=False)
async_session_test = async_sessionmaker(engine_test, expire_on_commit=False)


async def override_get_db():
    async with async_session_test() as session:
        yield session


@pytest_asyncio.fixture(autouse=True)
async def setup_database():
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
    from httpx import ASGITransport, AsyncClient
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_discover_empty():
    from app.pipeline.discovery import discover_accounts
    async with async_session_test() as db:
        results = await discover_accounts(db)
        assert results == []


@pytest.mark.asyncio
async def test_discover_accounts_finds_frequent():
    from app.pipeline.discovery import discover_accounts
    async with async_session_test() as db:
        # Add a seed account
        db.add(Account(handle="seed_user", source=AccountSource.SEED))

        # Add tweets from a non-tracked author (3+ appearances with quality scores)
        for i in range(4):
            db.add(Tweet(
                tweet_id=f"disc_{i}",
                author_handle="discovered_user",
                text=f"Great tech content {i}",
                quality_score=0.8,
            ))
        # Add tweets from seed user (should be excluded)
        for i in range(5):
            db.add(Tweet(
                tweet_id=f"seed_{i}",
                author_handle="seed_user",
                text=f"Seed tweet {i}",
                quality_score=0.9,
            ))
        await db.commit()

        results = await discover_accounts(db, min_appearances=3)
        assert len(results) >= 1
        handles = [r["handle"] for r in results]
        assert "discovered_user" in handles
        assert "seed_user" not in handles


@pytest.mark.asyncio
async def test_discover_below_min_appearances():
    from app.pipeline.discovery import discover_accounts
    async with async_session_test() as db:
        # Only 2 tweets (below min_appearances=3)
        for i in range(2):
            db.add(Tweet(
                tweet_id=f"few_{i}",
                author_handle="rare_user",
                text=f"Occasional tweet {i}",
                quality_score=0.7,
            ))
        await db.commit()

        results = await discover_accounts(db, min_appearances=3)
        assert len(results) == 0


@pytest.mark.asyncio
async def test_approve_discovery():
    from app.pipeline.discovery import approve_discovery
    async with async_session_test() as db:
        account = await approve_discovery(db, "new_user", priority=4)
        assert account.handle == "new_user"
        assert account.source == AccountSource.AUTO_DISCOVERED
        assert account.is_active is True
        assert account.priority == 4


@pytest.mark.asyncio
async def test_reject_discovery():
    from app.pipeline.discovery import reject_discovery
    async with async_session_test() as db:
        account = await reject_discovery(db, "spam_user")
        assert account.handle == "spam_user"
        assert account.is_blocked is True
        assert account.is_active is False


@pytest.mark.asyncio
async def test_api_get_suggestions(client):
    response = await client.get("/api/discovery")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.asyncio
async def test_api_approve(client):
    response = await client.post("/api/discovery/approve", params={"handle": "test_user"})
    assert response.status_code == 200
    data = response.json()
    assert data["handle"] == "test_user"
    assert data["source"] == "auto_discovered"


@pytest.mark.asyncio
async def test_api_reject(client):
    response = await client.post("/api/discovery/reject", params={"handle": "bad_user"})
    assert response.status_code == 200
    data = response.json()
    assert data["is_blocked"] is True
