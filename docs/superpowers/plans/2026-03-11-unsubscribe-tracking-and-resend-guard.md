# Unsubscribe Tracking & Re-send Guard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track which digest triggered each unsubscribe, support re-subscribing, and warn before accidentally re-sending a draft.

**Architecture:** New `unsubscribe_events` table as an audit log alongside the existing `subscribers.unsubscribed_at` flag. The unsubscribe URL gains a `&digest=` param. The subscribe endpoint clears `unsubscribed_at` for returning subscribers. A new `send-status` endpoint powers a frontend warning dialog before re-sends.

**Tech Stack:** Python/FastAPI/SQLAlchemy (backend), React/TypeScript/TanStack Query (frontend), Alembic (migrations), pytest (tests)

**Spec:** `docs/superpowers/specs/2026-03-11-unsubscribe-tracking-and-resend-guard-design.md`

---

## File Map

### New Files
- `backend/app/models/unsubscribe_event.py` — UnsubscribeEvent SQLAlchemy model
- `backend/app/schemas/unsubscribe_event.py` — Pydantic schema for unsubscribe events
- `backend/alembic/versions/022_add_unsubscribe_events.py` — Migration: create table + backfill

### Modified Files
- `backend/app/models/__init__.py` — Register UnsubscribeEvent model
- `backend/app/routers/subscribers.py` — Update unsubscribe endpoint (add `digest` param, create event), update subscribe endpoint (re-subscribe support)
- `backend/app/schemas/subscriber.py` — Add `re_subscribed` field to SubscribeResponse
- `backend/app/routers/digest.py` — Add `&digest={draft_id}` to unsubscribe URLs in 3 places, add `send-status` endpoint
- `backend/app/schemas/digest.py` — Add `SendStatusOut` schema
- `frontend/src/api/digest.ts` — Add `useSendStatus()` hook and `SendStatus` interface
- `frontend/src/pages/DigestComposer.tsx` — Add re-send warning dialog to `handleSendNow`, update `SendConfirmModal` to support "new only" flow
- `backend/tests/test_subscribers_api.py` — Add tests for unsubscribe events, re-subscribe, idempotency

---

## Chunk 1: Backend — Model, Migration, Unsubscribe Endpoint

### Task 1: UnsubscribeEvent model

**Files:**
- Create: `backend/app/models/unsubscribe_event.py`
- Modify: `backend/app/models/__init__.py`

- [ ] **Step 1: Create the UnsubscribeEvent model**

Create `backend/app/models/unsubscribe_event.py`:

```python
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, func, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class UnsubscribeEvent(Base):
    __tablename__ = "unsubscribe_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subscriber_id: Mapped[int] = mapped_column(Integer, ForeignKey("subscribers.id"), index=True)
    # No FK to digest_drafts — we store the value as-is so unsubscribe never fails
    # even if the draft has been deleted or the param is invalid
    draft_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    unsubscribed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

- [ ] **Step 2: Register in models __init__**

In `backend/app/models/__init__.py`, add the import and `__all__` entry:

```python
from app.models.unsubscribe_event import UnsubscribeEvent
```

Add `"UnsubscribeEvent"` to the `__all__` list.

- [ ] **Step 3: Commit**

```bash
git add backend/app/models/unsubscribe_event.py backend/app/models/__init__.py
git commit -m "feat: add UnsubscribeEvent model"
```

### Task 2: Alembic migration

**Files:**
- Create: `backend/alembic/versions/022_add_unsubscribe_events.py`

- [ ] **Step 1: Create migration file**

Create `backend/alembic/versions/022_add_unsubscribe_events.py`:

```python
"""Add unsubscribe_events table with backfill.

Revision ID: 022
Revises: 021
"""

from alembic import op
import sqlalchemy as sa

revision = "022"
down_revision = "021"


