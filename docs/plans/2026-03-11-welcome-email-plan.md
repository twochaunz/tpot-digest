# Welcome Email Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically send new subscribers the latest sent digest with a customizable welcome message prepended, configurable from a dedicated admin page.

**Architecture:** New `digest_settings` single-row table stores welcome email config (send mode, subject, message). A shared `send_welcome_email` service function handles rendering (prepend welcome text + divider to latest digest) and sending. Two trigger paths: immediate (inline in subscribe endpoint) and hourly (cron endpoint). Dedup via existing `digest_send_logs`. Frontend: dedicated `/app/welcome-email` page with settings form + live preview.

**Tech Stack:** Python/FastAPI, SQLAlchemy async, Alembic, Jinja2, Resend API, React/TypeScript, TanStack React Query

---

### Task 1: DigestSettings model

**Files:**
- Create: `backend/app/models/digest_settings.py`
- Modify: `backend/app/models/__init__.py`

**Step 1: Create the model file**

```python
# backend/app/models/digest_settings.py
"""Single-row table for digest-level configuration."""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

DEFAULT_WELCOME_MESSAGE = (
    "thanks for subscribing! here's the most recent abridged piece that went out. "
    "feel free to share any feedback that would help your experience \U0001f600"
)


class DigestSettings(Base):
    __tablename__ = "digest_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    welcome_send_mode: Mapped[str] = mapped_column(String(16), default="off")
    welcome_subject: Mapped[str] = mapped_column(String(255), default="no little piggies allowed")
    welcome_message: Mapped[str] = mapped_column(Text, default=DEFAULT_WELCOME_MESSAGE)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
```

**Step 2: Register in models `__init__.py`**

Add to `backend/app/models/__init__.py`:

```python
from app.models.digest_settings import DigestSettings
```

And add `"DigestSettings"` to the `__all__` list.

**Step 3: Commit**

```bash
git add backend/app/models/digest_settings.py backend/app/models/__init__.py
git commit -m "feat: add DigestSettings model for welcome email config"
```

---

### Task 2: Alembic migration

**Files:**
- Modify: `backend/alembic/env.py` (add import)
- Create: new migration file via `alembic revision`

**Step 1: Add DigestSettings import to alembic env.py**

Add after line 23 in `backend/alembic/env.py`:

```python
from app.models.digest_settings import DigestSettings  # noqa: E402, F401
```

**Step 2: Generate migration**

Run from `backend/` directory:

```bash
cd backend && .venv/bin/python -m alembic revision --autogenerate -m "add digest_settings table"
```

**Step 3: Review the generated migration**

Open the generated file and verify it creates the `digest_settings` table with columns: `id`, `welcome_send_mode`, `welcome_subject`, `welcome_message`, `updated_at`.

**Step 4: Run migration locally (if dev DB available)**

```bash
.venv/bin/python -m alembic upgrade head
```

**Step 5: Commit**

```bash
git add backend/alembic/
git commit -m "feat: add migration for digest_settings table"
```

---

### Task 3: DigestSettings schemas

**Files:**
- Modify: `backend/app/schemas/digest.py`

**Step 1: Add schemas at the end of `backend/app/schemas/digest.py`**

```python
class DigestSettingsOut(BaseModel):
    welcome_send_mode: str
    welcome_subject: str
    welcome_message: str
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class DigestSettingsUpdate(BaseModel):
    welcome_send_mode: str | None = None
    welcome_subject: str | None = None
    welcome_message: str | None = None
```

Also add `datetime` to the existing imports at the top if not already imported (check — `_dt` alias is used for `date`).

**Step 2: Commit**

```bash
git add backend/app/schemas/digest.py
git commit -m "feat: add DigestSettings request/response schemas"
```

---

### Task 4: Welcome email rendering service

**Files:**
- Modify: `backend/app/services/email.py`

**Step 1: Add `render_welcome_email` function**

Add after the existing `render_digest_email` function (after line 27):

