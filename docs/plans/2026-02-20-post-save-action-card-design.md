# Post-Save Action Card Design

## Problem

After saving a tweet via the Chrome extension, the user must switch to the dashboard to categorize and assign it to a topic. This breaks the browsing flow. The user wants inline categorization at save time.

## Design

### Post-Save Action Card

A compact card replaces the current toast notification. Appears top-right (fixed, 24px from edges) after a successful save. Dark styling consistent with existing toast.

**Fields (all optional):**
- **Topic** — dropdown of existing topics for the selected date + "New topic..." inline creation
- **Category** — dropdown of global categories (commentary, reaction, callout, etc.)
- **Date** — native date input, defaults to today. Overrides which day the tweet is filed under.
- **Memo** — multi-line textarea (2-3 rows). Optional notes for video production context.
- **Assign button** — submits all fields, shows "Assigned!" confirmation, then dismisses.

**Auto-dismiss:**
- 3 second timer starts on appear
- Hovering or focusing any input pauses the timer
- Mouse leave / blur restarts a fresh 3 second timer
- Dismissing without assigning is fine — tweet stays unsorted

### Layout

```
┌──────────────────────────────┐
│ ✓ Saved @handle              │
│                              │
│ Topic:  [▾ Select / New...  ]│
│ Category: [▾ Select         ]│
│ Date:   [2026-02-20        ] │
│ Memo:   [                   ]│
│         [                   ]│
│                              │
│              [Assign]        │
└──────────────────────────────┘
```

### Data Flow

1. Save button clicked → extension saves tweet via service worker → backend returns 201
2. Content script fetches topics (for today's date) and categories via service worker
3. Action card appears with dropdowns populated
4. User optionally picks topic, category, date, writes memo
5. On "Assign":
   - If new topic: POST `/api/topics` to create it
   - If date differs from today: PATCH `/api/tweets/{id}` to update `saved_at`
   - If memo provided: PATCH `/api/tweets/{id}` to update memo
   - POST `/api/tweets/assign` with topic_id and category_id
6. Brief "Assigned!" confirmation, then dismiss

### Data Changes

**New column:** `memo` (Text, nullable) on `tweets` table. Alembic migration required.

**Schema changes:**
- `TweetSave`: add `memo: str | None = None`
- `TweetOut`: add `memo: str | None`

**New/modified endpoints:**
- PATCH `/api/tweets/{id}` — update `saved_at` and `memo` (usable from dashboard too)

**New service worker messages:**
- `GET_TOPICS` — fetches topics for a given date from backend
- `GET_CATEGORIES` — fetches all categories from backend

### Extension Changes

- Replace `showToast()` with `showActionCard()` in content.js
- Move toast position from bottom-right to top-right
- Error toasts remain simple (no action card for failures)
- New CSS for action card (dropdowns, textarea, button)
- Service worker (background.js): handle GET_TOPICS, GET_CATEGORIES, and ASSIGN_TWEET messages
