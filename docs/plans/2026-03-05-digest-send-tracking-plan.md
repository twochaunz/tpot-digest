# Digest Send Tracking & Retry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Record per-recipient send results for every digest send, surface them in the UI, and allow retrying failed sends.

**Architecture:** New `digest_send_logs` table stores one row per send attempt. The send endpoint creates log rows as it sends. New API endpoints expose logs and retry. The composer shows inline send status with expandable failure detail and retry controls. A separate send log page shows all sends across drafts.

**Tech Stack:** FastAPI, SQLAlchemy async, Alembic, React 19, TanStack Query, inline styles (matching existing codebase patterns)

---

### Task 1: Database Model & Migration

**Files:**
- Create: `backend/app/models/digest_send_log.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/019_add_digest_send_logs.py`

**Step 1: Create the model**

Create `backend/app/models/digest_send_log.py`:

```python
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class DigestSendLog(Base):
    __tablename__ = "digest_send_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    draft_id: Mapped[int] = mapped_column(Integer, ForeignKey("digest_drafts.id"), index=True)
    subscriber_id: Mapped[int] = mapped_column(Integer, ForeignKey("subscribers.id"))
    email: Mapped[str] = mapped_column(String(320))
    status: Mapped[str] = mapped_column(String(16))  # 'sent' or 'failed'
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    resend_message_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    attempted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

**Step 2: Add to models `__init__.py`**

Add `from app.models.digest_send_log import DigestSendLog` and add `DigestSendLog` to the `__all__` list in `backend/app/models/__init__.py`.

**Step 3: Create migration**

Create `backend/alembic/versions/019_add_digest_send_logs.py`:

```python
"""Add digest_send_logs table."""

from alembic import op
import sqlalchemy as sa

revision = "019"
down_revision = "018"


