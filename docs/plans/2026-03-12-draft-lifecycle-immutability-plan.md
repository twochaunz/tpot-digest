# Draft Lifecycle — Sent Immutability Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sent drafts immutable historical records with a duplicate-to-edit flow, splitting the dashboard into Drafts and Sent sections.

**Architecture:** Backend enforces immutability by rejecting PATCH on sent drafts. New POST duplicate endpoint clones a sent draft as a new editable draft. Frontend shows read-only view for sent drafts with a "Duplicate as draft" action.

**Tech Stack:** FastAPI, SQLAlchemy (async), React 19, TypeScript, TanStack React Query

---

## File Structure

- **Modify:** `backend/app/routers/digest.py` — PATCH guard, duplicate endpoint, welcome email query fix
- **Modify:** `backend/app/schemas/digest.py` — DigestDraftDuplicate response (reuses DigestDraftOut)
- **Modify:** `frontend/src/api/digest.ts` — useDuplicateDraft hook
- **Modify:** `frontend/src/pages/DigestComposer.tsx` — read-only mode, sent banner, duplicate flow
- **Modify:** `backend/tests/test_subscribers_api.py` — update welcome email test if needed
- **Create:** `backend/tests/test_draft_immutability.py` — tests for PATCH rejection, duplicate endpoint

---

### Task 1: Backend — Block edits to sent drafts

**Files:**
- Modify: `backend/app/routers/digest.py:613-640`

- [ ] **Step 1: Write failing test for PATCH rejection**

Create `backend/tests/test_draft_immutability.py`:

```python
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_patch_sent_draft_rejected(db_session):
    """PATCH on a sent draft should return 400."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Create draft
        r = await ac.post("/api/digest/drafts", json={"date": "2026-01-01", "content_blocks": []})
        draft_id = r.json()["id"]

        # Manually set status to sent via DB
        from sqlalchemy import text
        await db_session.execute(text(f"UPDATE digest_drafts SET status='sent' WHERE id={draft_id}"))
        await db_session.commit()

        # Attempt to edit
        r = await ac.patch(f"/api/digest/drafts/{draft_id}", json={"subject": "new subject"})
        assert r.status_code == 400
        assert "Cannot edit a sent draft" in r.json()["detail"]


@pytest.mark.asyncio
async def test_patch_draft_still_works(db_session):
    """PATCH on a non-sent draft should still work."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/digest/drafts", json={"date": "2026-01-01", "content_blocks": []})
        draft_id = r.json()["id"]

        r = await ac.patch(f"/api/digest/drafts/{draft_id}", json={"subject": "new subject"})
        assert r.status_code == 200
        assert r.json()["subject"] == "new subject"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_draft_immutability.py -v`
Expected: `test_patch_sent_draft_rejected` FAIL (currently returns 200)

- [ ] **Step 3: Implement the guard in update_draft**

In `backend/app/routers/digest.py`, modify `update_draft()` (line 613-640):

Replace lines 619-621:
```python
    # Reset status to 'draft' if editing a previously-sent draft
    if draft.status == "sent":
        draft.status = "draft"
```

With:
```python
    if draft.status == "sent":
        raise HTTPException(400, "Cannot edit a sent draft. Duplicate it first.")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_draft_immutability.py -v`