```python
def render_welcome_email(
    welcome_message: str,
    welcome_subject: str,
    digest_date_str: str,
    digest_blocks: list[dict],
    unsubscribe_url: str,
) -> str:
    """Render welcome email: welcome text + divider + full digest content."""
    import markdown as md

    # Resolve template variables in welcome message
    resolved_message = welcome_message.replace(
        "{{date}}", digest_date_str
    ).replace(
        "{{subject}}", welcome_subject
    )

    # Build combined blocks: welcome text + divider + original digest blocks
    welcome_html = md.markdown(resolved_message, extensions=["extra"])
    combined_blocks = [
        {"type": "text", "content": resolved_message, "html": welcome_html},
        {"type": "divider"},
        *digest_blocks,
    ]

    return render_digest_email(
        date_str=digest_date_str,
        blocks=combined_blocks,
        unsubscribe_url=unsubscribe_url,
    )
```

**Step 2: Commit**

```bash
git add backend/app/services/email.py
git commit -m "feat: add render_welcome_email service function"
```

---

### Task 5: Write tests for welcome email rendering

**Files:**
- Modify: `backend/tests/test_subscribers_api.py`

**Step 1: Add test for render_welcome_email**

Add at the end of `backend/tests/test_subscribers_api.py`:

```python
@pytest.mark.asyncio
async def test_render_welcome_email():
    from app.services.email import render_welcome_email

    digest_blocks = [
        {"type": "text", "content": "Daily digest content", "html": "<p>Daily digest content</p>"},
        {"type": "topic-header", "title": "AI News", "topic_number": 1},
    ]

    html = render_welcome_email(
        welcome_message="Welcome! Latest from {{date}} — {{subject}}",
        welcome_subject="3/10/26 abridged tech",
        digest_date_str="March 10, 2026",
        digest_blocks=digest_blocks,
        unsubscribe_url="https://example.com/unsub",
    )

    assert "Welcome!" in html
    assert "March 10, 2026" in html
    assert "3/10/26 abridged tech" in html
    assert "Daily digest content" in html
    assert "AI News" in html
    assert "<hr" in html  # divider between welcome and digest
    assert "https://example.com/unsub" in html
```

**Step 2: Run the test**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_subscribers_api.py::test_render_welcome_email -v
```

Expected: PASS

**Step 3: Commit**

```bash
git add backend/tests/test_subscribers_api.py
git commit -m "test: add test for welcome email rendering"
```

---

### Task 6: Digest settings API endpoints

**Files:**
- Modify: `backend/app/routers/digest.py`

**Step 1: Add imports at the top of `backend/app/routers/digest.py`**

Add to existing imports:

```python
from app.models.digest_settings import DigestSettings, DEFAULT_WELCOME_MESSAGE
from app.schemas.digest import DigestSettingsOut, DigestSettingsUpdate
from app.services.email import render_welcome_email
```

**Step 2: Add helper to get-or-create settings row**

Add near the other helper functions (after `_format_date` / `_default_subject`):

```python
async def _get_or_create_settings(db: AsyncSession) -> DigestSettings:
    """Get the single DigestSettings row, creating defaults if none exists."""
    result = await db.execute(select(DigestSettings).where(DigestSettings.id == 1))
    settings_row = result.scalar_one_or_none()
    if not settings_row:
        settings_row = DigestSettings(
            id=1,
            welcome_send_mode="off",
            welcome_subject="no little piggies allowed",
            welcome_message=DEFAULT_WELCOME_MESSAGE,
        )
        db.add(settings_row)
        await db.commit()
        await db.refresh(settings_row)
    return settings_row
```

**Step 3: Add GET /api/digest/settings endpoint**

```python
@router.get("/settings", response_model=DigestSettingsOut)
async def get_digest_settings(db: AsyncSession = Depends(get_db)):
    """Get digest settings (upserts defaults if none exist)."""
    return await _get_or_create_settings(db)
```

**Step 4: Add PATCH /api/digest/settings endpoint**

```python
@router.patch("/settings", response_model=DigestSettingsOut)
async def update_digest_settings(body: DigestSettingsUpdate, db: AsyncSession = Depends(get_db)):
    """Update digest settings."""
    settings_row = await _get_or_create_settings(db)
    if body.welcome_send_mode is not None:
        if body.welcome_send_mode not in ("off", "hourly", "immediate"):
            raise HTTPException(400, "welcome_send_mode must be 'off', 'hourly', or 'immediate'")
        settings_row.welcome_send_mode = body.welcome_send_mode
    if body.welcome_subject is not None:
        settings_row.welcome_subject = body.welcome_subject
    if body.welcome_message is not None:
        settings_row.welcome_message = body.welcome_message
    await db.commit()
    await db.refresh(settings_row)
    return settings_row
