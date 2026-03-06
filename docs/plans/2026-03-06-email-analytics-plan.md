# Email Analytics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add open/click tracking via Resend webhooks with a dedicated analytics dashboard.

**Architecture:** Resend handles tracking pixel injection and link rewriting automatically. We add a public webhook endpoint to receive events, store them in an `email_events` table, and expose analytics API endpoints consumed by a new `/app/analytics` frontend page.

**Tech Stack:** FastAPI, SQLAlchemy async, Alembic, svix (webhook verification), React/TypeScript, TanStack React Query

---

### Task 1: Add `svix` dependency and `resend_webhook_secret` config

**Files:**
- Modify: `backend/pyproject.toml` — add `svix` to dependencies
- Modify: `backend/app/config.py:4-15` — add webhook secret setting
- Modify: `docker-compose.prod.yml` — add env var

**Step 1: Add svix to pyproject.toml**

In `backend/pyproject.toml`, add `"svix"` to the `dependencies` list.

**Step 2: Add config setting**

In `backend/app/config.py`, add after line 15:

```python
resend_webhook_secret: str = ""
```

**Step 3: Add env var to docker-compose.prod.yml**

In the backend service environment section, add:

```yaml
RESEND_WEBHOOK_SECRET: ${RESEND_WEBHOOK_SECRET}
```

**Step 4: Install locally**

```bash
cd backend && pip install svix
```

**Step 5: Commit**

```bash
git add backend/pyproject.toml backend/app/config.py docker-compose.prod.yml
git commit -m "chore: add svix dependency and webhook secret config"
```

---

### Task 2: Create `email_events` model and migration

**Files:**
- Create: `backend/app/models/email_event.py`
- Modify: `backend/app/models/__init__.py` — register new model
- Create: `backend/alembic/versions/020_add_email_events.py`

**Step 1: Create the model**

Create `backend/app/models/email_event.py`:

```python
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class EmailEvent(Base):
    __tablename__ = "email_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    send_log_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("digest_send_logs.id"), nullable=True
    )
    draft_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("digest_drafts.id"), nullable=True
    )
    subscriber_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("subscribers.id"), nullable=True
    )
    event_type: Mapped[str] = mapped_column(String(32))  # delivered, opened, clicked, bounced, complained
    link_url: Mapped[str | None] = mapped_column(Text, nullable=True)  # clicked events only
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    event_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    svix_id: Mapped[str] = mapped_column(String(128), unique=True)

    __table_args__ = (
        Index("ix_email_events_draft_type", "draft_id", "event_type"),
        Index("ix_email_events_subscriber_type", "subscriber_id", "event_type"),
    )
```

**Step 2: Register model in `__init__.py`**

In `backend/app/models/__init__.py`, add:

```python
from app.models.email_event import EmailEvent
```

And add `"EmailEvent"` to `__all__`.

**Step 3: Create migration**

Create `backend/alembic/versions/020_add_email_events.py`:

```python
"""Add email_events table for analytics tracking

Revision ID: 020
Revises: 019
"""

import sqlalchemy as sa
from alembic import op

revision = "020"
down_revision = "019"


def upgrade() -> None:
    op.create_table(
        "email_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("send_log_id", sa.Integer(), sa.ForeignKey("digest_send_logs.id"), nullable=True),
        sa.Column("draft_id", sa.Integer(), sa.ForeignKey("digest_drafts.id"), nullable=True),
        sa.Column("subscriber_id", sa.Integer(), sa.ForeignKey("subscribers.id"), nullable=True),
        sa.Column("event_type", sa.String(32), nullable=False),
        sa.Column("link_url", sa.Text(), nullable=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("event_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("svix_id", sa.String(128), unique=True, nullable=False),
    )
    op.create_index("ix_email_events_draft_type", "email_events", ["draft_id", "event_type"])
    op.create_index("ix_email_events_subscriber_type", "email_events", ["subscriber_id", "event_type"])


def downgrade() -> None:
    op.drop_index("ix_email_events_subscriber_type", table_name="email_events")
    op.drop_index("ix_email_events_draft_type", table_name="email_events")
    op.drop_table("email_events")
```

