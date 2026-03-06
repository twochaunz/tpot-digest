# Email Analytics & Engagement Tracking

**Date:** 2026-03-06

## Problem

After sending digest emails, we only know if delivery succeeded or failed. No visibility into whether recipients opened emails or clicked any links. Need Substack-style analytics to understand audience engagement.

## Approach: Resend Webhooks

Resend handles open pixel injection and link rewriting automatically. We receive webhook events at a new endpoint and store them.

### Events We Track

| Event | Source | Data |
|---|---|---|
| `delivered` | Resend webhook | Confirms email reached inbox |
| `opened` | Resend webhook (tracking pixel) | Recipient opened email |
| `clicked` | Resend webhook (link rewrite) | Recipient clicked a link + which URL |
| `bounced` | Resend webhook | Permanent delivery failure |
| `complained` | Resend webhook | Marked as spam |

### Webhook Endpoint

`POST /api/webhooks/resend` — public, verified via Svix signature.

Matches events to our `digest_send_logs` via `resend_message_id` (already stored). Deduplicates using `svix-id` header.

## Data Model

### New Table: `email_events`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `send_log_id` | int FK → digest_send_logs | Matched via resend_message_id |
| `draft_id` | int FK → digest_drafts | Denormalized for fast per-digest queries |
| `subscriber_id` | int FK → subscribers | Denormalized for subscriber engagement |
| `event_type` | varchar(32) | `delivered`, `opened`, `clicked`, `bounced`, `complained` |
| `link_url` | text, nullable | Only for `clicked` events |
| `ip_address` | varchar(45), nullable | From webhook payload |
| `user_agent` | text, nullable | From webhook payload |
| `event_at` | timestamptz | When event occurred (from Resend) |
| `created_at` | timestamptz | When we received webhook |
| `svix_id` | varchar(128), unique | Deduplication key |

**Indexes:**
- `(draft_id, event_type)` — per-digest metric queries
- `(subscriber_id, event_type)` — subscriber engagement queries
- `(svix_id)` unique — deduplication

No pre-computed aggregation tables. Metrics computed on the fly — sufficient for current scale (~100 subscribers, a few digests/week).

## Setup Requirements

1. Enable open + click tracking in Resend domain settings for abridged.tech
2. Register webhook in Resend dashboard → `https://abridged.tech/api/webhooks/resend`
3. Subscribe to events: `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`, `email.complained`
4. Store webhook signing secret in env var `RESEND_WEBHOOK_SECRET`

## Analytics Dashboard (`/app/analytics`)

### Top-Level Overview

Always visible at top:
- **Active subscribers** count
- **Last digest** — date, subject, open rate, click rate, recipient count

### Per-Digest Table

List of all sent digests:

| Date | Subject | Recipients | Opens | Open Rate | Clicks | Click Rate |
|---|---|---|---|---|---|---|

Clicking a row expands:
- **Top clicked links** — URLs grouped with click counts, sorted by popularity
- **Per-subscriber breakdown** — each recipient showing delivered/opened/clicked status

### Subscriber Engagement Tab

Table of all subscribers:

| Email | Subscribed Since | Digests Received | Open Rate | Click Rate | Last Opened |
|---|---|---|---|---|---|

Identifies disengaged subscribers.

## API Endpoints

### Webhook
- `POST /api/webhooks/resend` — receives and stores Resend events (public, Svix-verified, no auth)

### Analytics (admin-only)
- `GET /api/analytics/overview` — subscriber count, last digest stats
- `GET /api/analytics/digests` — per-digest metrics (all sent drafts with open/click rates)
- `GET /api/analytics/digests/{draft_id}` — detailed metrics for one digest (top links, per-subscriber)
- `GET /api/analytics/subscribers` — subscriber engagement table

## Non-Goals (v1)

- Charts/graphs (tables only for now)
- A/B testing
- Engagement scoring/segments
- Email client/device breakdown
- Time-of-day analysis
- Automated re-engagement campaigns
