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
| `subscriber_id` | FK → subscribers, indexed | Who unsubscribed |
| `draft_id` | FK → digest_drafts, nullable, indexed | Which digest triggered it (null for legacy/unknown) |
| `unsubscribed_at` | DateTime (tz) | When they clicked unsubscribe |

Indexes on `subscriber_id` (query unsubscribe history per subscriber) and `draft_id` (correlate unsubscribes to specific digests).

`subscribers.unsubscribed_at` remains as the quick "is this person active?" flag. The events table is the full history.

### 2. Unsubscribe URL change

**Current:** `/api/subscribers/unsubscribe?token=xxx`
**New:** `/api/subscribers/unsubscribe?token=xxx&digest=123`

The endpoint:
1. Sets `subscribers.unsubscribed_at = now()`
2. Creates an `unsubscribe_events` row with `subscriber_id`, `draft_id` (from `digest` param), and `unsubscribed_at`

The `digest` query param is optional for backward compatibility with emails already in inboxes.

**Idempotency:** If the subscriber is already unsubscribed (clicking the same link twice), skip creating a duplicate event row. Only create an event when transitioning from subscribed → unsubscribed.

**Invalid `digest` param:** Store the value as-is without validating the draft exists. The unsubscribe action must never fail due to a bad draft_id.

### 3. Re-subscribe support

When someone subscribes via the website (`POST /api/subscribers`) and they already exist with `unsubscribed_at` set:
- Clear `unsubscribed_at` to re-activate them
- Keep the same subscriber record and unsubscribe token
- The `unsubscribe_events` history is preserved — no data loss
- Return `200` with `{"message": "Re-subscribed", "re_subscribed": true}` to distinguish from a fresh signup or a duplicate active subscriber

### 4. Email sending: include `draft_id` in unsubscribe URL

Update the unsubscribe URL construction in the **digest router** (`backend/app/routers/digest.py`) — specifically in the three places that build per-subscriber unsubscribe URLs:
- `send_digest` endpoint
- `process_scheduled` endpoint
- `retry_failed_sends` endpoint

New URL format:
```
https://abridged.tech/api/subscribers/unsubscribe?token={token}&digest={draft_id}
```

The email service functions (`send_digest_email()`, `send_digest_batch()`) and the Jinja template don't need changes — they receive the URL as a string parameter.

### 5. Re-send warning dialog

#### Backend

New endpoint: `GET /api/digest/drafts/{draft_id}/send-status`

Response:
```json
{
  "previously_sent": true,
  "sent_count": 42,
  "sent_at": "2026-03-10T08:00:00Z",
  "sent_subscriber_ids": [1, 2, 3, ...]
}
```

- Queries `digest_send_logs` for successful sends (`status = 'sent'`) for the given draft
- `sent_at` is the earliest `attempted_at` from the logs (first batch send time)
- `sent_subscriber_ids` enables client-side overlap calculation

No backend changes needed for the "new only" flow — the send endpoint already accepts `subscriber_ids`, so the frontend simply passes the filtered list.

#### Frontend

When the user clicks send (with subscribers selected), before actually sending:
1. Call `GET /api/digest/drafts/{draft_id}/send-status`
2. If `previously_sent` is false, proceed normally
3. If `previously_sent` is true, show a dialog:

**Dialog copy:**
> "This draft was already sent to {sent_count} subscribers on {sent_at}. {overlap_count} of your {selected_count} selected subscribers have already received it."

**Three buttons:**
- **Send anyway** — sends to all currently selected subscribers, including those who already received it
- **New only** — returns to the subscriber selection view with only subscribers who haven't received this draft still checked (computed by filtering `sent_subscriber_ids` from the selected set)
- **Cancel** — closes dialog, no changes to selection

### 6. Migration

Single Alembic migration that:
1. Creates the `unsubscribe_events` table with indexes
2. Backfills from existing data: for each subscriber with `unsubscribed_at` set, create an `unsubscribe_events` row with `draft_id = NULL` (we don't know which digest triggered legacy unsubscribes)

## Out of scope

- Dedicated re-subscribe endpoint or email flow (users just sign up again via the website)
- Unsubscribe analytics dashboard (can be added later querying `unsubscribe_events`)
- Changing the unsubscribe confirmation HTML page