**Step 4: Commit**

```bash
git add backend/app/models/email_event.py backend/app/models/__init__.py backend/alembic/versions/020_add_email_events.py
git commit -m "feat: add email_events model and migration for analytics"
```

---

### Task 3: Create Resend webhook endpoint

**Files:**
- Create: `backend/app/routers/webhooks.py`
- Modify: `backend/app/main.py:35-36` — register new router

**Step 1: Write test**

Add to `backend/tests/test_digest_api.py`:

```python
@pytest.mark.asyncio
async def test_webhook_rejects_without_signature(client: AsyncClient):
    """Webhook endpoint should return 400 without valid Svix headers."""
    resp = await client.post("/api/webhooks/resend", content='{"type":"email.opened"}')
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_webhook_stores_event(client: AsyncClient):
    """Webhook should store events when signature verification is skipped (no secret configured)."""
    # Create a draft and send log first
    draft_resp = await client.post("/api/digest/drafts", json={
        "date": "2026-03-06", "content_blocks": []
    })
    draft_id = draft_resp.json()["id"]

    # Create subscriber
    sub_resp = await client.post("/api/subscribers", json={"email": "test@example.com"})
    sub_id = sub_resp.json()["id"]

    # Create send log entry
    async with async_session() as session:
        from app.models.digest_send_log import DigestSendLog
        log = DigestSendLog(
            draft_id=draft_id,
            subscriber_id=sub_id,
            email="test@example.com",
            status="sent",
            resend_message_id="test-msg-id-123",
        )
        session.add(log)
        await session.commit()

    # Post webhook event (no svix verification in test since secret is empty)
    payload = {
        "type": "email.opened",
        "created_at": "2026-03-06T12:00:00.000Z",
        "data": {
            "email_id": "test-msg-id-123",
            "from": "test@test.com",
            "to": ["test@example.com"],
            "subject": "Test"
        }
    }
    import json
    resp = await client.post(
        "/api/webhooks/resend",
        content=json.dumps(payload),
        headers={"content-type": "application/json"},
    )
    assert resp.status_code == 204

    # Verify event was stored
    from app.models.email_event import EmailEvent
    async with async_session() as session:
        from sqlalchemy import select
        result = await session.execute(select(EmailEvent))
        events = result.scalars().all()
        assert len(events) == 1
        assert events[0].event_type == "opened"
        assert events[0].draft_id == draft_id
        assert events[0].subscriber_id == sub_id
```

**Step 2: Run test, verify it fails**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_digest_api.py::test_webhook_rejects_without_signature -v
```

Expected: FAIL (endpoint doesn't exist)

**Step 3: Create webhook router**

Create `backend/app/routers/webhooks.py`:

```python
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Request, Response, status
from sqlalchemy import select

from app.config import settings
from app.db import async_session
from app.models.digest_send_log import DigestSendLog
from app.models.email_event import EmailEvent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])

# Event types we care about
TRACKED_EVENTS = {"email.delivered", "email.opened", "email.clicked", "email.bounced", "email.complained"}


