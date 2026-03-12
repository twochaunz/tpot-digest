# Welcome Email for New Subscribers — Design

## Summary

When a new subscriber signs up, automatically send them the latest sent digest with a customizable welcome message prepended above a divider. The welcome message, subject line, and send mode are configurable from a dedicated Welcome Email page in the admin UI.

## Data Model

### New table: `digest_settings` (single row)

| Column | Type | Default |
|---|---|---|
| `id` | Integer PK | 1 |
| `welcome_send_mode` | String(16) | `"off"` |
| `welcome_subject` | String(255) | `"no little piggies allowed"` |
| `welcome_message` | Text | `"thanks for subscribing! here's the most recent abridged piece that went out. feel free to share any feedback that would help your experience 😀"` |
| `updated_at` | DateTime(tz) | now() |

- `welcome_send_mode`: one of `"off"`, `"hourly"`, `"immediate"`
- Single row, upserted on save

## Backend API

### New endpoints under `/api/digest/settings`

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/digest/settings` | Get current settings (upserts default row if none exists) |
| `PATCH` | `/api/digest/settings` | Update settings (partial update, returns updated row) |
| `GET` | `/api/digest/settings/welcome-preview` | Rendered welcome email HTML using current settings + latest sent digest |
| `POST` | `/api/digest/settings/welcome-test` | Send test welcome email to admin email |
| `POST` | `/api/digest/process-welcome` | Cron endpoint: process hourly welcome email batch |

### Welcome email send logic (shared by both modes)

1. Query latest draft where `status='sent'`, ordered by `sent_at DESC`
2. If none exists, skip (no digest has ever been sent)
3. Find new subscribers (immediate: just the one; hourly: `subscribed_at > now - 1 hour`, `unsubscribed_at IS NULL`)
4. For each subscriber, check `digest_send_logs` — skip if they already received this draft
5. Render welcome email: resolve template variables in welcome message + divider + full digest content
6. Send via Resend (batch for hourly, single for immediate)
7. Log to `digest_send_logs` to prevent dedup on regular sends

### Template variables

- `{{date}}` — digest date (e.g., "3/10/26")
- `{{subject}}` — digest subject line

### Trigger points

- **Immediate:** Called at the end of `POST /api/subscribers` when mode is `"immediate"`
- **Hourly:** Called by `POST /api/digest/process-welcome` (external cron hits every hour)

## Frontend UI

### Dedicated page: `/app/welcome-email`

- Accessible from DigestComposer header nav alongside "Drafts", "Send Log", "Analytics" — labeled "Welcome"
- 640px centered layout (same pattern as SettingsPage)

### Layout

```
┌─────────────────────────────────────────────────┐
│  ← Back          Welcome Email                  │
│                                        Saved ✓  │
├─────────────────────────────────────────────────┤
│                                                 │
│  Send mode                                      │
│  ○ Off  ○ Hourly  ○ Immediate                  │
│                                                 │
│  Subject                                        │
│  ┌─────────────────────────────────────────┐    │
│  │ no little piggies allowed               │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  Welcome message                                │
│  Available: {{date}}, {{subject}}               │
│  ┌─────────────────────────────────────────┐    │
│  │ thanks for subscribing! here's the most │    │
│  │ recent abridged piece that went out.    │    │
│  │ feel free to share any feedback that    │    │
│  │ would help your experience 😀           │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│           [Send Test]        [Save]             │
├─────────────────────────────────────────────────┤
│  Preview                                        │
│  ┌─────────────────────────────────────────┐    │
│  │  Subject: no little piggies allowed     │    │
│  │                                         │    │
│  │  [welcome message, vars resolved]       │    │
│  │  ──────────── divider ──────────────    │    │
│  │  [full latest sent digest content]      │    │
│  │                                         │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

### Key interactions

- **Send mode radio buttons:** Auto-save on change (debounced). When "Off", subject/message/preview remain visible but dimmed.
- **Template variable tooltips:** Hovering `{{date}}` or `{{subject}}` in the textarea shows a tooltip with the current resolved value from the latest sent digest.
- **Live preview:** Iframe showing the exact email a subscriber would receive. Updates as you type (debounced). Rendered server-side via the preview endpoint.
- **Save button:** Explicit save for subject + message. Shows "Saved ✓" confirmation.
- **Send Test:** Sends test welcome email to admin email.
- **No digest state:** If no digest has been sent yet, preview shows welcome text with a note: "No digest sent yet — welcome email will begin sending after your first digest."

## Dedup Logic

- Writing to `digest_send_logs` after welcome send ensures:
  - Regular digest send won't re-send to these subscribers
  - Hourly job won't re-send on next run
  - Subscribers who received a digest normally won't get a duplicate welcome

## Cron Setup

- External cron hits `POST /api/digest/process-welcome` every hour
- Same pattern as existing `POST /api/digest/process-scheduled`