Expected: Both PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/digest.py backend/tests/test_draft_immutability.py
git commit -m "feat: block edits to sent drafts (immutability guard)"
```

---

### Task 2: Backend — Duplicate draft endpoint

**Files:**
- Modify: `backend/app/routers/digest.py` (add new endpoint after `update_draft`)

- [ ] **Step 1: Write failing test for duplicate endpoint**

Add to `backend/tests/test_draft_immutability.py`:

```python
@pytest.mark.asyncio
async def test_duplicate_sent_draft(db_session):
    """POST duplicate creates a new draft from a sent draft."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Create and "send" a draft
        r = await ac.post("/api/digest/drafts", json={
            "date": "2026-01-15",
            "content_blocks": [{"id": "b1", "type": "text", "content": "hello"}],
            "subject": "Original Subject",
        })
        original_id = r.json()["id"]

        from sqlalchemy import text
        await db_session.execute(text(
            f"UPDATE digest_drafts SET status='sent', sent_at=NOW(), recipient_count=42 WHERE id={original_id}"
        ))
        await db_session.commit()

        # Duplicate
        r = await ac.post(f"/api/digest/drafts/{original_id}/duplicate")
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
async def test_duplicate_nonexistent_draft(db_session):
    """POST duplicate on nonexistent draft returns 404."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.post("/api/digest/drafts/99999/duplicate")
        assert r.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_draft_immutability.py::test_duplicate_sent_draft -v`
Expected: FAIL (404 — endpoint doesn't exist)

- [ ] **Step 3: Implement duplicate endpoint**

Add after the `update_draft` function in `backend/app/routers/digest.py` (after line 640):

```python
@router.post("/drafts/{draft_id}/duplicate", response_model=DigestDraftOut, status_code=201)
async def duplicate_draft(draft_id: int, db: AsyncSession = Depends(get_db)):
    """Clone a draft as a new editable draft. Primary use: iterate on sent editions."""
    source = await db.get(DigestDraft, draft_id)
    if not source:
        raise HTTPException(404, "Draft not found")

    new_draft = DigestDraft(
        date=source.date,
        content_blocks=[dict(b) for b in source.content_blocks] if source.content_blocks else [],
        subject=source.subject,
    )
    db.add(new_draft)
    await db.commit()
    await db.refresh(new_draft)
    return new_draft
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_draft_immutability.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/digest.py backend/tests/test_draft_immutability.py
git commit -m "feat: add POST /drafts/{id}/duplicate endpoint"
```

---

### Task 3: Backend — Fix welcome email query

**Files:**
- Modify: `backend/app/routers/digest.py:511-516`

- [ ] **Step 1: Fix the query**

In `_send_welcome_emails()` (line 511-516), replace:

```python
    result = await db.execute(
        select(DigestDraft)
        .where(DigestDraft.status == "sent")
        .order_by(DigestDraft.sent_at.desc())
        .limit(1)
    )
```

With:

```python
    result = await db.execute(
        select(DigestDraft)
        .where(DigestDraft.sent_at.is_not(None))
        .order_by(DigestDraft.sent_at.desc())
        .limit(1)
    )
```

- [ ] **Step 2: Run existing tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -q`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/digest.py
git commit -m "fix: use sent_at instead of status for welcome email draft lookup"
```

---

### Task 4: Frontend — Add useDuplicateDraft hook

**Files:**
- Modify: `frontend/src/api/digest.ts`

- [ ] **Step 1: Add the hook**

Add after `useDeleteDigestDraft` (after line 106) in `frontend/src/api/digest.ts`:

```typescript
export function useDuplicateDraft() {
  const qc = useQueryClient()
  return useMutation<DigestDraft, Error, number>({
    mutationFn: async (id) => {
      const { data } = await api.post(`/digest/drafts/${id}/duplicate`)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['digest-drafts'] })
    },
  })
}
```

- [ ] **Step 2: TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/digest.ts
git commit -m "feat: add useDuplicateDraft hook"
```

---

### Task 5: Frontend — Read-only mode for sent drafts

**Files:**
- Modify: `frontend/src/pages/DigestComposer.tsx`

This task adds:
1. A sent banner with "Duplicate as draft" button replacing the editing controls
2. Disables block editor, subject input, and action buttons when viewing a sent draft

- [ ] **Step 1: Add duplicate hook and isSent-based read-only gating**

In DigestComposer component, add the duplicate hook near the other hooks (around line 1309-1315):

```typescript
const duplicateDraft = useDuplicateDraft()
```

Add import for `useDuplicateDraft` at the top with other digest imports.