@router.post("/resend", status_code=status.HTTP_204_NO_CONTENT)
async def resend_webhook(request: Request, response: Response):
    """Receive and store Resend webhook events."""
    payload = await request.body()
    headers = dict(request.headers)

    # Verify signature if secret is configured
    if settings.resend_webhook_secret:
        try:
            from svix.webhooks import Webhook, WebhookVerificationError

            wh = Webhook(settings.resend_webhook_secret)
            wh.verify(payload, headers)
        except WebhookVerificationError:
            logger.warning("Webhook signature verification failed")
            response.status_code = status.HTTP_400_BAD_REQUEST
            return
    else:
        # In dev/test, skip verification but still reject requests without proper structure
        pass

    try:
        body = json.loads(payload)
    except json.JSONDecodeError:
        response.status_code = status.HTTP_400_BAD_REQUEST
        return

    event_type_raw = body.get("type", "")
    if event_type_raw not in TRACKED_EVENTS:
        return  # Ignore unknown events silently

    data = body.get("data", {})
    resend_message_id = data.get("email_id")
    if not resend_message_id:
        return

    # Deduplicate using svix-id header
    svix_id = headers.get("svix-id", "")
    if not svix_id:
        # Generate a fallback dedup key
        svix_id = f"{event_type_raw}-{resend_message_id}-{body.get('created_at', '')}"

    event_type = event_type_raw.replace("email.", "")  # "email.opened" -> "opened"

    # Extract click data if present
    click_data = data.get("click", {})
    link_url = click_data.get("link") if click_data else None
    ip_address = click_data.get("ipAddress") if click_data else None
    user_agent = click_data.get("userAgent") if click_data else None

    # Parse event timestamp
    event_at_str = body.get("created_at", "")
    try:
        event_at = datetime.fromisoformat(event_at_str.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        event_at = datetime.now(timezone.utc)

    async with async_session() as session:
        # Check for duplicate
        existing = await session.execute(
            select(EmailEvent).where(EmailEvent.svix_id == svix_id)
        )
        if existing.scalars().first():
            return  # Already processed

        # Look up send log to get draft_id and subscriber_id
        send_log = None
        if resend_message_id:
            result = await session.execute(
                select(DigestSendLog).where(
                    DigestSendLog.resend_message_id == resend_message_id
                )
            )
            send_log = result.scalars().first()

        event = EmailEvent(
            send_log_id=send_log.id if send_log else None,
            draft_id=send_log.draft_id if send_log else None,
            subscriber_id=send_log.subscriber_id if send_log else None,
            event_type=event_type,
            link_url=link_url,
            ip_address=ip_address,
            user_agent=user_agent,
            event_at=event_at,
            svix_id=svix_id,
        )
        session.add(event)
        await session.commit()

    logger.info("Stored %s event for message %s", event_type, resend_message_id)
```

**Step 4: Register router in main.py**

In `backend/app/main.py`, add after line 36:

```python
from app.routers.webhooks import router as webhooks_router
app.include_router(webhooks_router)
```

**Step 5: Run tests**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_digest_api.py -k webhook -v
```

Expected: PASS

**Step 6: Commit**

```bash
git add backend/app/routers/webhooks.py backend/app/main.py backend/tests/test_digest_api.py
git commit -m "feat: add Resend webhook endpoint for email event tracking"
```

---

### Task 4: Create analytics API endpoints

**Files:**
- Create: `backend/app/routers/analytics.py`
- Modify: `backend/app/main.py` — register analytics router

**Step 1: Write tests**

Create `backend/tests/test_analytics_api.py`:

```python
from datetime import date, datetime, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles

import app.db as db_module
from app.db import Base, get_db
from app.main import app
from app.models import (  # noqa: F401
    Tweet, Topic, TweetAssignment, Subscriber,
    DigestDraft, DigestSendLog,
)
from app.models.email_event import EmailEvent  # noqa: F401


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
    """Create a draft, 2 subscribers, send logs, and some events."""
    async with async_session() as session:
        from app.models.subscriber import Subscriber
        from app.models.digest_draft import DigestDraft

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
    assert data["last_digest"]["open_rate"] == 50.0  # 1 of 2 opened


@pytest.mark.asyncio
async def test_analytics_digests(client: AsyncClient):
    await _seed_data()
    resp = await client.get("/api/analytics/digests")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["recipients"] == 2
    assert data[0]["opens"] == 1
    assert data[0]["clicks"] == 3


@pytest.mark.asyncio
async def test_analytics_digest_detail(client: AsyncClient):
    draft_id = await _seed_data()
    resp = await client.get(f"/api/analytics/digests/{draft_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["top_links"]) == 2
    assert data["top_links"][0]["count"] == 2  # x.com/post/123 clicked twice
    assert len(data["subscribers"]) == 2


@pytest.mark.asyncio
async def test_analytics_subscribers(client: AsyncClient):
    await _seed_data()
    resp = await client.get("/api/analytics/subscribers")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    alice = next(s for s in data if s["email"] == "alice@test.com")
    assert alice["open_rate"] == 100.0
    bob = next(s for s in data if s["email"] == "bob@test.com")
    assert bob["open_rate"] == 0.0
```

**Step 2: Run tests to verify they fail**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_analytics_api.py -v
```

Expected: FAIL (no analytics router)

**Step 3: Create analytics router**

Create `backend/app/routers/analytics.py`:

```python
import logging
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import case, distinct, func, select

from app.auth import require_admin
from app.db import get_db
from app.models.digest_draft import DigestDraft
from app.models.digest_send_log import DigestSendLog
from app.models.email_event import EmailEvent
from app.models.subscriber import Subscriber

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/analytics",
    tags=["analytics"],
    dependencies=[Depends(require_admin)],
)