```

**Step 5: Add GET /api/digest/settings/welcome-preview endpoint**

```python
@router.get("/settings/welcome-preview")
async def welcome_preview(db: AsyncSession = Depends(get_db)):
    """Render a preview of the welcome email using current settings + latest sent digest."""
    settings_row = await _get_or_create_settings(db)

    # Find latest sent draft
    result = await db.execute(
        select(DigestDraft)
        .where(DigestDraft.status == "sent")
        .order_by(DigestDraft.sent_at.desc())
        .limit(1)
    )
    latest_draft = result.scalar_one_or_none()

    if not latest_draft:
        # No digest sent yet — render just the welcome message
        import markdown as md
        resolved = settings_row.welcome_message
        welcome_html = md.markdown(resolved, extensions=["extra"])
        return {
            "subject": settings_row.welcome_subject,
            "html": f"<div style='padding:20px;font-family:sans-serif;'>{welcome_html}<hr style='margin:24px 0;border:none;border-top:1px solid #333;'/><p style='color:#71767b;font-style:italic;'>No digest sent yet — welcome email will begin sending after your first digest.</p></div>",
            "has_digest": False,
            "template_vars": {},
        }

    # Build digest content and render welcome email
    blocks = await _build_digest_content(latest_draft, db)
    date_str = _format_date(latest_draft.date)
    digest_subject = latest_draft.subject or _default_subject(latest_draft.date)

    html = render_welcome_email(
        welcome_message=settings_row.welcome_message,
        welcome_subject=digest_subject,
        digest_date_str=date_str,
        digest_blocks=blocks,
        unsubscribe_url="{{unsubscribe_url}}",
    )

    return {
        "subject": settings_row.welcome_subject,
        "html": html,
        "has_digest": True,
        "template_vars": {
            "date": date_str,
            "subject": digest_subject,
        },
    }
```

**Step 6: Add POST /api/digest/settings/welcome-test endpoint**

```python
@router.post("/settings/welcome-test")
async def welcome_test(db: AsyncSession = Depends(get_db)):
    """Send a test welcome email to the admin email."""
    settings_row = await _get_or_create_settings(db)

    if not settings.admin_email:
        raise HTTPException(400, "No admin_email configured")

    # Find latest sent draft
    result = await db.execute(
        select(DigestDraft)
        .where(DigestDraft.status == "sent")
        .order_by(DigestDraft.sent_at.desc())
        .limit(1)
    )
    latest_draft = result.scalar_one_or_none()
    if not latest_draft:
        raise HTTPException(400, "No sent digest yet — cannot send welcome test")

    blocks = await _build_digest_content(latest_draft, db)
    date_str = _format_date(latest_draft.date)
    digest_subject = latest_draft.subject or _default_subject(latest_draft.date)

    html = render_welcome_email(
        welcome_message=settings_row.welcome_message,
        welcome_subject=digest_subject,
        digest_date_str=date_str,
        digest_blocks=blocks,
        unsubscribe_url="#",
    )

    email_result = send_digest_email(
        settings.admin_email,
        f"[TEST] {settings_row.welcome_subject}",
        html,
    )
    return {"sent_to": settings.admin_email, "result": email_result}
