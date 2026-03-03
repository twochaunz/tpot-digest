from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles

import app.db as db_module
from app.db import Base, get_db
from app.main import app

# Import all models so Base.metadata knows about them
from app.models import Tweet, Topic, TweetAssignment, Subscriber, DigestDraft  # noqa: F401


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
    _orig_session = db_module.async_session
    db_module.async_session = async_session
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    app.dependency_overrides.pop(get_db, None)
    db_module.async_session = _orig_session


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_create_digest_draft(client: AsyncClient):
    resp = await client.post("/api/digest/drafts", json={
        "date": "2026-03-01",
        "topic_ids": [1, 2],
        "intro_text": "Hello readers",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["status"] == "draft"
    assert data["topic_ids"] == [1, 2]
    assert data["intro_text"] == "Hello readers"


@pytest.mark.asyncio
async def test_update_digest_draft(client: AsyncClient):
    # Create a draft first
    create_resp = await client.post("/api/digest/drafts", json={
        "date": "2026-03-01",
        "topic_ids": [1],
    })
    draft_id = create_resp.json()["id"]

    # Update it
    resp = await client.patch(f"/api/digest/drafts/{draft_id}", json={
        "intro_text": "Updated intro",
        "topic_notes": {"1": "Note about topic 1"},
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["intro_text"] == "Updated intro"
    assert data["topic_notes"]["1"] == "Note about topic 1"


@pytest.mark.asyncio
async def test_preview_digest(client: AsyncClient):
    # Seed a topic and tweet
    today = date.today()
    async with async_session() as session:
        topic = Topic(title="Test Topic", date=today, position=0)
        session.add(topic)
        await session.commit()
        await session.refresh(topic)

        tweet = Tweet(
            tweet_id="preview_1",
            author_handle="testuser",
            author_display_name="Test User",
            text="Preview tweet text",
            engagement={"likes": 100, "retweets": 50},
            url="https://x.com/testuser/status/1",
        )
        session.add(tweet)
        await session.commit()
        await session.refresh(tweet)

        assignment = TweetAssignment(tweet_id=tweet.id, topic_id=topic.id)
        session.add(assignment)
        await session.commit()

        topic_id = topic.id

    # Create draft with that topic
    create_resp = await client.post("/api/digest/drafts", json={
        "date": today.isoformat(),
        "topic_ids": [topic_id],
    })
    draft_id = create_resp.json()["id"]

    # Preview
    resp = await client.get(f"/api/digest/drafts/{draft_id}/preview")
    assert resp.status_code == 200
    data = resp.json()
    assert "Test Topic" in data["html"]
    assert "testuser" in data["html"]
    assert "Preview tweet text" in data["html"]
    assert data["subject"].startswith("abridged")


@pytest.mark.asyncio
async def test_delete_draft(client: AsyncClient):
    create_resp = await client.post("/api/digest/drafts", json={
        "date": "2026-03-01",
        "topic_ids": [],
    })
    draft_id = create_resp.json()["id"]

    resp = await client.delete(f"/api/digest/drafts/{draft_id}")
    assert resp.status_code == 204

    # Verify it's gone
    get_resp = await client.get(f"/api/digest/drafts/{draft_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_cannot_edit_sent_draft(client: AsyncClient):
    # Create a draft and mark it as sent directly in DB
    create_resp = await client.post("/api/digest/drafts", json={
        "date": "2026-03-01",
        "topic_ids": [],
    })
    draft_id = create_resp.json()["id"]

    async with async_session() as session:
        draft = await session.get(DigestDraft, draft_id)
        draft.status = "sent"
        draft.sent_at = datetime.now(timezone.utc)
        await session.commit()

    # Try to update
    resp = await client.patch(f"/api/digest/drafts/{draft_id}", json={
        "intro_text": "Should fail",
    })
    assert resp.status_code == 400