- [ ] **Step 2: Add sent banner**

Find the section after the draft selector dropdown (around line 2050-2060, the area that shows "Last sent..." info). Replace/add a sent draft banner when `draft?.status === 'sent'`:

```typescript
{selectedDraftId && draft?.status === 'sent' && (
  <div style={{
    background: 'rgba(74, 222, 128, 0.08)',
    border: '1px solid rgba(74, 222, 128, 0.2)',
    borderRadius: 'var(--radius-md)',
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  }}>
    <span style={{ fontSize: 13, color: '#4ade80' }}>
      Sent on {draft.sent_at ? new Date(draft.sent_at).toLocaleDateString() : '—'} to {draft.recipient_count ?? 0} recipients
    </span>
    <button
      onClick={async () => {
        const newDraft = await duplicateDraft.mutateAsync(selectedDraftId)
        setSelectedDraftId(newDraft.id)
      }}
      disabled={duplicateDraft.isPending}
      style={{
        background: 'var(--accent)',
        color: '#fff',
        border: 'none',
        borderRadius: 'var(--radius-md)',
        padding: '6px 14px',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'var(--font-body)',
        whiteSpace: 'nowrap',
      }}
    >
      {duplicateDraft.isPending ? 'Duplicating...' : 'Duplicate as draft'}
    </button>
  </div>
)}
```

- [ ] **Step 3: Disable editing controls for sent drafts**

Define a read-only flag near the top of the render logic:

```typescript
const isReadOnly = draft?.status === 'sent'
```

Then gate the following controls:

1. **Subject input** (line ~2556): Add `disabled={isReadOnly}` and reduce opacity when disabled
2. **Block editor drag-and-drop and add-block buttons** (lines ~2187-2278): Wrap in `{!isReadOnly && ...}` for the add buttons; disable drag handles
3. **Schedule send section** (lines ~2295-2347): Wrap in `{!isReadOnly && ...}`
4. **Action buttons** (send test, send now — lines ~2351-2369): Wrap in `{!isReadOnly && ...}`

Replace the action buttons block with:

```typescript
{selectedDraftId && !isReadOnly && (
  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
    {/* existing Send Test + Send Now buttons */}
  </div>
)}
```

- [ ] **Step 4: TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DigestComposer.tsx frontend/src/api/digest.ts
git commit -m "feat: read-only mode for sent drafts with duplicate action"
```

---

### Task 6: Frontend — Add "Duplicate as draft" to inline list and modal

**Files:**
- Modify: `frontend/src/pages/DigestComposer.tsx`

- [ ] **Step 1: Update inline drafts list sent section**

In the inline drafts list (lines 2161-2181), the sent section currently uses a collapsible `<details>` element. Update it to be a full section (not collapsed by default) with the same visual treatment as the Drafts section, but with a "Sent" header:

Replace the `<details>` wrapper for sent drafts with a card matching the drafts section style. Each sent row should show subject/date, topic count, recipient count, and sent date. Clicking a sent row opens it in read-only mode (same as now — `setSelectedDraftId`).

- [ ] **Step 2: Update DraftsModal sent section**

In DraftsModal (lines 832-953), the sent section already renders correctly with green "Sent" label. No changes needed — clicking opens the draft in read-only mode via the existing guard in Task 5.

- [ ] **Step 3: TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/DigestComposer.tsx
git commit -m "feat: update sent section in drafts list to match design"
```

---

### Task 7: Run all tests and verify

- [ ] **Step 1: Run backend tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -q`
Expected: All pass

- [ ] **Step 2: Run frontend type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Manual verification checklist**

1. Open DigestComposer dashboard
2. Verify sent drafts show in "Sent" section (not collapsed)
3. Click a sent draft — verify it opens read-only (no editing controls, sent banner visible)
4. Click "Duplicate as draft" — verify new draft created and auto-selected for editing
5. Verify unsent drafts still edit normally
6. Try PATCH on a sent draft via API — verify 400 response