def upgrade():
    op.create_table(
        "digest_send_logs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("draft_id", sa.Integer, sa.ForeignKey("digest_drafts.id"), nullable=False, index=True),
        sa.Column("subscriber_id", sa.Integer, sa.ForeignKey("subscribers.id"), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("resend_message_id", sa.String(128), nullable=True),
        sa.Column("attempted_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_digest_send_logs_draft_status", "digest_send_logs", ["draft_id", "status"])


def downgrade():
    op.drop_index("ix_digest_send_logs_draft_status")
    op.drop_table("digest_send_logs")
```

**Step 4: Commit**

```bash
git add backend/app/models/digest_send_log.py backend/app/models/__init__.py backend/alembic/versions/019_add_digest_send_logs.py
git commit -m "feat: add digest_send_logs model and migration"
```

---

### Task 2: Update Send Flow to Log Results

**Files:**
- Modify: `backend/app/services/email.py` (return error info)
- Modify: `backend/app/routers/digest.py:567-601` (send_digest endpoint)
- Modify: `backend/app/routers/digest.py:604-648` (process_scheduled endpoint)

**Step 1: Update email service to return error details**

In `backend/app/services/email.py`, change `send_digest_email` to return a dict with `success`, `result`, and `error` keys instead of `dict | None`:

```python
def send_digest_email(
    to_email: str,
    subject: str,
    html_content: str,
    unsubscribe_url: str | None = None,
) -> dict:
    """Send a digest email via Resend. Returns dict with 'success', 'result', 'error' keys."""
    if not settings.resend_api_key:
        logger.warning("RESEND_API_KEY not set -- skipping digest email to %s", to_email)
        return {"success": False, "result": None, "error": "RESEND_API_KEY not set"}

    import resend

    resend.api_key = settings.resend_api_key
    headers: dict[str, str] = {}
    if unsubscribe_url:
        headers["List-Unsubscribe"] = f"<{unsubscribe_url}>"
        headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"

    params = {
        "from": settings.digest_from_email,
        "reply_to": settings.digest_reply_to_email,
        "to": [to_email],
        "subject": subject,
        "html": html_content,
        "headers": headers,
    }
    try:
        result = resend.Emails.send(params)
        logger.info("Digest email sent to %s: %s", to_email, result)
        return {"success": True, "result": result, "error": None}
    except Exception as exc:
        logger.exception("Failed to send digest email to %s", to_email)
        return {"success": False, "result": None, "error": str(exc)}
```

**Step 2: Update send_digest endpoint to create log rows**

In `backend/app/routers/digest.py`, update the `send_digest` function (line ~567) to import `DigestSendLog` and create a log row for each send attempt:

```python
@router.post("/drafts/{draft_id}/send")
async def send_digest(draft_id: int, body: DigestSendRequest | None = None, db: AsyncSession = Depends(get_db)):
    """Send the digest to active subscribers and mark as sent."""
    draft = await db.get(DigestDraft, draft_id)
    if not draft:
        raise HTTPException(404, "Draft not found")
    query = select(Subscriber).where(Subscriber.unsubscribed_at.is_(None))
    if body and body.subscriber_ids is not None:
        query = query.where(Subscriber.id.in_(body.subscriber_ids))
    result = await db.execute(query)
    subscribers = result.scalars().all()

    blocks = await _build_digest_content(draft, db)
    date_str = _format_date(draft.date)
    subject = draft.subject or _default_subject(draft.date)

    sent_count = 0
    for sub in subscribers:
        unsubscribe_url = f"https://abridged.tech/api/subscribers/unsubscribe?token={sub.unsubscribe_token}"
        html = render_digest_email(date_str=date_str, blocks=blocks, unsubscribe_url=unsubscribe_url)
        email_result = send_digest_email(sub.email, subject, html, unsubscribe_url=unsubscribe_url)

        log = DigestSendLog(
            draft_id=draft_id,
            subscriber_id=sub.id,
            email=sub.email,
            status="sent" if email_result["success"] else "failed",
            error_message=email_result["error"],
            resend_message_id=email_result["result"].get("id") if email_result["result"] and isinstance(email_result["result"], dict) else None,
        )
        db.add(log)

        if email_result["success"]:
            sent_count += 1

    draft.status = "sent"
    draft.sent_at = datetime.now(timezone.utc)
    draft.recipient_count = sent_count
    await db.commit()

    return {"sent_count": sent_count, "total_subscribers": len(subscribers)}
```

**Step 3: Update process_scheduled similarly**

Apply the same logging pattern to the `process_scheduled` function (~line 604-648).

**Step 4: Add DigestSendLog import at top of digest.py**

```python
from app.models.digest_send_log import DigestSendLog
```

**Step 5: Commit**

```bash
git add backend/app/services/email.py backend/app/routers/digest.py
git commit -m "feat: log per-recipient send results to digest_send_logs"
```

---

### Task 3: API Endpoints for Send Logs & Retry

**Files:**
- Modify: `backend/app/routers/digest.py` (add 3 new endpoints)
- Modify: `backend/app/schemas/digest.py` (add response schemas)

**Step 1: Add schemas**

Add to `backend/app/schemas/digest.py`:

```python
class DigestSendLogOut(BaseModel):
    id: int
    draft_id: int
    subscriber_id: int
    email: str
    status: str
    error_message: str | None
    resend_message_id: str | None
    attempted_at: _dt.datetime

    model_config = {"from_attributes": True}


class DigestRetryRequest(BaseModel):
    subscriber_ids: list[int] | None = None
```

**Step 2: Add per-draft send log endpoint**

Add to `backend/app/routers/digest.py`:

```python
@router.get("/drafts/{draft_id}/send-log")
async def get_draft_send_log(draft_id: int, db: AsyncSession = Depends(get_db)):
    """Get send logs for a specific draft."""
    result = await db.execute(
        select(DigestSendLog)
        .where(DigestSendLog.draft_id == draft_id)
        .order_by(DigestSendLog.attempted_at.desc())
    )
    logs = result.scalars().all()
    return [DigestSendLogOut.model_validate(log) for log in logs]
```

**Step 3: Add retry endpoint**

```python
@router.post("/drafts/{draft_id}/retry")
async def retry_failed_sends(draft_id: int, body: DigestRetryRequest | None = None, db: AsyncSession = Depends(get_db)):
    """Retry failed sends for a draft. Optional subscriber_ids to retry selectively."""
    draft = await db.get(DigestDraft, draft_id)
    if not draft:
        raise HTTPException(404, "Draft not found")

    # Find failed logs for this draft
    query = select(DigestSendLog).where(
        DigestSendLog.draft_id == draft_id,
        DigestSendLog.status == "failed",
    )
    if body and body.subscriber_ids is not None:
        query = query.where(DigestSendLog.subscriber_id.in_(body.subscriber_ids))
    result = await db.execute(query)
    failed_logs = result.scalars().all()

    if not failed_logs:
        return {"retried": 0, "sent": 0}

    # Get subscriber IDs to retry
    sub_ids = list({log.subscriber_id for log in failed_logs})
    sub_result = await db.execute(select(Subscriber).where(Subscriber.id.in_(sub_ids)))
    subscribers = {s.id: s for s in sub_result.scalars().all()}

    blocks = await _build_digest_content(draft, db)
    date_str = _format_date(draft.date)
    subject = draft.subject or _default_subject(draft.date)

    sent_count = 0
    for log in failed_logs:
        sub = subscribers.get(log.subscriber_id)
        if not sub:
            continue
        unsubscribe_url = f"https://abridged.tech/api/subscribers/unsubscribe?token={sub.unsubscribe_token}"
        html = render_digest_email(date_str=date_str, blocks=blocks, unsubscribe_url=unsubscribe_url)
        email_result = send_digest_email(sub.email, subject, html, unsubscribe_url=unsubscribe_url)

        new_log = DigestSendLog(
            draft_id=draft_id,
            subscriber_id=sub.id,
            email=sub.email,
            status="sent" if email_result["success"] else "failed",
            error_message=email_result["error"],
            resend_message_id=email_result["result"].get("id") if email_result["result"] and isinstance(email_result["result"], dict) else None,
        )
        db.add(new_log)

        if email_result["success"]:
            sent_count += 1

    # Update draft recipient_count
    all_logs_result = await db.execute(
        select(DigestSendLog).where(DigestSendLog.draft_id == draft_id, DigestSendLog.status == "sent")
    )
    draft.recipient_count = len(all_logs_result.scalars().all())
    await db.commit()

    return {"retried": len(failed_logs), "sent": sent_count}
```

**Step 4: Add global send log endpoint**

```python
@router.get("/send-log")
async def get_all_send_logs(
    status: str | None = None,
    draft_id: int | None = None,
    limit: int = 100,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """Get all send logs with optional filters."""
    query = select(DigestSendLog)
    if status:
        query = query.where(DigestSendLog.status == status)
    if draft_id:
        query = query.where(DigestSendLog.draft_id == draft_id)
    query = query.order_by(DigestSendLog.attempted_at.desc()).limit(limit).offset(offset)
    result = await db.execute(query)
    logs = result.scalars().all()
    return [DigestSendLogOut.model_validate(log) for log in logs]
```

**Step 5: Add imports for new schemas at top of digest.py**

```python
from app.schemas.digest import (
    ...,
    DigestSendLogOut,
    DigestRetryRequest,
)
```

**Step 6: Commit**

```bash
git add backend/app/routers/digest.py backend/app/schemas/digest.py
git commit -m "feat: add send-log and retry API endpoints"
```

---

### Task 4: Backend Tests

**Files:**
- Modify: `backend/tests/test_digest_api.py`

**Step 1: Write test for send logging**

Add to `backend/tests/test_digest_api.py`. Must import `DigestSendLog` at the model import line (line 17).

```python
@pytest.mark.asyncio
async def test_send_creates_send_logs(client: AsyncClient):
    """Sending a digest should create per-recipient send log entries."""
    # Create subscribers
    async with async_session() as session:
        from app.models.subscriber import Subscriber
        import secrets
        sub1 = Subscriber(email="a@test.com", unsubscribe_token=secrets.token_urlsafe(32))
        sub2 = Subscriber(email="b@test.com", unsubscribe_token=secrets.token_urlsafe(32))
        session.add_all([sub1, sub2])
        await session.commit()

    # Create draft
    create_resp = await client.post("/api/digest/drafts", json={
        "date": "2026-03-01",
        "content_blocks": [{"id": "b1", "type": "text", "content": "Hello"}],
    })
    draft_id = create_resp.json()["id"]

    # Send (mocking email service)
    with patch("app.routers.digest.send_digest_email", return_value={"success": True, "result": {"id": "msg_123"}, "error": None}):
        resp = await client.post(f"/api/digest/drafts/{draft_id}/send")
    assert resp.status_code == 200
    assert resp.json()["sent_count"] == 2

    # Check send logs
    log_resp = await client.get(f"/api/digest/drafts/{draft_id}/send-log")
    assert log_resp.status_code == 200
    logs = log_resp.json()
    assert len(logs) == 2
    assert all(l["status"] == "sent" for l in logs)


@pytest.mark.asyncio
async def test_send_logs_partial_failure(client: AsyncClient):
    """When some sends fail, logs should reflect mixed status."""
    async with async_session() as session:
        import secrets
        sub1 = Subscriber(email="ok@test.com", unsubscribe_token=secrets.token_urlsafe(32))
        sub2 = Subscriber(email="fail@test.com", unsubscribe_token=secrets.token_urlsafe(32))
        session.add_all([sub1, sub2])
        await session.commit()

    create_resp = await client.post("/api/digest/drafts", json={
        "date": "2026-03-01",
        "content_blocks": [{"id": "b1", "type": "text", "content": "Hello"}],
    })
    draft_id = create_resp.json()["id"]

    call_count = 0
    def mock_send(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return {"success": True, "result": {"id": "msg_ok"}, "error": None}
        return {"success": False, "result": None, "error": "Resend rate limit"}

    with patch("app.routers.digest.send_digest_email", side_effect=mock_send):
        resp = await client.post(f"/api/digest/drafts/{draft_id}/send")
    assert resp.json()["sent_count"] == 1

    log_resp = await client.get(f"/api/digest/drafts/{draft_id}/send-log")
    logs = log_resp.json()
    sent = [l for l in logs if l["status"] == "sent"]
    failed = [l for l in logs if l["status"] == "failed"]
    assert len(sent) == 1
    assert len(failed) == 1
    assert failed[0]["error_message"] == "Resend rate limit"


@pytest.mark.asyncio
async def test_retry_failed_sends(client: AsyncClient):
    """Retrying should resend to failed recipients and create new log entries."""
    async with async_session() as session:
        import secrets
        sub = Subscriber(email="retry@test.com", unsubscribe_token=secrets.token_urlsafe(32))
        session.add(sub)
        await session.commit()

    create_resp = await client.post("/api/digest/drafts", json={
        "date": "2026-03-01",
        "content_blocks": [{"id": "b1", "type": "text", "content": "Hello"}],
    })
    draft_id = create_resp.json()["id"]

    # Initial send fails
    with patch("app.routers.digest.send_digest_email", return_value={"success": False, "result": None, "error": "timeout"}):
        await client.post(f"/api/digest/drafts/{draft_id}/send")

    # Retry succeeds
    with patch("app.routers.digest.send_digest_email", return_value={"success": True, "result": {"id": "msg_retry"}, "error": None}):
        retry_resp = await client.post(f"/api/digest/drafts/{draft_id}/retry")
    assert retry_resp.status_code == 200
    assert retry_resp.json()["sent"] == 1

    # Should have 2 log entries: 1 failed, 1 sent
    log_resp = await client.get(f"/api/digest/drafts/{draft_id}/send-log")
    logs = log_resp.json()
    assert len(logs) == 2
```

**Step 2: Run tests**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_digest_api.py -v
```

Expected: All tests pass (existing + new).

**Step 3: Commit**

```bash
git add backend/tests/test_digest_api.py
git commit -m "test: add send log and retry tests"
```

---

### Task 5: Frontend API Hooks

**Files:**
- Modify: `frontend/src/api/digest.ts`

**Step 1: Add types and hooks**

Add to `frontend/src/api/digest.ts`:

```typescript
export interface DigestSendLog {
  id: number
  draft_id: number
  subscriber_id: number
  email: string
  status: 'sent' | 'failed'
  error_message: string | null
  resend_message_id: string | null
  attempted_at: string
}

export function useDraftSendLog(draftId: number | null) {
  return useQuery<DigestSendLog[]>({
    queryKey: ['draft-send-log', draftId],
    queryFn: async () => {
      const { data } = await api.get(`/digest/drafts/${draftId}/send-log`)
      return data
    },
    enabled: draftId !== null,
  })
}

export function useAllSendLogs(filters?: { status?: string; draft_id?: number; limit?: number; offset?: number }) {
  return useQuery<DigestSendLog[]>({
    queryKey: ['all-send-logs', filters],
    queryFn: async () => {
      const { data } = await api.get('/digest/send-log', { params: filters })
      return data
    },
  })
}

export function useRetryFailedSends() {
  const qc = useQueryClient()
  return useMutation<
    { retried: number; sent: number },
    Error,
    { draftId: number; subscriberIds?: number[] }
  >({
    mutationFn: async ({ draftId, subscriberIds }) => {
      const body = subscriberIds ? { subscriber_ids: subscriberIds } : undefined
      const { data } = await api.post(`/digest/drafts/${draftId}/retry`, body)
      return data
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['draft-send-log', vars.draftId] })
      qc.invalidateQueries({ queryKey: ['digest-drafts'] })
      qc.invalidateQueries({ queryKey: ['all-send-logs'] })
    },
  })
}
```

**Step 2: Commit**

```bash
git add frontend/src/api/digest.ts
git commit -m "feat: add send log and retry API hooks"
```

---

### Task 6: Composer Inline Send Status

**Files:**
- Modify: `frontend/src/pages/DigestComposer.tsx`

**Step 1: Add imports and hook calls**

At the top of DigestComposer component (around line ~1200), add:

```typescript
import { useDraftSendLog, useRetryFailedSends } from '../api/digest'
```

Inside the component, add:

```typescript
const sendLog = useDraftSendLog(isSent ? selectedDraftId : null)
const retryFailed = useRetryFailedSends()
const [retrySelection, setRetrySelection] = useState<Set<number>>(new Set())
```

**Step 2: Add send status section**

After the "Action Buttons" section (~line 2113) and before the "Email Preview" section (~line 2116), add a send status component that shows:

- If draft is sent and sendLog data exists:
  - Compute `sentCount`, `failedCount`, `totalCount` from log data
  - Show status bar: green "Sent to X/Y" or yellow/red "Sent to X/Y · Z failed"
  - If failures exist, show expandable section with:
    - Each failed recipient: checkbox + email + error message
    - "Retry All Failed" button
    - "Retry Selected" button (when checkboxes selected)
  - Style: use existing card pattern (`bg-raised`, `border`, `radius-lg`)
  - Failed rows: subtle red-tinted background on hover
  - Retry buttons: match existing button styles

Design notes for clean UI:
- Status bar: single line with dot separator, colored counts
- Failure list: compact rows (email left, error right, checkbox far left)
- No modal — inline expandable within the composer flow
- Retry buttons at bottom of failure list
- After retry, sendLog refetches automatically (TanStack Query invalidation)

**Step 3: Run TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add frontend/src/pages/DigestComposer.tsx
git commit -m "feat: add inline send status with retry in digest composer"
```

---

### Task 7: Send Log Page

**Files:**
- Create: `frontend/src/pages/SendLogPage.tsx`
- Modify: `frontend/src/App.tsx` (add route)
- Modify: `frontend/src/pages/DigestComposer.tsx` (add nav link)

**Step 1: Create SendLogPage**

Create `frontend/src/pages/SendLogPage.tsx`:

- Page layout: match existing pages (`height: 100dvh`, `overflowY: auto`, sticky header, max-width 800, centered)
- Header: "Send Log" title + "Back" button to `/app/digest`
- Filter bar: status dropdown (all/sent/failed) + draft ID filter (optional)
- Table/list of send logs:
  - Each row: draft subject/date, recipient email, status badge, error (if failed), timestamp
  - Status badges: green "sent", red "failed"
  - Click draft date to navigate to composer with that draft
- Use `useAllSendLogs` hook with filter params
- Empty state: "No send logs yet"
- Style: consistent with SettingsPage and DigestComposer (dark theme, same card patterns)

**Step 2: Add route**

In `frontend/src/App.tsx`, add:

```typescript
import { SendLogPage } from './pages/SendLogPage'
```

And route:

```tsx
<Route path="/app/send-log" element={<SendLogPage />} />
```

**Step 3: Add nav link in composer header**

In `DigestComposer.tsx` header section (~line 1574), add a "Send Log" button next to the "Drafts" button:

```tsx
<button
  onClick={() => navigate('/app/send-log')}
  style={{
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-secondary)',
    padding: '6px 12px',
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
  }}
>
  Send Log
</button>
```

**Step 4: Run TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add frontend/src/pages/SendLogPage.tsx frontend/src/App.tsx frontend/src/pages/DigestComposer.tsx
git commit -m "feat: add send log page with filtering"
```

---

### Task 8: Final Verification & Deploy

**Step 1: Run all backend tests**

```bash
backend/.venv/bin/python -m pytest backend/tests/ -q
```

Expected: All tests pass.

**Step 2: Run TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: No errors.

**Step 3: Deploy**

```bash
./scripts/deploy.sh root@46.225.9.10
```

**Step 4: Verify migration runs**

```bash
ssh -i ~/wk_clawd root@46.225.9.10 'docker logs tpot-digest-backend-1 2>&1 | tail -10'
```

Verify migration 019 applied successfully.
