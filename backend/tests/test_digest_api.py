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
        "content_blocks": [
            {"id": "b1", "type": "text", "content": "Hello readers"},
            {"id": "b2", "type": "topic-header", "topic_id": 1},
        ],
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["status"] == "draft"
    assert len(data["content_blocks"]) == 2
    assert data["content_blocks"][0]["type"] == "text"
    assert data["content_blocks"][0]["content"] == "Hello readers"
    assert data["content_blocks"][1]["type"] == "topic-header"
    assert data["content_blocks"][1]["topic_id"] == 1


@pytest.mark.asyncio
async def test_update_digest_draft(client: AsyncClient):
    # Create a draft first
    create_resp = await client.post("/api/digest/drafts", json={
        "date": "2026-03-01",
        "content_blocks": [
            {"id": "b1", "type": "topic-header", "topic_id": 1},
        ],
    })
    draft_id = create_resp.json()["id"]

    # Update it
    resp = await client.patch(f"/api/digest/drafts/{draft_id}", json={
        "content_blocks": [
            {"id": "b0", "type": "text", "content": "Updated intro"},
            {"id": "b1", "type": "topic-header", "topic_id": 1},
        ],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["content_blocks"]) == 2
    assert data["content_blocks"][0]["content"] == "Updated intro"
    assert data["content_blocks"][1]["topic_id"] == 1


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

    # Create draft with topic-header + tweet blocks
    create_resp = await client.post("/api/digest/drafts", json={
        "date": today.isoformat(),
        "content_blocks": [
            {"id": "b1", "type": "topic-header", "topic_id": topic_id},
            {"id": "b2", "type": "tweet", "tweet_id": tweet.id},
        ],
    })
    draft_id = create_resp.json()["id"]

    # Preview
    resp = await client.get(f"/api/digest/drafts/{draft_id}/preview")
    assert resp.status_code == 200
    data = resp.json()
    assert "Test Topic" in data["html"]
    assert "testuser" in data["html"]
    assert "Preview tweet text" in data["html"]
    assert "abridged tech" in data["subject"]


@pytest.mark.asyncio
async def test_preview_standalone_tweet_block(client: AsyncClient):
    """A tweet block should render the tweet in the email preview."""
    today = date.today()
    async with async_session() as session:
        tweet = Tweet(
            tweet_id="standalone_1",
            author_handle="solo",
            author_display_name="Solo Author",
            text="Standalone tweet text",
            engagement={"likes": 42},
            url="https://x.com/solo/status/99",
        )
        session.add(tweet)
        await session.commit()
        await session.refresh(tweet)
        tweet_db_id = tweet.id

    create_resp = await client.post("/api/digest/drafts", json={
        "date": today.isoformat(),
        "content_blocks": [
            {"id": "b1", "type": "tweet", "tweet_id": tweet_db_id},
        ],
    })
    draft_id = create_resp.json()["id"]

    resp = await client.get(f"/api/digest/drafts/{draft_id}/preview")
    assert resp.status_code == 200
    data = resp.json()
    assert "solo" in data["html"]
    assert "Standalone tweet text" in data["html"]


@pytest.mark.asyncio
async def test_delete_draft(client: AsyncClient):
    create_resp = await client.post("/api/digest/drafts", json={
        "date": "2026-03-01",
        "content_blocks": [],
    })
    draft_id = create_resp.json()["id"]

    resp = await client.delete(f"/api/digest/drafts/{draft_id}")
    assert resp.status_code == 204

    # Verify it's gone
    get_resp = await client.get(f"/api/digest/drafts/{draft_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_preview_divider_block(client: AsyncClient):
    """A divider block should render as an hr in the preview."""
    today = date.today()
    create_resp = await client.post("/api/digest/drafts", json={
        "date": today.isoformat(),
        "content_blocks": [
            {"id": "b1", "type": "text", "content": "Before divider"},
            {"id": "b2", "type": "divider"},
            {"id": "b3", "type": "text", "content": "After divider"},
        ],
    })
    draft_id = create_resp.json()["id"]
    resp = await client.get(f"/api/digest/drafts/{draft_id}/preview")
    assert resp.status_code == 200
    data = resp.json()
    assert "<hr" in data["html"]
    assert "Before divider" in data["html"]
    assert "After divider" in data["html"]


@pytest.mark.asyncio
async def test_preview_markdown_text_block(client: AsyncClient):
    """Text blocks with markdown should render as HTML in the email."""
    today = date.today()
    create_resp = await client.post("/api/digest/drafts", json={
        "date": today.isoformat(),
        "content_blocks": [
            {"id": "b1", "type": "text", "content": "Hello **bold** and [a link](https://example.com)"},
        ],
    })
    draft_id = create_resp.json()["id"]
    resp = await client.get(f"/api/digest/drafts/{draft_id}/preview")
    assert resp.status_code == 200
    data = resp.json()
    assert "<strong>bold</strong>" in data["html"]
    assert 'href="https://example.com"' in data["html"]


@pytest.mark.asyncio
async def test_preview_tweet_engagement_toggle(client: AsyncClient):
    """Tweet blocks with show_engagement=true should include engagement in preview."""
    today = date.today()
    async with async_session() as session:
        tweet = Tweet(
            tweet_id="engage_1",
            author_handle="engager",
            author_display_name="Engager",
            text="Engagement test",
            engagement={"likes": 500, "retweets": 100},
            url="https://x.com/engager/status/1",
        )
        session.add(tweet)
        await session.commit()
        await session.refresh(tweet)
        tweet_db_id = tweet.id

    # Without engagement (default)
    create_resp = await client.post("/api/digest/drafts", json={
        "date": today.isoformat(),
        "content_blocks": [
            {"id": "b1", "type": "tweet", "tweet_id": tweet_db_id, "show_engagement": False},
        ],
    })
    draft_id = create_resp.json()["id"]
    resp = await client.get(f"/api/digest/drafts/{draft_id}/preview")
    data = resp.json()
    # Engagement should NOT appear
    assert "500" not in data["html"]

    # With engagement
    await client.patch(f"/api/digest/drafts/{draft_id}", json={
        "content_blocks": [
            {"id": "b1", "type": "tweet", "tweet_id": tweet_db_id, "show_engagement": True},
        ],
    })
    resp = await client.get(f"/api/digest/drafts/{draft_id}/preview")
    data = resp.json()
    # Engagement should appear
    assert "500" in data["html"]


@pytest.mark.asyncio
async def test_editing_sent_draft_resets_to_draft(client: AsyncClient):
    # Create a draft and mark it as sent directly in DB
    create_resp = await client.post("/api/digest/drafts", json={
        "date": "2026-03-01",
        "content_blocks": [],
    })
    draft_id = create_resp.json()["id"]

    async with async_session() as session:
        draft = await session.get(DigestDraft, draft_id)
        draft.status = "sent"
        draft.sent_at = datetime.now(timezone.utc)
        await session.commit()

    # Editing a sent draft should succeed and reset status to draft
    resp = await client.patch(f"/api/digest/drafts/{draft_id}", json={
        "content_blocks": [{"id": "b1", "type": "text", "content": "Updated"}],
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "draft"