def upgrade() -> None:
    op.create_table(
        "unsubscribe_events",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("subscriber_id", sa.Integer, sa.ForeignKey("subscribers.id"), nullable=False, index=True),
        sa.Column("draft_id", sa.Integer, nullable=True, index=True),
        sa.Column("unsubscribed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    # Backfill: create events for existing unsubscribed subscribers (draft_id unknown)
    op.execute(
        "INSERT INTO unsubscribe_events (subscriber_id, draft_id, unsubscribed_at) "
        "SELECT id, NULL, unsubscribed_at FROM subscribers WHERE unsubscribed_at IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_table("unsubscribe_events")
```

- [ ] **Step 2: Commit**

```bash
git add backend/alembic/versions/022_add_unsubscribe_events.py
git commit -m "feat: add unsubscribe_events migration with backfill"
```

### Task 3: Update unsubscribe endpoint (with `digest` param, event creation, idempotency)

**Files:**
- Test: `backend/tests/test_subscribers_api.py`
- Modify: `backend/app/routers/subscribers.py`

- [ ] **Step 1: Write failing tests for unsubscribe with digest param and idempotency**

Add to `backend/tests/test_subscribers_api.py`. First update the model import at line 12 to include `UnsubscribeEvent` and `DigestDraft`:

```python
from app.models import Tweet, Topic, TweetAssignment, Subscriber, DigestDraft, UnsubscribeEvent  # noqa: F401
```

Then add these tests after the existing `test_unsubscribe`:

```python
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
        # Check subscriber is unsubscribed
        result = await session.execute(select(Subscriber).where(Subscriber.id == sub_id))
        sub = result.scalar_one()
        assert sub.unsubscribed_at is not None

        # Check event was created with draft_id
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

    # First click
    await client.get(f"/api/subscribers/unsubscribe?token={unsub_token}&digest=10")
    # Second click
    await client.get(f"/api/subscribers/unsubscribe?token={unsub_token}&digest=10")

    async with async_session() as session:
        count = await session.execute(
            select(func.count()).select_from(UnsubscribeEvent).where(
                UnsubscribeEvent.subscriber_id == sub_id
            )
        )
        assert count.scalar() == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_subscribers_api.py -v -k "test_unsubscribe_with_digest or test_unsubscribe_without_digest or test_unsubscribe_idempotent"`

Expected: FAIL — the endpoint doesn't accept `digest` param and doesn't create events.

- [ ] **Step 3: Update the unsubscribe endpoint**

Modify `backend/app/routers/subscribers.py`:

Add import at the top:
```python
from app.models.unsubscribe_event import UnsubscribeEvent
```

Replace the `unsubscribe` function (lines 50-68) with:

```python
@router.get("/unsubscribe", response_class=HTMLResponse)
async def unsubscribe(token: str, digest: int | None = None, db: AsyncSession = Depends(get_db)):
    """Unsubscribe via token link. Optional digest param tracks which email triggered it."""
    result = await db.execute(select(Subscriber).where(Subscriber.unsubscribe_token == token))
    subscriber = result.scalar_one_or_none()
    if not subscriber:
        raise HTTPException(404, "Invalid unsubscribe link")

    # Idempotency: only create event when transitioning from subscribed → unsubscribed
    if subscriber.unsubscribed_at is None:
        subscriber.unsubscribed_at = datetime.now(timezone.utc)
        event = UnsubscribeEvent(
            subscriber_id=subscriber.id,
            draft_id=digest,
            unsubscribed_at=subscriber.unsubscribed_at,
        )
        db.add(event)
        await db.commit()

    return HTMLResponse("""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Unsubscribed</title></head>
<body style="background:#000;color:#e7e9ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;">
<div style="text-align:center;max-width:400px;">
  <h1 style="font-size:24px;margin-bottom:8px;">Unsubscribed</h1>
  <p style="color:#71767b;">You've been unsubscribed from the digest. You can close this page.</p>
</div>
</body></html>""")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_subscribers_api.py -v`

Expected: ALL PASS (including existing `test_unsubscribe` which now gets the idempotency behavior — still works since it's a first-time unsubscribe).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/subscribers.py backend/tests/test_subscribers_api.py
git commit -m "feat: track unsubscribe events with optional digest param"
```

### Task 4: Re-subscribe support

**Files:**
- Test: `backend/tests/test_subscribers_api.py`
- Modify: `backend/app/routers/subscribers.py`
- Modify: `backend/app/schemas/subscriber.py`

- [ ] **Step 1: Write failing test for re-subscribe**

Add to `backend/tests/test_subscribers_api.py`:

```python
@pytest.mark.asyncio
async def test_resubscribe(client: AsyncClient):
    """A previously unsubscribed user can re-subscribe by signing up again."""
    import secrets

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

    # Verify unsubscribed_at is cleared, token preserved
    async with async_session() as session:
        from sqlalchemy import select
        result = await session.execute(
            select(Subscriber).where(Subscriber.email == "resub@example.com")
        )
        sub = result.scalar_one()
        assert sub.unsubscribed_at is None
        assert sub.unsubscribe_token == original_token
```

Add import at top of test file (if not already present):
```python
from datetime import datetime, timezone
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_subscribers_api.py::test_resubscribe -v`

Expected: FAIL — current code returns `"Already subscribed"` without clearing `unsubscribed_at`.

- [ ] **Step 3: Update SubscribeResponse schema**

In `backend/app/schemas/subscriber.py`, add `re_subscribed` field to `SubscribeResponse`:

```python
class SubscribeResponse(BaseModel):
    message: str
    already_registered: bool = False
    re_subscribed: bool = False
```

- [ ] **Step 4: Update subscribe endpoint**

In `backend/app/routers/subscribers.py`, replace the `subscribe` function (lines 23-47) with:

```python
@router.post("", status_code=201)
async def subscribe(body: SubscribeRequest, db: AsyncSession = Depends(get_db)):
    """Subscribe an email address. Public endpoint."""
    result = await db.execute(select(Subscriber).where(Subscriber.email == body.email))
    existing = result.scalar_one_or_none()

    if existing:
        # Re-subscribe: clear unsubscribed_at if previously unsubscribed
        if existing.unsubscribed_at is not None:
            existing.unsubscribed_at = None
            await db.commit()
            return JSONResponse(
                content=SubscribeResponse(message="Re-subscribed", re_subscribed=True).model_dump(),
                status_code=200,
            )
        return JSONResponse(
            content=SubscribeResponse(message="Already subscribed", already_registered=True).model_dump(),
            status_code=200,
        )

    unsubscribe_token = secrets.token_hex(32)

    subscriber = Subscriber(
        email=body.email,
        unsubscribe_token=unsubscribe_token,
    )
    db.add(subscriber)
    await db.commit()

    return JSONResponse(
        content=SubscribeResponse(message="Subscribed").model_dump(),
        status_code=201,
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_subscribers_api.py -v`

Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/subscribers.py backend/app/schemas/subscriber.py backend/tests/test_subscribers_api.py
git commit -m "feat: support re-subscribing after unsubscribe"
```

### Task 5: Add `draft_id` to unsubscribe URLs in digest router

**Files:**
- Modify: `backend/app/routers/digest.py`

- [ ] **Step 1: Update unsubscribe URL in `send_digest` (line 631)**

In `backend/app/routers/digest.py`, change line 631 from:
```python
unsubscribe_url = f"https://abridged.tech/api/subscribers/unsubscribe?token={sub.unsubscribe_token}"
```
to:
```python
unsubscribe_url = f"https://abridged.tech/api/subscribers/unsubscribe?token={sub.unsubscribe_token}&digest={draft_id}"
```

- [ ] **Step 2: Update unsubscribe URL in `process_scheduled` (line 700)**

Change line 700 from:
```python
unsubscribe_url = f"https://abridged.tech/api/subscribers/unsubscribe?token={sub.unsubscribe_token}"
```
to:
```python
unsubscribe_url = f"https://abridged.tech/api/subscribers/unsubscribe?token={sub.unsubscribe_token}&digest={draft.id}"
```

- [ ] **Step 3: Update unsubscribe URL in `retry_failed_sends` (line 787)**

Change line 787 from:
```python
unsubscribe_url = f"https://abridged.tech/api/subscribers/unsubscribe?token={sub.unsubscribe_token}"
```
to:
```python
unsubscribe_url = f"https://abridged.tech/api/subscribers/unsubscribe?token={sub.unsubscribe_token}&digest={draft_id}"
```

Note: In `retry_failed_sends`, the variable is `draft_id` (the function parameter), not `draft.id`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/digest.py
git commit -m "feat: include draft_id in unsubscribe URLs"
```

---

## Chunk 2: Backend — Send Status Endpoint

### Task 6: Send status endpoint

**Files:**
- Modify: `backend/app/schemas/digest.py`
- Modify: `backend/app/routers/digest.py`

- [ ] **Step 1: Add SendStatusOut schema**

In `backend/app/schemas/digest.py`, add after `DigestSendLogOut`:

```python
class SendStatusOut(BaseModel):
    previously_sent: bool
    sent_count: int
    sent_at: _dt.datetime | None
    sent_subscriber_ids: list[int]
```

- [ ] **Step 2: Add the send-status endpoint**

In `backend/app/routers/digest.py`, add this endpoint after `get_draft_send_log` (after line 749). Also add `SendStatusOut` to the imports from `app.schemas.digest` at line 24.

```python
@router.get("/drafts/{draft_id}/send-status", response_model=SendStatusOut)
async def get_send_status(draft_id: int, db: AsyncSession = Depends(get_db)):
    """Check if a draft has been previously sent and to whom."""
    from sqlalchemy import func as sa_func

    result = await db.execute(
        select(DigestSendLog)
        .where(DigestSendLog.draft_id == draft_id, DigestSendLog.status == "sent")
    )
    sent_logs = result.scalars().all()

    if not sent_logs:
        return SendStatusOut(
            previously_sent=False,
            sent_count=0,
            sent_at=None,
            sent_subscriber_ids=[],
        )

    # Deduplicate subscriber IDs (in case of retries)
    subscriber_ids = list({log.subscriber_id for log in sent_logs})
    earliest = min(log.attempted_at for log in sent_logs)

    return SendStatusOut(
        previously_sent=True,
        sent_count=len(subscriber_ids),
        sent_at=earliest,
        sent_subscriber_ids=subscriber_ids,
    )
```

- [ ] **Step 3: Write test for send-status endpoint**

Add to `backend/tests/test_subscribers_api.py`:

```python
@pytest.mark.asyncio
async def test_send_status_not_previously_sent(client: AsyncClient):
    """send-status returns previously_sent=False when draft has no send logs."""
    # Create a draft
    from app.models.digest_draft import DigestDraft
    import datetime as dt

    async with async_session() as session:
        draft = DigestDraft(date=dt.date(2026, 3, 10), content_blocks=[], status="draft")
        session.add(draft)
        await session.commit()
        draft_id = draft.id

    resp = await client.get(f"/api/digest/drafts/{draft_id}/send-status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["previously_sent"] is False
    assert data["sent_count"] == 0
    assert data["sent_subscriber_ids"] == []


@pytest.mark.asyncio
async def test_send_status_previously_sent(client: AsyncClient):
    """send-status returns correct data when draft has been sent."""
    from app.models.digest_draft import DigestDraft
    from app.models.digest_send_log import DigestSendLog
    import datetime as dt
    import secrets

    async with async_session() as session:
        draft = DigestDraft(date=dt.date(2026, 3, 10), content_blocks=[], status="sent")
        session.add(draft)
        await session.flush()

        sub1 = Subscriber(email="ss1@example.com", unsubscribe_token=secrets.token_hex(32))
        sub2 = Subscriber(email="ss2@example.com", unsubscribe_token=secrets.token_hex(32))
        session.add_all([sub1, sub2])
        await session.flush()

        log1 = DigestSendLog(draft_id=draft.id, subscriber_id=sub1.id, email=sub1.email, status="sent")
        log2 = DigestSendLog(draft_id=draft.id, subscriber_id=sub2.id, email=sub2.email, status="sent")
        log3 = DigestSendLog(draft_id=draft.id, subscriber_id=sub1.id, email=sub1.email, status="failed")
        session.add_all([log1, log2, log3])
        await session.commit()
        draft_id = draft.id

    resp = await client.get(f"/api/digest/drafts/{draft_id}/send-status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["previously_sent"] is True
    assert data["sent_count"] == 2  # deduplicated
    assert set(data["sent_subscriber_ids"]) == {sub1.id, sub2.id}
    assert data["sent_at"] is not None
```

Note: These tests require auth. The digest router uses `require_admin` dependency. If the test client doesn't set auth, these tests will get 401. Check if there's an auth bypass in tests — if `AUTH_USER`/`AUTH_PASS` env vars are unset, auth is skipped. The test environment should not set these, so the tests should pass.

- [ ] **Step 4: Run tests to verify they pass**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_subscribers_api.py -v`

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/digest.py backend/app/schemas/digest.py backend/tests/test_subscribers_api.py
git commit -m "feat: add send-status endpoint for re-send guard"
```

---

## Chunk 3: Frontend — Send Status Hook & Re-send Warning Dialog

### Task 7: Add `useSendStatus` hook

**Files:**
- Modify: `frontend/src/api/digest.ts`

- [ ] **Step 1: Add SendStatus interface and hook**

First, update `useSendDigest` (around line 128-142) to also invalidate the send-status cache after a successful send. Change its `onSuccess` callback from:
```typescript
    onSuccess: () => qc.invalidateQueries({ queryKey: ['digest-drafts'] }),
```
to:
```typescript
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['digest-drafts'] })
      qc.invalidateQueries({ queryKey: ['send-status', vars.draftId] })
    },
```

Then add after the `useRetryFailedSends` function (after line 231):

```typescript
export interface SendStatus {
  previously_sent: boolean
  sent_count: number
  sent_at: string | null
  sent_subscriber_ids: number[]
}

export function useSendStatus(draftId: number | null) {
  return useQuery<SendStatus>({
    queryKey: ['send-status', draftId],
    queryFn: async () => {
      const { data } = await api.get(`/digest/drafts/${draftId}/send-status`)
      return data
    },
    enabled: draftId !== null,
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api/digest.ts
git commit -m "feat: add useSendStatus hook"
```

### Task 8: Re-send warning dialog in DigestComposer

**Files:**
- Modify: `frontend/src/pages/DigestComposer.tsx`

This task modifies `handleSendNow` to check send status before opening the subscriber modal, and adds a warning dialog with three options.

- [ ] **Step 1: Add import for useSendStatus**

In `frontend/src/pages/DigestComposer.tsx`, add `useSendStatus` to the imports from `../api/digest` (around line 3-23).

- [ ] **Step 2: Add the ResendWarningDialog component**

Add before the `SendConfirmModal` component (before line 1078):

```typescript
function ResendWarningDialog({
  sentCount,
  sentAt,
  overlapCount,
  selectedCount,
  onSendAnyway,
  onNewOnly,
  onCancel,
}: {
  sentCount: number
  sentAt: string
  overlapCount: number
  selectedCount: number
  onSendAnyway: () => void
  onNewOnly: () => void
  onCancel: () => void
}) {
  const dateStr = new Date(sentAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10001,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', width: 420, padding: '24px',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
          Draft already sent
        </h3>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          This draft was already sent to {sentCount} subscriber{sentCount !== 1 ? 's' : ''} on {dateStr}.
          {overlapCount > 0 && (
            <> {overlapCount} of your {selectedCount} selected subscriber{selectedCount !== 1 ? 's' : ''} {overlapCount === 1 ? 'has' : 'have'} already received it.</>
          )}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent', color: 'var(--text-secondary)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
              padding: '8px 16px', fontSize: 13, cursor: 'pointer',
              fontFamily: 'var(--font-body)',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onNewOnly}
            disabled={overlapCount === selectedCount}
            style={{
              background: overlapCount === selectedCount ? 'var(--text-tertiary)' : 'var(--bg-elevated)',
              color: overlapCount === selectedCount ? 'var(--text-tertiary)' : 'var(--text-primary)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
              padding: '8px 16px', fontSize: 13,
              cursor: overlapCount === selectedCount ? 'default' : 'pointer',
              fontFamily: 'var(--font-body)',
            }}
          >
            New only ({selectedCount - overlapCount})
          </button>
          <button
            onClick={onSendAnyway}
            style={{
              background: '#ef4444', color: '#fff', border: 'none',
              borderRadius: 'var(--radius-md)', padding: '8px 16px', fontSize: 13,
              fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font-body)',
            }}
          >
            Send anyway
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add state and hook in DigestComposer**

In the `DigestComposer` component, after the `sendLog` hook declaration (around line 1235), add:

```typescript
const sendStatus = useSendStatus(selectedDraftId)
const [resendWarning, setResendWarning] = useState<{
  sentCount: number
  sentAt: string
  sentSubscriberIds: number[]
  selectedSubscriberIds: number[]
} | null>(null)
```

- [ ] **Step 4: Update handleSendConfirm to check send status**

Replace the existing `handleSendConfirm` (lines 1546-1555) with a version that checks send status after subscriber selection:

```typescript
const handleSendConfirm = async (subscriberIds: number[]) => {
  if (!selectedDraftId) return
  setShowSendConfirm(false)

  // Check if draft was previously sent
  if (sendStatus.data?.previously_sent && sendStatus.data.sent_at) {
    const overlapIds = subscriberIds.filter(id =>
      sendStatus.data!.sent_subscriber_ids.includes(id)
    )
    if (overlapIds.length > 0) {
      setResendWarning({
        sentCount: sendStatus.data.sent_count,
        sentAt: sendStatus.data.sent_at,
        sentSubscriberIds: sendStatus.data.sent_subscriber_ids,
        selectedSubscriberIds: subscriberIds,
      })
      return
    }
  }

  // No overlap or not previously sent — send directly
  await executeSend(subscriberIds)
}

const executeSend = async (subscriberIds: number[]) => {
  if (!selectedDraftId) return
  try {
    const result = await sendDigest.mutateAsync({ draftId: selectedDraftId, subscriberIds })
    showStatus(`Sent to ${result.sent_count} of ${result.total_subscribers} subscribers`, 'success')
  } catch {
    showStatus('Failed to send digest', 'error')
  }
}
```

- [ ] **Step 5: Add ResendWarningDialog render and handlers**

In the JSX return, after the `SendConfirmModal` render (around line 2624-2627), add:

```tsx
{resendWarning && (
  <ResendWarningDialog
    sentCount={resendWarning.sentCount}
    sentAt={resendWarning.sentAt}
    overlapCount={resendWarning.selectedSubscriberIds.filter(id =>
      resendWarning.sentSubscriberIds.includes(id)
    ).length}
    selectedCount={resendWarning.selectedSubscriberIds.length}
    onSendAnyway={() => {
      const ids = resendWarning.selectedSubscriberIds
      setResendWarning(null)
      executeSend(ids)
    }}
    onNewOnly={() => {
      const newOnly = resendWarning.selectedSubscriberIds.filter(
        id => !resendWarning.sentSubscriberIds.includes(id)
      )
      setResendWarning(null)
      // Re-open SendConfirmModal pre-filtered to new-only subscribers
      // We pass the filtered IDs directly to executeSend
      if (newOnly.length > 0) {
        executeSend(newOnly)
      } else {
        showStatus('All selected subscribers already received this draft', 'info')
      }
    }}
    onCancel={() => setResendWarning(null)}
  />
)}
```

- [ ] **Step 6: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/DigestComposer.tsx frontend/src/api/digest.ts
git commit -m "feat: add re-send warning dialog with send-anyway and new-only options"
```

---

## Chunk 4: Run All Tests & Final Verification

### Task 9: Run full test suite and verify

- [ ] **Step 1: Run backend tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -v`

Expected: ALL PASS

- [ ] **Step 2: Run frontend TypeScript check**

Run: `cd frontend && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Final commit (if any fixups needed)**

Only if previous steps required adjustments.