```

**Step 7: Commit**

```bash
git add backend/app/routers/digest.py
git commit -m "feat: add digest settings CRUD, welcome preview, and test send endpoints"
```

---

### Task 7: Welcome email send logic (shared service)

**Files:**
- Modify: `backend/app/routers/digest.py`

**Step 1: Add the `send_welcome_emails` function**

Add this as a module-level async function in `backend/app/routers/digest.py` (near the other helpers):

```python
async def _send_welcome_emails(subscribers: list, db: AsyncSession) -> list[dict]:
    """Send welcome email to given subscribers using latest sent digest. Returns send results.

    Skips subscribers who already received the latest draft (dedup via digest_send_logs).
    """
    # Load settings
    settings_row = await _get_or_create_settings(db)
    if settings_row.welcome_send_mode == "off":
        return []

    # Find latest sent draft
    result = await db.execute(
        select(DigestDraft)
        .where(DigestDraft.status == "sent")
        .order_by(DigestDraft.sent_at.desc())
        .limit(1)
    )
    latest_draft = result.scalar_one_or_none()
    if not latest_draft:
        return []

    # Filter out subscribers who already got this draft
    sub_ids = [s.id for s in subscribers]
    existing_logs = await db.execute(
        select(DigestSendLog.subscriber_id)
        .where(
            DigestSendLog.draft_id == latest_draft.id,
            DigestSendLog.subscriber_id.in_(sub_ids),
        )
    )
    already_sent = set(existing_logs.scalars().all())
    eligible = [s for s in subscribers if s.id not in already_sent]
    if not eligible:
        return []

    # Build welcome email content
    blocks = await _build_digest_content(latest_draft, db)
    date_str = _format_date(latest_draft.date)
    digest_subject = latest_draft.subject or _default_subject(latest_draft.date)

    # Build batch
    batch_emails = []
    sub_by_email: dict[str, "Subscriber"] = {}
    for sub in eligible:
        unsubscribe_url = f"https://abridged.tech/api/subscribers/unsubscribe?token={sub.unsubscribe_token}"
        html = render_welcome_email(
            welcome_message=settings_row.welcome_message,
            welcome_subject=digest_subject,
            digest_date_str=date_str,
            digest_blocks=blocks,
            unsubscribe_url=unsubscribe_url,
        )
        batch_emails.append({
            "to_email": sub.email,
            "subject": settings_row.welcome_subject,
            "html_content": html,
            "unsubscribe_url": unsubscribe_url,
        })
        sub_by_email[sub.email] = sub

    # Send
    results = send_digest_batch(batch_emails)

    # Log results to digest_send_logs (for dedup)
    for r in results:
        sub = sub_by_email[r["to_email"]]
        log = DigestSendLog(
            draft_id=latest_draft.id,
            subscriber_id=sub.id,
            email=sub.email,
            status="sent" if r["success"] else "failed",
            error_message=r["error"],
            resend_message_id=r["result"].get("id") if r["result"] and isinstance(r["result"], dict) else None,
        )
        db.add(log)

    await db.commit()
    return results
```

**Step 2: Commit**

```bash
git add backend/app/routers/digest.py
git commit -m "feat: add shared _send_welcome_emails function with dedup logic"
```

---

### Task 8: Process-welcome cron endpoint (hourly)

**Files:**
- Modify: `backend/app/routers/digest.py`

**Step 1: Add the cron endpoint**

Add after the existing `process_scheduled` endpoint:

```python
@router.post("/process-welcome")
async def process_welcome(db: AsyncSession = Depends(get_db)):
    """Process welcome emails for recent subscribers. Designed for hourly cron."""
    settings_row = await _get_or_create_settings(db)
    if settings_row.welcome_send_mode != "hourly":
        return {"processed": 0, "mode": settings_row.welcome_send_mode, "message": "Not in hourly mode"}

    # Find subscribers from last 2 hours (overlap window for safety)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=2)
    result = await db.execute(
        select(Subscriber).where(
            Subscriber.subscribed_at >= cutoff,
            Subscriber.unsubscribed_at.is_(None),
        )
    )
    new_subscribers = result.scalars().all()

    if not new_subscribers:
        return {"processed": 0, "message": "No new subscribers"}

    results = await _send_welcome_emails(new_subscribers, db)
    sent = sum(1 for r in results if r["success"])
    return {"processed": sent, "total_eligible": len(new_subscribers)}
```

Also add `timedelta` to the `datetime` imports at the top of the file if not already present:

```python
from datetime import datetime, timezone, timedelta
```

**Step 2: Commit**

```bash
git add backend/app/routers/digest.py
git commit -m "feat: add process-welcome cron endpoint for hourly batch"
```

---

### Task 9: Immediate welcome trigger in subscribe endpoint

**Files:**
- Modify: `backend/app/routers/subscribers.py`

**Step 1: Add welcome email trigger after successful subscription**

Modify the `subscribe` function to trigger immediate welcome email when mode is `"immediate"`. Add after line 42 (`await db.commit()`), before the return:

```python
    # Trigger immediate welcome email if configured
    try:
        from app.routers.digest import _get_or_create_settings, _send_welcome_emails
        digest_settings = await _get_or_create_settings(db)
        if digest_settings.welcome_send_mode == "immediate":
            await db.refresh(subscriber)
            await _send_welcome_emails([subscriber], db)
    except Exception:
        # Welcome email failure should not break subscription
        import logging
        logging.getLogger(__name__).exception("Failed to send welcome email")