@router.get("/overview")
async def get_overview(db=Depends(get_db)):
    """Top-level analytics: subscriber count + last digest stats."""
    # Active subscriber count
    sub_count = await db.execute(
        select(func.count()).select_from(Subscriber).where(
            Subscriber.unsubscribed_at.is_(None)
        )
    )
    subscriber_count = sub_count.scalar() or 0

    # Last sent digest
    last_draft_q = await db.execute(
        select(DigestDraft)
        .where(DigestDraft.status == "sent")
        .order_by(DigestDraft.sent_at.desc())
        .limit(1)
    )
    last_draft = last_draft_q.scalars().first()

    last_digest = None
    if last_draft:
        recipients = last_draft.recipient_count or 0
        opens = 0
        clicks = 0
        if recipients > 0:
            open_count = await db.execute(
                select(func.count(distinct(EmailEvent.subscriber_id)))
                .where(EmailEvent.draft_id == last_draft.id)
                .where(EmailEvent.event_type == "opened")
            )
            opens = open_count.scalar() or 0
            click_count = await db.execute(
                select(func.count())
                .where(EmailEvent.draft_id == last_draft.id)
                .where(EmailEvent.event_type == "clicked")
            )
            clicks = click_count.scalar() or 0

        last_digest = {
            "draft_id": last_draft.id,
            "date": str(last_draft.date),
            "subject": last_draft.subject,
            "recipients": recipients,
            "opens": opens,
            "open_rate": round(opens / recipients * 100, 1) if recipients else 0,
            "clicks": clicks,
            "click_rate": round(clicks / recipients * 100, 1) if recipients else 0,
            "sent_at": last_draft.sent_at.isoformat() if last_draft.sent_at else None,
        }

    return {"subscriber_count": subscriber_count, "last_digest": last_digest}


@router.get("/digests")
async def get_digest_analytics(db=Depends(get_db)):
    """Per-digest metrics for all sent digests."""
    drafts_q = await db.execute(
        select(DigestDraft)
        .where(DigestDraft.status == "sent")
        .order_by(DigestDraft.sent_at.desc())
    )
    drafts = drafts_q.scalars().all()

    results = []
    for draft in drafts:
        recipients = draft.recipient_count or 0
        open_q = await db.execute(
            select(func.count(distinct(EmailEvent.subscriber_id)))
            .where(EmailEvent.draft_id == draft.id)
            .where(EmailEvent.event_type == "opened")
        )
        opens = open_q.scalar() or 0

        click_q = await db.execute(
            select(func.count())
            .where(EmailEvent.draft_id == draft.id)
            .where(EmailEvent.event_type == "clicked")
        )
        clicks = click_q.scalar() or 0

        results.append({
            "draft_id": draft.id,
            "date": str(draft.date),
            "subject": draft.subject,
            "recipients": recipients,
            "opens": opens,
            "open_rate": round(opens / recipients * 100, 1) if recipients else 0,
            "clicks": clicks,
            "click_rate": round(clicks / recipients * 100, 1) if recipients else 0,
            "sent_at": draft.sent_at.isoformat() if draft.sent_at else None,
        })

    return results


