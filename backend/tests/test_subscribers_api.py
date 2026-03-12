import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles

from app.db import Base, get_db
from app.main import app

# Import all models so Base.metadata knows about them
from app.models import Tweet, Topic, TweetAssignment, Subscriber, DigestDraft, UnsubscribeEvent  # noqa: F401


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
async def test_subscribe(client: AsyncClient):
    resp = await client.post("/api/subscribers", json={"email": "test@example.com"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["message"] == "Subscribed"
    assert data["already_registered"] is False



@pytest.mark.asyncio
async def test_subscribe_duplicate(client: AsyncClient):
    resp1 = await client.post("/api/subscribers", json={"email": "dup@example.com"})
    assert resp1.status_code == 201

    resp2 = await client.post("/api/subscribers", json={"email": "dup@example.com"})
    assert resp2.status_code == 200
    data = resp2.json()
    assert data["already_registered"] is True


@pytest.mark.asyncio
async def test_unsubscribe(client: AsyncClient):
    # Create subscriber directly
    from app.models.subscriber import Subscriber
    import secrets

    unsub_token = secrets.token_hex(32)
    async with async_session() as session:
        sub = Subscriber(
            email="unsub@example.com",
            unsubscribe_token=unsub_token,
        )
        session.add(sub)
        await session.commit()

    resp = await client.get(f"/api/subscribers/unsubscribe?token={unsub_token}")
    assert resp.status_code == 200
    assert "Unsubscribed" in resp.text

    # Verify unsubscribed_at is set
    async with async_session() as session:
        from sqlalchemy import select
        result = await session.execute(
            select(Subscriber).where(Subscriber.email == "unsub@example.com")
        )
        sub = result.scalar_one()
        assert sub.unsubscribed_at is not None


@pytest.mark.asyncio
async def test_unsubscribe_with_digest_param(client: AsyncClient):
    """Unsubscribing with digest param creates an UnsubscribeEvent with draft_id."""
    import secrets
    from app.models.unsubscribe_event import UnsubscribeEvent

    unsub_token = secrets.token_hex(32)
    async with async_session() as session:
        sub = Subscriber(email="unsub-digest@example.com", unsubscribe_token=unsub_token)
        session.add(sub)
        await session.commit()
        sub_id = sub.id

    resp = await client.get(f"/api/subscribers/unsubscribe?token={unsub_token}&digest=42")
    assert resp.status_code == 200
    assert "Unsubscribed" in resp.text

    async with async_session() as session:
        from sqlalchemy import select
        result = await session.execute(select(Subscriber).where(Subscriber.id == sub_id))
        sub = result.scalar_one()
        assert sub.unsubscribed_at is not None

        events = await session.execute(
            select(UnsubscribeEvent).where(UnsubscribeEvent.subscriber_id == sub_id)
        )
        event = events.scalar_one()
        assert event.draft_id == 42
        assert event.unsubscribed_at is not None


@pytest.mark.asyncio
async def test_unsubscribe_without_digest_param(client: AsyncClient):
    """Unsubscribing without digest param creates an event with draft_id=None."""
    import secrets
    from app.models.unsubscribe_event import UnsubscribeEvent

    unsub_token = secrets.token_hex(32)
    async with async_session() as session:
        sub = Subscriber(email="unsub-nodigest@example.com", unsubscribe_token=unsub_token)
        session.add(sub)
        await session.commit()
        sub_id = sub.id

    resp = await client.get(f"/api/subscribers/unsubscribe?token={unsub_token}")
    assert resp.status_code == 200

    async with async_session() as session:
        from sqlalchemy import select
        events = await session.execute(
            select(UnsubscribeEvent).where(UnsubscribeEvent.subscriber_id == sub_id)
        )
        event = events.scalar_one()
        assert event.draft_id is None


@pytest.mark.asyncio
async def test_unsubscribe_idempotent(client: AsyncClient):
    """Clicking unsubscribe twice does not create a duplicate event."""
    import secrets
    from sqlalchemy import select, func
    from app.models.unsubscribe_event import UnsubscribeEvent

    unsub_token = secrets.token_hex(32)
    async with async_session() as session:
        sub = Subscriber(email="unsub-idem@example.com", unsubscribe_token=unsub_token)
        session.add(sub)
        await session.commit()
        sub_id = sub.id

    await client.get(f"/api/subscribers/unsubscribe?token={unsub_token}&digest=10")
    await client.get(f"/api/subscribers/unsubscribe?token={unsub_token}&digest=10")

    async with async_session() as session:
        count = await session.execute(
            select(func.count()).select_from(UnsubscribeEvent).where(
                UnsubscribeEvent.subscriber_id == sub_id
            )
        )
        assert count.scalar() == 1


@pytest.mark.asyncio
async def test_resubscribe(client: AsyncClient):
    """A previously unsubscribed user can re-subscribe by signing up again."""
    import secrets
    from datetime import datetime, timezone

    unsub_token = secrets.token_hex(32)
    async with async_session() as session:
        sub = Subscriber(
            email="resub@example.com",
            unsubscribe_token=unsub_token,
            unsubscribed_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        )
        session.add(sub)
        await session.commit()
        original_token = sub.unsubscribe_token

    resp = await client.post("/api/subscribers", json={"email": "resub@example.com"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["message"] == "Re-subscribed"
    assert data["re_subscribed"] is True

    async with async_session() as session:
        from sqlalchemy import select
        result = await session.execute(
            select(Subscriber).where(Subscriber.email == "resub@example.com")
        )
        sub = result.scalar_one()
        assert sub.unsubscribed_at is None
        assert sub.unsubscribe_token == original_token


@pytest.mark.asyncio
async def test_email_service_renders_template():
    from app.services.email import render_digest_email

    blocks = [
        {
            "type": "text",
            "content": "Welcome to today's digest",
        },
        {
            "type": "topic-header",
            "title": "AI News",
            "topic_number": 1,
        },
        {
            "type": "tweet",
            "author_handle": "karpathy",
            "author_display_name": "Andrej Karpathy",
            "author_avatar_url": "https://example.com/avatar.jpg",
            "text": "Claude 4 is amazing",
            "url": "https://x.com/karpathy/status/123",
            "show_engagement": False,
        },
    ]

    html = render_digest_email(
        date_str="March 1, 2026",
        blocks=blocks,
        unsubscribe_url="https://example.com/unsubscribe",
    )

    assert "AI News" in html
    assert "karpathy" in html
    assert "Claude 4 is amazing" in html
    assert "https://example.com/unsubscribe" in html
    assert "March 1, 2026" in html
    assert "Welcome to today" in html