```

**Step 2: Commit**

```bash
git add backend/app/routers/subscribers.py
git commit -m "feat: trigger immediate welcome email on subscribe when configured"
```

---

### Task 10: Write tests for digest settings API

**Files:**
- Modify: `backend/tests/test_digest_api.py`

**Step 1: Add DigestSettings to test model imports**

At line 17 of `backend/tests/test_digest_api.py`, add `DigestSettings` to the import:

```python
from app.models import Tweet, Topic, TweetAssignment, Subscriber, DigestDraft, DigestSendLog, EmailEvent, DigestSettings  # noqa: F401
```

**Step 2: Add tests for settings endpoints**

Add at the end of the file:

```python
@pytest.mark.asyncio
async def test_get_digest_settings_creates_defaults(client: AsyncClient):
    """GET /api/digest/settings should return defaults if no row exists."""
    resp = await client.get("/api/digest/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert data["welcome_send_mode"] == "off"
    assert data["welcome_subject"] == "no little piggies allowed"
    assert "subscribing" in data["welcome_message"]


@pytest.mark.asyncio
async def test_update_digest_settings(client: AsyncClient):
    """PATCH /api/digest/settings should update and persist."""
    # Ensure defaults exist
    await client.get("/api/digest/settings")

    resp = await client.patch("/api/digest/settings", json={
        "welcome_send_mode": "hourly",
        "welcome_subject": "hey there!",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["welcome_send_mode"] == "hourly"
    assert data["welcome_subject"] == "hey there!"
    # Message should remain default (not updated)
    assert "subscribing" in data["welcome_message"]

    # Verify persistence
    resp2 = await client.get("/api/digest/settings")
    assert resp2.json()["welcome_send_mode"] == "hourly"


@pytest.mark.asyncio
async def test_update_digest_settings_invalid_mode(client: AsyncClient):
    """PATCH with invalid send mode should return 400."""
    await client.get("/api/digest/settings")
    resp = await client.patch("/api/digest/settings", json={
        "welcome_send_mode": "invalid",
    })
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_welcome_preview_no_digest(client: AsyncClient):
    """Preview should return placeholder when no digest has been sent."""
    resp = await client.get("/api/digest/settings/welcome-preview")
    assert resp.status_code == 200
    data = resp.json()
    assert data["has_digest"] is False
    assert "No digest sent yet" in data["html"]


@pytest.mark.asyncio
async def test_welcome_preview_with_sent_digest(client: AsyncClient):
    """Preview should render welcome message + digest content."""
    # Create and mark a draft as sent
    create_resp = await client.post("/api/digest/drafts", json={
        "date": "2026-03-10",
        "content_blocks": [
            {"id": "b1", "type": "text", "content": "Daily digest text"},
        ],
        "subject": "3/10/26 abridged tech",
    })
    draft_id = create_resp.json()["id"]
    async with async_session() as session:
        draft = await session.get(DigestDraft, draft_id)
        draft.status = "sent"
        draft.sent_at = datetime(2026, 3, 10, 8, 0, tzinfo=timezone.utc)
        await session.commit()

    resp = await client.get("/api/digest/settings/welcome-preview")
    assert resp.status_code == 200
    data = resp.json()
    assert data["has_digest"] is True
    assert "subscribing" in data["html"]  # welcome message
    assert "Daily digest text" in data["html"]  # digest content
    assert data["template_vars"]["subject"] == "3/10/26 abridged tech"


@pytest.mark.asyncio
async def test_welcome_dedup_skips_already_sent(client: AsyncClient):
    """Welcome email should not send to subscribers who already received the latest digest."""
    import secrets

    # Create subscriber
    async with async_session() as session:
        sub = Subscriber(email="dedup@test.com", unsubscribe_token=secrets.token_urlsafe(32))
        session.add(sub)
        await session.commit()
        await session.refresh(sub)
        sub_id = sub.id

    # Create sent draft
    create_resp = await client.post("/api/digest/drafts", json={
        "date": "2026-03-10",
        "content_blocks": [{"id": "b1", "type": "text", "content": "Hello"}],
    })
    draft_id = create_resp.json()["id"]
    async with async_session() as session:
        draft = await session.get(DigestDraft, draft_id)
        draft.status = "sent"
        draft.sent_at = datetime(2026, 3, 10, 8, 0, tzinfo=timezone.utc)
        # Add existing send log — subscriber already got this digest
        log = DigestSendLog(
            draft_id=draft_id,
            subscriber_id=sub_id,
            email="dedup@test.com",
            status="sent",
        )
        session.add(log)
        await session.commit()

    # Enable welcome emails
    await client.patch("/api/digest/settings", json={"welcome_send_mode": "hourly"})

    # Process welcome — should skip this subscriber
    def mock_batch(emails):
        return [{"to_email": e["to_email"], "success": True, "result": {"id": "msg"}, "error": None} for e in emails]

    with patch("app.routers.digest.send_digest_batch", side_effect=mock_batch):
        resp = await client.post("/api/digest/process-welcome")
    assert resp.status_code == 200
    assert resp.json()["processed"] == 0
```

**Step 3: Run the tests**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_digest_api.py -v -k "welcome or digest_settings"
```

Expected: All new tests PASS

**Step 4: Commit**

```bash
git add backend/tests/test_digest_api.py
git commit -m "test: add tests for digest settings API and welcome email dedup"
```

---

### Task 11: Frontend API hooks for digest settings

**Files:**
- Modify: `frontend/src/api/digest.ts`

**Step 1: Add types and hooks at the end of `frontend/src/api/digest.ts`**

```typescript
// ---- Welcome Email Settings ----

export interface DigestSettings {
  welcome_send_mode: 'off' | 'hourly' | 'immediate'
  welcome_subject: string
  welcome_message: string
  updated_at: string | null
}

export interface WelcomePreview {
  subject: string
  html: string
  has_digest: boolean
  template_vars: Record<string, string>
}

export function useDigestSettings() {
  return useQuery<DigestSettings>({
    queryKey: ['digest-settings'],
    queryFn: () => client.get('/digest/settings').then(r => r.data),
  })
}

export function useUpdateDigestSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<DigestSettings>) =>
      client.patch('/digest/settings', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['digest-settings'] })
    },
  })
}

export function useWelcomePreview(enabled: boolean) {
  return useQuery<WelcomePreview>({
    queryKey: ['welcome-preview'],
    queryFn: () => client.get('/digest/settings/welcome-preview').then(r => r.data),
    enabled,
  })
}

export function useSendWelcomeTest() {
  return useMutation({
    mutationFn: () => client.post('/digest/settings/welcome-test').then(r => r.data),
  })
}
```

Also add `useQueryClient` to the existing `@tanstack/react-query` import if not already imported. Check the existing imports — likely `useQuery` and `useMutation` are already imported but `useQueryClient` may need to be added.

**Step 2: Commit**

```bash
git add frontend/src/api/digest.ts
git commit -m "feat: add frontend API hooks for digest settings and welcome preview"
```

---

### Task 12: Welcome Email page (frontend)

**Files:**
- Create: `frontend/src/pages/WelcomeEmailPage.tsx`

**Step 1: Create the page component**

```tsx
// frontend/src/pages/WelcomeEmailPage.tsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  useDigestSettings,
  useUpdateDigestSettings,
  useWelcomePreview,
  useSendWelcomeTest,
} from '../api/digest'

const SEND_MODES = [
  { value: 'off', label: 'Off' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'immediate', label: 'Immediate' },
] as const

export function WelcomeEmailPage() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const { data: settings, isLoading } = useDigestSettings()
  const updateSettings = useUpdateDigestSettings()
  const { data: preview, refetch: refetchPreview } = useWelcomePreview(true)
  const sendTest = useSendWelcomeTest()

  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sendMode, setSendMode] = useState<'off' | 'hourly' | 'immediate'>('off')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [initialized, setInitialized] = useState(false)

  const previewDebounceRef = useRef<ReturnType<typeof setTimeout>>()

  // Initialize form from settings
  useEffect(() => {
    if (settings && !initialized) {
      setSubject(settings.welcome_subject)
      setMessage(settings.welcome_message)
      setSendMode(settings.welcome_send_mode)
      setInitialized(true)
    }
  }, [settings, initialized])

  // Debounced preview refresh when message changes
  useEffect(() => {
    if (!initialized) return
    clearTimeout(previewDebounceRef.current)
    previewDebounceRef.current = setTimeout(() => {
      refetchPreview()
    }, 800)
    return () => clearTimeout(previewDebounceRef.current)
  }, [message, subject, initialized, refetchPreview])

  const handleSendModeChange = useCallback((mode: 'off' | 'hourly' | 'immediate') => {
    setSendMode(mode)
    setSaveStatus('saving')
    updateSettings.mutate({ welcome_send_mode: mode }, {
      onSuccess: () => {
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      },
    })
  }, [updateSettings])

  const handleSave = useCallback(() => {
    setSaveStatus('saving')
    updateSettings.mutate(
      { welcome_subject: subject, welcome_message: message },
      {
        onSuccess: () => {
          setSaveStatus('saved')
          setTimeout(() => setSaveStatus('idle'), 2000)
          refetchPreview()
        },
      }
    )
  }, [subject, message, updateSettings, refetchPreview])

  const handleSendTest = useCallback(() => {
    setTestStatus('sending')
    sendTest.mutate(undefined, {
      onSuccess: () => {
        setTestStatus('sent')
        setTimeout(() => setTestStatus('idle'), 3000)
      },
      onError: () => {
        setTestStatus('error')
        setTimeout(() => setTestStatus('idle'), 3000)
      },
    })
  }, [sendTest])

  // Resolve template vars for tooltip display
  const resolvedVars = preview?.template_vars || {}

  if (!isAdmin) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Admin access required</div>
  }

  if (isLoading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading...</div>
  }

  const isDimmed = sendMode === 'off'

  return (
    <div style={{ height: '100dvh', overflowY: 'auto', background: 'var(--bg-base)' }}>
      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 40,
        background: 'var(--bg-base)', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{
          maxWidth: 640, margin: '0 auto', padding: '16px 24px',
          display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <button
            onClick={() => navigate('/app/digest')}
            style={{
              background: 'none', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)',
              padding: '6px 12px', fontSize: 13, cursor: 'pointer',
              fontFamily: 'var(--font-body)', transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-strong)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
          >
            &#8592; Back
          </button>

          <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', margin: 0, flex: 1 }}>
            Welcome Email
          </h1>

          {saveStatus === 'saving' && (
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Saving...</span>
          )}
          {saveStatus === 'saved' && (
            <span style={{ fontSize: 12, color: '#4ade80' }}>Saved</span>
          )}
        </div>
      </header>

      {/* Content */}
      <main style={{
        maxWidth: 640, margin: '0 auto', padding: '24px 24px 80px',
        display: 'flex', flexDirection: 'column', gap: 24,
      }}>
        {/* Send Mode */}
        <section style={{
          background: 'var(--bg-raised)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', overflow: 'hidden',
        }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
              Send mode
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-tertiary)' }}>
              Control when welcome emails are sent to new subscribers
            </p>
          </div>
          <div style={{ padding: '16px 20px', display: 'flex', gap: 8 }}>
            {SEND_MODES.map(mode => (
              <button
                key={mode.value}
                onClick={() => handleSendModeChange(mode.value)}
                style={{
                  background: sendMode === mode.value ? 'var(--accent)' : 'transparent',
                  color: sendMode === mode.value ? '#fff' : 'var(--text-secondary)',
                  border: sendMode === mode.value ? 'none' : '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '8px 16px', fontSize: 13, cursor: 'pointer',
                  fontFamily: 'var(--font-body)', fontWeight: sendMode === mode.value ? 600 : 400,
                  transition: 'all 0.15s ease',
                }}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </section>

        {/* Subject & Message */}
        <section style={{
          background: 'var(--bg-raised)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', overflow: 'hidden',
          opacity: isDimmed ? 0.5 : 1, transition: 'opacity 0.2s ease',
        }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
              Email content
            </h2>
          </div>
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Subject */}
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Subject
              </label>
              <input
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                style={{
                  width: '100%', background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                  padding: '8px 12px', fontSize: 14, color: 'var(--text-primary)',
                  fontFamily: 'var(--font-body)', outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Welcome Message */}
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4 }}>
                Welcome message
              </label>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span>Available:</span>
                {['date', 'subject'].map(v => (
                  <span
                    key={v}
                    title={resolvedVars[v] ? `Current value: ${resolvedVars[v]}` : 'No digest sent yet'}
                    style={{
                      background: 'var(--bg-elevated)', padding: '1px 6px',
                      borderRadius: 'var(--radius-sm)', cursor: 'help',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {`{{${v}}}`}
                  </span>
                ))}
              </div>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={5}
                style={{
                  width: '100%', background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                  padding: '8px 12px', fontSize: 14, color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)', outline: 'none', resize: 'vertical',
                  lineHeight: 1.5, boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={handleSendTest}
                disabled={testStatus === 'sending' || !preview?.has_digest}
                style={{
                  background: 'transparent', color: 'var(--text-secondary)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                  padding: '9px 18px', fontSize: 13, cursor: 'pointer',
                  fontFamily: 'var(--font-body)', transition: 'all 0.15s ease',
                  opacity: testStatus === 'sending' || !preview?.has_digest ? 0.5 : 1,
                }}
              >
                {testStatus === 'sending' ? 'Sending...' : testStatus === 'sent' ? 'Sent!' : testStatus === 'error' ? 'Failed' : 'Send Test'}
              </button>
              <button
                onClick={handleSave}
                style={{
                  background: 'var(--accent)', color: '#fff', border: 'none',
                  borderRadius: 'var(--radius-md)', padding: '9px 18px',
                  fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-body)',
                  fontWeight: 600, transition: 'all 0.15s ease',
                }}
              >
                Save
              </button>
            </div>
          </div>
        </section>

        {/* Preview */}
        <section style={{
          background: 'var(--bg-raised)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', overflow: 'hidden',
          opacity: isDimmed ? 0.5 : 1, transition: 'opacity 0.2s ease',
        }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
              Preview
            </h2>
            {preview?.subject && (
              <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                Subject: {preview.subject}
              </span>
            )}
          </div>
          <div style={{ padding: 0 }}>
            {preview?.html ? (
              <iframe
                srcDoc={preview.html}
                title="Welcome email preview"
                style={{
                  width: '100%', minHeight: 600, border: 'none',
                  background: '#fff',
                }}
              />
            ) : (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                Loading preview...
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add frontend/src/pages/WelcomeEmailPage.tsx
git commit -m "feat: add WelcomeEmailPage with settings form and live preview"
```

---

### Task 13: Route registration and navigation

**Files:**
- Modify: `frontend/src/App.tsx` (add route)
- Modify: `frontend/src/pages/DigestComposer.tsx` (add nav button)

**Step 1: Add route in App.tsx**

Add import at the top:

```tsx
import { WelcomeEmailPage } from './pages/WelcomeEmailPage'
```

Add route after the analytics route (after line 35):

```tsx
<Route path="/app/welcome-email" element={<WelcomeEmailPage />} />
```

**Step 2: Add navigation button in DigestComposer.tsx**

Add a "Welcome" button after the "Analytics" button (after line 1707). Use the same button style:

```tsx
          <button
            onClick={() => navigate('/app/welcome-email')}
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
            Welcome
          </button>
```

**Step 3: Commit**

```bash
git add frontend/src/App.tsx frontend/src/pages/DigestComposer.tsx
git commit -m "feat: add welcome email route and nav button in digest composer"
```

---

### Task 14: Run full test suite

**Step 1: Run all backend tests**

```bash
backend/.venv/bin/python -m pytest backend/tests/ -q
```

Expected: All tests PASS, no regressions.

**Step 2: Run TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: No errors.

**Step 3: Fix any failures**

If any tests fail or TypeScript errors occur, fix them before proceeding.

**Step 4: Commit any fixes**

```bash
git add -A && git commit -m "fix: resolve test/type issues from welcome email feature"
```

---

### Task 15: Final verification and commit

**Step 1: Verify the complete feature works end-to-end**

Check:
- `GET /api/digest/settings` returns defaults
- `PATCH /api/digest/settings` updates and persists
- `GET /api/digest/settings/welcome-preview` renders correctly
- `POST /api/digest/process-welcome` respects mode and dedup
- Frontend page loads at `/app/welcome-email`
- TypeScript compiles cleanly

**Step 2: Run full test suite one final time**

```bash
backend/.venv/bin/python -m pytest backend/tests/ -q && cd frontend && npx tsc --noEmit
```

**Step 3: Final commit if needed**

```bash
git add -A && git commit -m "feat: complete welcome email feature for new subscribers"
```