@router.get("/digests/{draft_id}")
async def get_digest_detail(draft_id: int, db=Depends(get_db)):
    """Detailed analytics for one digest: top links + per-subscriber breakdown."""
    # Top clicked links
    link_q = await db.execute(
        select(EmailEvent.link_url, func.count().label("count"))
        .where(EmailEvent.draft_id == draft_id)
        .where(EmailEvent.event_type == "clicked")
        .where(EmailEvent.link_url.isnot(None))
        .group_by(EmailEvent.link_url)
        .order_by(func.count().desc())
        .limit(20)
    )
    top_links = [{"url": row.link_url, "count": row.count} for row in link_q]

    # Per-subscriber breakdown
    logs_q = await db.execute(
        select(DigestSendLog)
        .where(DigestSendLog.draft_id == draft_id)
        .where(DigestSendLog.status == "sent")
    )
    logs = logs_q.scalars().all()

    subscribers = []
    for log in logs:
        # Check events for this subscriber + draft
        events_q = await db.execute(
            select(EmailEvent.event_type)
            .where(EmailEvent.draft_id == draft_id)
            .where(EmailEvent.subscriber_id == log.subscriber_id)
        )
        event_types = {row[0] for row in events_q}

        subscribers.append({
            "email": log.email,
            "subscriber_id": log.subscriber_id,
            "delivered": "delivered" in event_types,
            "opened": "opened" in event_types,
            "clicked": "clicked" in event_types,
        })

    return {"top_links": top_links, "subscribers": subscribers}


@router.get("/subscribers")
async def get_subscriber_analytics(db=Depends(get_db)):
    """Engagement metrics per subscriber."""
    subs_q = await db.execute(
        select(Subscriber).where(Subscriber.unsubscribed_at.is_(None))
    )
    subs = subs_q.scalars().all()

    results = []
    for sub in subs:
        # Count digests received (successful sends)
        sent_q = await db.execute(
            select(func.count(distinct(DigestSendLog.draft_id)))
            .where(DigestSendLog.subscriber_id == sub.id)
            .where(DigestSendLog.status == "sent")
        )
        digests_received = sent_q.scalar() or 0

        # Count unique digests opened
        opened_q = await db.execute(
            select(func.count(distinct(EmailEvent.draft_id)))
            .where(EmailEvent.subscriber_id == sub.id)
            .where(EmailEvent.event_type == "opened")
        )
        digests_opened = opened_q.scalar() or 0

        # Count total clicks
        clicks_q = await db.execute(
            select(func.count())
            .where(EmailEvent.subscriber_id == sub.id)
            .where(EmailEvent.event_type == "clicked")
        )
        total_clicks = clicks_q.scalar() or 0

        # Last opened
        last_open_q = await db.execute(
            select(func.max(EmailEvent.event_at))
            .where(EmailEvent.subscriber_id == sub.id)
            .where(EmailEvent.event_type == "opened")
        )
        last_opened = last_open_q.scalar()

        results.append({
            "email": sub.email,
            "subscriber_id": sub.id,
            "subscribed_at": sub.subscribed_at.isoformat() if sub.subscribed_at else None,
            "digests_received": digests_received,
            "open_rate": round(digests_opened / digests_received * 100, 1) if digests_received else 0,
            "click_rate": round(total_clicks / digests_received * 100, 1) if digests_received else 0,
            "last_opened": last_opened.isoformat() if last_opened else None,
        })

    return results
```

**Step 4: Register router in main.py**

In `backend/app/main.py`, add:

```python
from app.routers.analytics import router as analytics_router
app.include_router(analytics_router)
```

**Step 5: Run tests**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_analytics_api.py -v
```

Expected: PASS

**Step 6: Commit**

```bash
git add backend/app/routers/analytics.py backend/app/main.py backend/tests/test_analytics_api.py
git commit -m "feat: add analytics API endpoints for digest metrics"
```

---

### Task 5: Create frontend analytics API hooks

**Files:**
- Create: `frontend/src/api/analytics.ts`

**Step 1: Create the API hooks**

Create `frontend/src/api/analytics.ts`:

