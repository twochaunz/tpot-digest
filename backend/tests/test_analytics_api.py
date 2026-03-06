from datetime import date, datetime, timezone

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
from app.models import Tweet, Topic, TweetAssignment, Subscriber, DigestDraft, DigestSendLog, EmailEvent  # noqa: F401


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


async def _seed_data():
    async with async_session() as session:
        draft = DigestDraft(
            date=date(2026, 3, 6),
            content_blocks=[],
            status="sent",
            sent_at=datetime(2026, 3, 6, 12, 0, tzinfo=timezone.utc),
            recipient_count=2,
            subject="Test Digest",
        )
        session.add(draft)
        sub1 = Subscriber(email="alice@test.com", unsubscribe_token="tok1")
        sub2 = Subscriber(email="bob@test.com", unsubscribe_token="tok2")
        session.add_all([sub1, sub2])
        await session.flush()

        log1 = DigestSendLog(
            draft_id=draft.id, subscriber_id=sub1.id,
            email="alice@test.com", status="sent", resend_message_id="msg-1",
        )
        log2 = DigestSendLog(
            draft_id=draft.id, subscriber_id=sub2.id,
            email="bob@test.com", status="sent", resend_message_id="msg-2",
        )
        session.add_all([log1, log2])
        await session.flush()

        now = datetime(2026, 3, 6, 13, 0, tzinfo=timezone.utc)
        events = [
            EmailEvent(send_log_id=log1.id, draft_id=draft.id, subscriber_id=sub1.id,
                       event_type="delivered", event_at=now, svix_id="ev-1"),
            EmailEvent(send_log_id=log2.id, draft_id=draft.id, subscriber_id=sub2.id,
                       event_type="delivered", event_at=now, svix_id="ev-2"),
            EmailEvent(send_log_id=log1.id, draft_id=draft.id, subscriber_id=sub1.id,
                       event_type="opened", event_at=now, svix_id="ev-3"),
            EmailEvent(send_log_id=log1.id, draft_id=draft.id, subscriber_id=sub1.id,
                       event_type="clicked", link_url="https://x.com/post/123",
                       event_at=now, svix_id="ev-4"),
            EmailEvent(send_log_id=log1.id, draft_id=draft.id, subscriber_id=sub1.id,
                       event_type="clicked", link_url="https://x.com/post/123",
                       event_at=now, svix_id="ev-5"),
            EmailEvent(send_log_id=log1.id, draft_id=draft.id, subscriber_id=sub1.id,
                       event_type="clicked", link_url="https://example.com",
                       event_at=now, svix_id="ev-6"),
        ]
        session.add_all(events)
        await session.commit()
        return draft.id


@pytest.mark.asyncio
async def test_analytics_overview(client: AsyncClient):
    await _seed_data()
    resp = await client.get("/api/analytics/overview")
    assert resp.status_code == 200
    data = resp.json()
    assert data["subscriber_count"] >= 2
    assert data["last_digest"] is not None
    assert data["last_digest"]["click_rate"] == 150.0
    assert "open_rate" not in data["last_digest"]


@pytest.mark.asyncio
async def test_analytics_digests(client: AsyncClient):
    await _seed_data()
    resp = await client.get("/api/analytics/digests")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["recipients"] == 2
    assert data[0]["clicks"] == 3
    assert "opens" not in data[0]


@pytest.mark.asyncio
async def test_analytics_digest_detail(client: AsyncClient):
    draft_id = await _seed_data()
    resp = await client.get(f"/api/analytics/digests/{draft_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["top_links"]) == 2
    assert data["top_links"][0]["count"] == 2
    assert len(data["subscribers"]) == 2


@pytest.mark.asyncio
async def test_analytics_subscribers(client: AsyncClient):
    await _seed_data()
    resp = await client.get("/api/analytics/subscribers")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    alice = next(s for s in data if s["email"] == "alice@test.com")
    assert alice["click_rate"] == 300.0
    assert "open_rate" not in alice
    bob = next(s for s in data if s["email"] == "bob@test.com")
    assert bob["click_rate"] == 0.0
