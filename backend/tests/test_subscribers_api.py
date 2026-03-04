import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles

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
