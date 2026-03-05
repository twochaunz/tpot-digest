# Digest Send Tracking & Retry

## Problem

When a digest is sent, failures are caught silently and only a single `recipient_count` integer is stored. No record of which emails succeeded, which failed, or why. The user has no way to diagnose or recover from partial sends.

## Design

### Data Model

New `digest_send_logs` table:

| Column | Type | Description |
|--------|------|-------------|
| id | Integer PK | Auto-increment |
| draft_id | Integer FK | References digest_drafts.id |
| subscriber_id | Integer FK | References subscribers.id |
| email | String(320) | Denormalized — preserves email at send time |
| status | String(16) | `sent` or `failed` |
| error_message | Text, nullable | Exception details on failure |
| resend_message_id | String(128), nullable | Resend API response ID |
| attempted_at | DateTime(tz) | When the send was attempted |

Index on `(draft_id, status)` for fast lookups.

### Send Flow Changes

- Each `send_digest_email` call creates a `digest_send_logs` row with success/failure details
- `recipient_count` on draft still updated as quick summary (count of `sent` logs)
- Error messages captured from Resend exceptions

### Retry Flow

- POST `/api/digest/drafts/{id}/retry` with optional `subscriber_ids` body
- If no `subscriber_ids`, retries all failed for that draft
- If `subscriber_ids` provided, retries only those
- Each retry creates a new log row; old failed row stays for history
- Draft `recipient_count` updated after retry

### Composer UI (inline)

After a sent draft, show a status bar below the header:
- **Success state**: "Sent to 11/11" in green
- **Partial failure**: "Sent to 6/11 · 5 failed" with failed count in red
- Expandable detail panel showing failed recipients with error reasons
- "Retry All Failed" button + per-recipient checkboxes for selective retry
- Clean, minimal design consistent with existing composer aesthetic

### Send Log Page

Route: `/app/send-log`
- Table listing all send attempts across all drafts
- Columns: draft subject, date, recipient email, status, error, timestamp
- Filterable by status (sent/failed) and date range
- Link from each row to the draft in composer
- Accessible from a nav link in the composer header

### API Endpoints

- `GET /api/digest/drafts/{id}/send-log` — per-draft send results
- `POST /api/digest/drafts/{id}/retry` — retry failed sends (optional subscriber_ids filter)
- `GET /api/digest/send-log` — all send logs across drafts (with pagination, status/date filters)
