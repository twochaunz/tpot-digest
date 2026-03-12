# Unsubscribe Tracking & Re-send Guard

## Problem

1. When a subscriber unsubscribes, we record *when* but not *which digest* triggered it. This makes it impossible to correlate unsubscribes with specific editions.
2. There's no guard against accidentally re-sending a draft that's already been batch-sent. A misclick could blast the same email twice.
3. If someone unsubscribes and later wants to re-subscribe, they're blocked because `unsubscribed_at` is a one-way door.

## Design

### 1. New `unsubscribe_events` table

Audit log of every unsubscribe action, preserving history across re-subscribe cycles.

| Column | Type | Description |
|---|---|---|
| `id` | Integer PK | Auto-increment |
| `subscriber_id` | FK → subscribers | Who unsubscribed |
| `draft_id` | FK → digest_drafts, nullable | Which digest triggered it (null for legacy/unknown) |
| `unsubscribed_at` | DateTime (tz) | When they clicked unsubscribe |

`subscribers.unsubscribed_at` remains as the quick "is this person active?" flag. The events table is the full history.

### 2. Unsubscribe URL change

**Current:** `/api/subscribers/unsubscribe?token=xxx`
**New:** `/api/subscribers/unsubscribe?token=xxx&digest=123`

The endpoint:
1. Sets `subscribers.unsubscribed_at = now()`
2. Creates an `unsubscribe_events` row with `subscriber_id`, `draft_id` (from `digest` param), and `unsubscribed_at`

The `digest` query param is optional for backward compatibility with emails already in inboxes.

### 3. Re-subscribe support

When someone subscribes via the website (`POST /api/subscribers`) and they already exist with `unsubscribed_at` set:
- Clear `unsubscribed_at` to re-activate them
- Keep the same subscriber record and unsubscribe token
- The `unsubscribe_events` history is preserved — no data loss

### 4. Email sending: include `draft_id` in unsubscribe URL

Update `send_digest_email()` and `send_digest_batch()` to build unsubscribe URLs with the draft_id:

```
https://abridged.tech/api/subscribers/unsubscribe?token={token}&digest={draft_id}
```

The `render_digest_email()` call and Jinja template don't need changes — they already accept an `unsubscribe_url` string.

### 5. Re-send warning dialog

#### Backend

New endpoint: `GET /api/digest/drafts/{draft_id}/send-status`

Response:
```json
{
  "previously_sent": true,
  "sent_count": 42,
  "sent_at": "2026-03-10T08:00:00Z"
}
```

Queries `digest_send_logs` for successful sends (`status = 'sent'`) for the given draft.

The send endpoint (`POST /api/digest/drafts/{draft_id}/send`) accepts an optional parameter to filter out subscribers who already have a send log entry for this draft (for the "new only" flow). It already receives a list of subscriber IDs, so this is a filter on the backend side.

#### Frontend

When the user clicks send (with subscribers selected), before actually sending:
1. Call `GET /api/digest/drafts/{draft_id}/send-status`
2. If `previously_sent` is false, proceed normally
3. If `previously_sent` is true, show a dialog:

**Dialog copy:**
> "This draft was already sent to {sent_count} subscribers on {sent_at}. {overlap_count} of your {selected_count} selected subscribers have already received it."

**Three buttons:**
- **Send anyway** — sends to all currently selected subscribers, including those who already received it
- **New only** — returns to the subscriber selection view with only subscribers who haven't received this draft still checked
- **Cancel** — closes dialog, no changes to selection

The overlap count is computed client-side by cross-referencing selected subscriber IDs against the send log data.

### 6. Migration

Single Alembic migration that:
1. Creates the `unsubscribe_events` table
2. Backfills from existing data: for each subscriber with `unsubscribed_at` set, create an `unsubscribe_events` row with `draft_id = NULL` (we don't know which digest triggered legacy unsubscribes)

## Out of scope

- Dedicated re-subscribe endpoint or email flow (users just sign up again via the website)
- Unsubscribe analytics dashboard (can be added later querying `unsubscribe_events`)
- Changing the unsubscribe confirmation HTML page