```typescript
import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export interface AnalyticsOverview {
  subscriber_count: number
  last_digest: {
    draft_id: number
    date: string
    subject: string | null
    recipients: number
    opens: number
    open_rate: number
    clicks: number
    click_rate: number
    sent_at: string | null
  } | null
}

export interface DigestAnalytics {
  draft_id: number
  date: string
  subject: string | null
  recipients: number
  opens: number
  open_rate: number
  clicks: number
  click_rate: number
  sent_at: string | null
}

export interface DigestDetail {
  top_links: Array<{ url: string; count: number }>
  subscribers: Array<{
    email: string
    subscriber_id: number
    delivered: boolean
    opened: boolean
    clicked: boolean
  }>
}

export interface SubscriberAnalytics {
  email: string
  subscriber_id: number
  subscribed_at: string | null
  digests_received: number
  open_rate: number
  click_rate: number
  last_opened: string | null
}

export function useAnalyticsOverview() {
  return useQuery<AnalyticsOverview>({
    queryKey: ['analytics-overview'],
    queryFn: async () => {
      const { data } = await api.get('/analytics/overview')
      return data
    },
  })
}

export function useDigestAnalytics() {
  return useQuery<DigestAnalytics[]>({
    queryKey: ['analytics-digests'],
    queryFn: async () => {
      const { data } = await api.get('/analytics/digests')
      return data
    },
  })
}

export function useDigestDetail(draftId: number | null) {
  return useQuery<DigestDetail>({
    queryKey: ['analytics-digest-detail', draftId],
    queryFn: async () => {
      const { data } = await api.get(`/analytics/digests/${draftId}`)
      return data
    },
    enabled: draftId !== null,
  })
}

export function useSubscriberAnalytics() {
  return useQuery<SubscriberAnalytics[]>({
    queryKey: ['analytics-subscribers'],
    queryFn: async () => {
      const { data } = await api.get('/analytics/subscribers')
      return data
    },
  })
}
```

**Step 2: Commit**

```bash
git add frontend/src/api/analytics.ts
git commit -m "feat: add frontend analytics API hooks"
```

---

### Task 6: Create Analytics page

**Files:**
- Create: `frontend/src/pages/AnalyticsPage.tsx`
- Modify: `frontend/src/App.tsx:33` — add route

**Step 1: Create the page component**

Create `frontend/src/pages/AnalyticsPage.tsx` with:
- Overview cards at top (subscriber count, last digest open/click rate)
- Per-digest table with expandable rows (top links + subscriber breakdown)
- Subscriber engagement tab
- Navigation back to `/app` and to `/app/digest`

Use the same styling patterns as `SendLogPage.tsx` — inline styles, `var(--text-primary)` etc.

Key sections:
1. Header with back button + "Analytics" title
2. Overview stat cards in a row
3. Tab bar: "Digests" | "Subscribers"
4. Digests tab: table of sent digests, click row to expand details
5. Subscribers tab: table of subscriber engagement

**Step 2: Add route**

In `frontend/src/App.tsx`, add after the send-log route:

```tsx
import { AnalyticsPage } from './pages/AnalyticsPage'
// ...
<Route path="/app/analytics" element={<AnalyticsPage />} />
```

**Step 3: Add nav link**

In `DigestComposer.tsx`, add a button to navigate to analytics (similar to the "Send Log" button pattern).

**Step 4: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add frontend/src/pages/AnalyticsPage.tsx frontend/src/App.tsx frontend/src/pages/DigestComposer.tsx
git commit -m "feat: add analytics dashboard page with digest and subscriber metrics"
```

---

### Task 7: Deploy and configure Resend webhooks

**Step 1: Deploy**

```bash
git push
./scripts/deploy.sh root@46.225.9.10
```

**Step 2: Configure Resend**

1. Log into Resend dashboard
2. Go to Webhooks settings
3. Create webhook endpoint: `https://abridged.tech/api/webhooks/resend`
4. Subscribe to events: `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`, `email.complained`
5. Copy the webhook signing secret

**Step 3: Set env var on server**

```bash
ssh -i ~/wk_clawd root@46.225.9.10
# Add RESEND_WEBHOOK_SECRET=whsec_... to /opt/tpot-digest/.env
# Restart: docker compose -f docker-compose.prod.yml up -d --build backend
```

**Step 4: Test with a test email send**

Send a test digest and verify events appear in the analytics dashboard.
