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


# -- Task 1: Block edits to sent drafts --

@pytest.mark.asyncio
async def test_patch_sent_draft_rejected(client: AsyncClient):
    """PATCH on a sent draft should return 400."""
    r = await client.post("/api/digest/drafts", json={"date": "2026-01-01", "content_blocks": []})
    assert r.status_code == 201
    draft_id = r.json()["id"]

    # Mark as sent via direct DB update
    async with async_session() as session:
        from sqlalchemy import text
        await session.execute(text(
            f"UPDATE digest_drafts SET status='sent', sent_at=CURRENT_TIMESTAMP, recipient_count=10 WHERE id={draft_id}"
        ))
        await session.commit()

    r = await client.patch(f"/api/digest/drafts/{draft_id}", json={"subject": "new subject"})
    assert r.status_code == 400
    assert "Cannot edit a sent draft" in r.json()["detail"]


@pytest.mark.asyncio
async def test_patch_draft_still_works(client: AsyncClient):
    """PATCH on a non-sent draft should still work."""
    r = await client.post("/api/digest/drafts", json={"date": "2026-01-01", "content_blocks": []})
    assert r.status_code == 201
    draft_id = r.json()["id"]

    r = await client.patch(f"/api/digest/drafts/{draft_id}", json={"subject": "new subject"})
    assert r.status_code == 200
    assert r.json()["subject"] == "new subject"


# -- Task 2: Duplicate draft endpoint --

@pytest.mark.asyncio
async def test_duplicate_sent_draft(client: AsyncClient):
    """POST duplicate creates a new draft from a sent draft."""
    r = await client.post("/api/digest/drafts", json={
        "date": "2026-01-15",
        "content_blocks": [{"id": "b1", "type": "text", "content": "hello"}],
        "subject": "Original Subject",
    })
    assert r.status_code == 201
    original_id = r.json()["id"]

    # Mark as sent
    async with async_session() as session:
        from sqlalchemy import text
        await session.execute(text(
            f"UPDATE digest_drafts SET status='sent', sent_at=CURRENT_TIMESTAMP, recipient_count=42 WHERE id={original_id}"
        ))
        await session.commit()

    r = await client.post(f"/api/digest/drafts/{original_id}/duplicate")
    assert r.status_code == 201
    new_draft = r.json()
    assert new_draft["id"] != original_id
    assert new_draft["date"] == "2026-01-15"
    assert new_draft["subject"] == "Original Subject"
    assert new_draft["status"] == "draft"
    assert new_draft["sent_at"] is None
    assert new_draft["recipient_count"] is None
    assert len(new_draft["content_blocks"]) == 1
    assert new_draft["content_blocks"][0]["content"] == "hello"


@pytest.mark.asyncio
async def test_duplicate_nonexistent_draft(client: AsyncClient):
    """POST duplicate on nonexistent draft returns 404."""
    r = await client.post("/api/digest/drafts/99999/duplicate")
    assert r.status_code == 404
