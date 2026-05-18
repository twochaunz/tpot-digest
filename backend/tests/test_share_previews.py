from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport
from httpx import AsyncClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles

import app.db as db_module
from app.db import Base, get_db
from app.main import app
from app.models import Topic, Tweet, TweetAssignment


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
    original_session = db_module.async_session
    db_module.async_session = async_session
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    app.dependency_overrides.pop(get_db, None)
    db_module.async_session = original_session


@pytest_asyncio.fixture(autouse=True)
def mock_fetch_tweet():
    mock = AsyncMock()
    with patch("app.services.x_api.fetch_tweet", mock):
        yield mock


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def _seed_topic_with_og(
    *,
    title: str = "AI Lab Launch",
    tweet_text: str = "Big launch today <watch this>",
    media_urls=None,
):
    async with db_module.async_session() as db:
        tweet = Tweet(
            tweet_id="1234567890",
            author_handle="founder",
            author_display_name="Founder",
            author_avatar_url=None,
            author_verified=False,
            text=tweet_text,
            media_urls=media_urls if media_urls is not None else [],
            engagement={},
            url_entities=[],
            is_quote_tweet=False,
            is_reply=False,
            saved_at=datetime(2026, 5, 17, 18, 0, tzinfo=timezone.utc),
        )
        db.add(tweet)
        await db.flush()

        topic = Topic(
            title=title,
            date=date(2026, 5, 17),
            color="#3b82f6",
            position=0,
            og_tweet_id=tweet.id,
        )
        db.add(topic)
        await db.flush()

        db.add(TweetAssignment(tweet_id=tweet.id, topic_id=topic.id))
        await db.commit()
        return topic.id, tweet.id


@pytest.mark.asyncio
async def test_topic_preview_uses_og_tweet_media_image(client: AsyncClient):
    await _seed_topic_with_og(media_urls=["https://pbs.twimg.com/media/example.jpg"])

    resp = await client.get("/app/20260517/1")

    assert resp.status_code == 200
    html = resp.text
    assert 'property="og:title" content="AI Lab Launch"' in html
    assert 'property="og:image" content="https://pbs.twimg.com/media/example.jpg"' in html
    assert 'name="twitter:card" content="summary_large_image"' in html
    assert "Big launch today &lt;watch this&gt;" in html


@pytest.mark.asyncio
async def test_topic_preview_uses_generated_image_for_text_only_og(client: AsyncClient):
    await _seed_topic_with_og(media_urls=[])

    resp = await client.get("/app/20260517/1")

    assert resp.status_code == 200
    assert (
        'property="og:image" content="https://abridged.tech/api/og/topic/20260517/1.png"'
        in resp.text
    )


@pytest.mark.asyncio
async def test_topic_preview_falls_back_for_missing_topic(client: AsyncClient):
    resp = await client.get("/app/20260517/99")

    assert resp.status_code == 200
    assert 'property="og:title" content="abridged tech"' in resp.text
    assert 'property="og:image" content="https://abridged.tech/og-image.png"' in resp.text


@pytest.mark.asyncio
async def test_generated_topic_image_returns_png(client: AsyncClient):
    await _seed_topic_with_og(tweet_text='Text with <script>alert("x")</script>', media_urls=[])

    resp = await client.get("/api/og/topic/20260517/1.png")

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("image/png")
    assert resp.content.startswith(b"\x89PNG\r\n\x1a\n")
