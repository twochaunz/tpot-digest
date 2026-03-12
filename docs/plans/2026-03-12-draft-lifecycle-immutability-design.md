# Draft Lifecycle — Sent Immutability

## Problem

When a sent draft is edited, its `status` resets from `"sent"` to `"draft"`. This causes:

1. **Welcome email bug**: `_send_welcome_emails` queries `WHERE status == "sent"` and misses drafts whose status was reset, sending an older edition instead.
2. **No historical record**: Sent editions can be silently modified after delivery, destroying the record of what subscribers actually received.

## Solution

Sent drafts become immutable historical records. To iterate on a sent edition, duplicate it as a new draft.

## Backend Changes

### 1. PATCH `/digest/drafts/{id}` — reject edits to sent drafts

If `draft.status == "sent"`, return 400: `"Cannot edit a sent draft. Duplicate it first."`

Remove the existing line that resets `status = "draft"` when a sent draft is edited.

### 2. New endpoint: `POST /digest/drafts/{id}/duplicate`

Clones a draft into a new one with fresh state.

**Copies:** `date`, `content_blocks`, `subject`
**Resets:** `status = "draft"`, `sent_at = None`, `recipient_count = None`, `scheduled_for = None`

Returns the new draft. Works on any draft status but primary use case is duplicating sent ones.

### 3. Fix `_send_welcome_emails` query

Change from `WHERE status == "sent"` to `WHERE sent_at IS NOT NULL ORDER BY sent_at DESC LIMIT 1`.

`sent_at` is the actual timestamp and is more reliable than status for identifying what was last sent.

## Frontend Changes

### 4. Dashboard split: Drafts and Sent sections

Both the inline drafts list and the DraftsModal are reorganized into two sections:

**Drafts** (top) — `draft` and `scheduled` status items:
- Click to edit
- Can delete

**Sent** (below) — `sent` status items:
- Click to view (read-only)
- Shows recipient count + sent date
- "Duplicate as draft" action
- No delete (historical records)

### 5. Read-only mode for sent drafts

When the selected draft has `status === "sent"`:
- Disable all editing controls (block editor, subject input, date picker, schedule controls)
- Show a banner: "Sent on {date} to {count} recipients" with a "Duplicate as draft" button
- Replace the send button area with the duplicate button

### 6. Duplicate flow

1. User clicks "Duplicate as draft" on a sent item
2. Frontend calls `POST /drafts/{id}/duplicate`
3. Response returns new draft
4. Auto-select the new draft for editing
5. Invalidate drafts list cache

## Side Effects

- **Welcome email bug fixed**: Sent drafts permanently keep `status = "sent"`, so the welcome email query always finds the correct latest edition.
- **Re-send warning still works**: The existing re-send dialog and `send-status` endpoint are unaffected.
- **No migration needed**: No schema changes — this is purely behavioral (endpoint logic + frontend UI).
