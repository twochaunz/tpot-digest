# tpot-digest Redesign — Design Document

**Date:** 2026-02-20
**Status:** Approved
**Replaces:** All existing code (clean slate rebuild)

## Purpose

A focused tweet curation tool for daily tech video production. Save tweets while browsing Twitter, organize them into daily topic folders with discourse categories, and use the organized collections while recording.

**Core workflow:**
1. Browse Twitter, save tweets via Chrome extension (one-click or quick-tag)
2. Review saved tweets in the dashboard, organized by date
3. Create topic folders per day, assign tweets to topics
4. Categorize tweets within topics by discourse type (commentary, reaction, callout, etc.)
5. Use the organized view + screenshot crop tool during video production

**What's removed from v1:** AI clustering, knowledge graph, lifecycle tracking, quality scoring, article extraction, engagement snapshots, account management, scheduled scraping. The user is the curator.

## Tech Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy (async), PostgreSQL 16 + pgvector
- **Frontend:** React 19, TypeScript, Vite, TanStack React Query
- **Extension:** Chrome Extension (Manifest V3), vanilla JS
- **Infrastructure:** Docker Compose, Caddy (reverse proxy)
- **Testing:** pytest + pytest-asyncio (SQLite in-memory for tests)

## Data Model

### tweets

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `tweet_id` | varchar unique | Twitter's ID |
| `author_handle` | varchar | |
| `author_display_name` | varchar | |
| `text` | text | |
| `media_urls` | jsonb | |
| `engagement` | jsonb | `{likes, retweets, replies}` |
| `is_quote_tweet` | bool | quoted another tweet |
| `is_reply` | bool | reply to another tweet |
| `quoted_tweet_id` | varchar | ID of quoted tweet |
| `reply_to_tweet_id` | varchar | ID of parent tweet |
| `reply_to_handle` | varchar | who they're replying to |
| `thread_id` | varchar nullable | shared ID linking tweets from same thread (root tweet's ID) |
| `thread_position` | int nullable | order within thread (1, 2, 3...) |
| `screenshot_path` | varchar | relative path to PNG on filesystem |
| `feed_source` | varchar | for_you, following, search, thread, profile |
| `saved_at` | timestamptz | when user saved it |

### topics

User-created topic folders, scoped to a specific date.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `title` | varchar | e.g., "Claude 4 Launch" |
| `date` | date | the day this topic belongs to |
| `color` | varchar | hex color for UI |
| `position` | int | display order within the day |
| `created_at` | timestamptz | |

### categories

Reusable discourse types, global across all topics and dates.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `name` | varchar unique | "commentary", "reaction", "callout", etc. |
| `color` | varchar | hex color |
| `position` | int | display order |

Pre-seeded with: commentary, reaction, callout. User can add more.

### tweet_assignments

Places a tweet into a topic and optionally a category.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `tweet_id` | FK → tweets | |
| `topic_id` | FK → topics | |
| `category_id` | FK → categories, nullable | null = in topic but uncategorized |

Unique constraint on (tweet_id, topic_id) — a tweet can only appear once per topic.

Tweets with no row in tweet_assignments are "unsorted" for their save date.

## API

### Tweets

| Method | Path | Purpose |
|---|---|---|
| `POST /api/tweets` | Save tweet from extension (accepts tweet data + base64 screenshot + optional topic_id/category_id) |
| `GET /api/tweets` | List tweets. Filters: `?date=`, `?topic_id=`, `?category_id=`, `?unassigned=true`, `?q=` (full-text search), `?thread_id=` |
| `PATCH /api/tweets/:id` | Update tweet metadata |
| `DELETE /api/tweets/:id` | Delete a saved tweet + its screenshot file |
| `POST /api/tweets/assign` | Bulk assign: `{tweet_ids: [1,2,3], topic_id: 5, category_id: 2}` |
| `POST /api/tweets/unassign` | Bulk unassign: `{tweet_ids: [1,2,3], topic_id: 5}` |

### Topics

| Method | Path | Purpose |
|---|---|---|
| `GET /api/topics` | List topics for a date: `?date=` (required) |
| `POST /api/topics` | Create topic: `{title, date, color}` |
| `PATCH /api/topics/:id` | Update title, color, position |
| `DELETE /api/topics/:id` | Delete topic (tweets become unassigned) |

### Categories

| Method | Path | Purpose |
|---|---|---|
| `GET /api/categories` | List all categories |
| `POST /api/categories` | Create category: `{name, color}` |
| `PATCH /api/categories/:id` | Update name, color, position |
| `DELETE /api/categories/:id` | Delete category (assignments lose their category_id) |

### Utility

| Method | Path | Purpose |
|---|---|---|
| `GET /api/health` | Health check |

## Chrome Extension

### Architecture

```
extension/
├── manifest.json       # Manifest V3
├── content.js          # Save button injection on tweets
├── content.css         # Save button + toast styles
├── background.js       # Service worker: screenshot capture, API calls
├── popup.html/js/css   # Backend URL config, status, daily count
└── icons/              # 16, 48, 128px
```

### Save button behavior

- Amber circle appears on tweet hover (top-right of tweet article)
- Blocks all pointer/mouse events from propagating to Twitter's navigation handlers
- One click = save immediately (tweet goes to unsorted inbox)
- After save: optional quick-tag panel appears below button for ~3s with recent/pinned tags
- Tap a tag to assign topic+category at save time; ignore to leave untagged
- Toast notification confirms save

### Screenshot capture

- `chrome.tabs.captureVisibleTab()` captures full visible tab as PNG
- Crop to tweet element bounds using `getBoundingClientRect()` + OffscreenCanvas
- No cleanup CSS — raw capture as the user sees it
- Sent as base64 PNG to backend

### Manifest permissions

```json
{
  "permissions": ["activeTab", "storage", "alarms"],
  "host_permissions": [
    "https://twitter.com/*",
    "https://x.com/*",
    "http://*/*",
    "https://*/*"
  ]
}
```

Broad host_permissions to allow connecting to any configured backend URL.

### Service worker

- Stores backend URL + auth in `chrome.storage.sync`
- Retry queue in `chrome.storage.local` (5-minute alarm, 1-hour expiry)
- Daily save counter on badge
- Health check with 5-second timeout

## Dashboard

### Visual direction

- Dark theme — focused, calm, smooth
- Neutral dark palette (graphite/slate), not warm amber
- Single accent color for interactive elements
- Clean sans-serif throughout
- Generous whitespace, low density
- Smooth transitions, subtle hover states

### Layout

Primary navigation is the **date picker**. You pick a day, see that day's organization.

```
┌─ Date Bar ──────────────────────────────────────────┐
│  ◄  Feb 19, 2026  ►         [search]    [settings]  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─ Unsorted (4) ──────────────────────────────┐   │
│  │ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐        │   │
│  │ │ □ ss │ │ □ ss │ │ □ ss │ │ □ ss │        │   │
│  │ │@hand │ │@hand │ │@hand │ │@hand │        │   │
│  │ └──────┘ └──────┘ └──────┘ └──────┘        │   │
│  │                [Assign selected to... ▼]     │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  ┌─ Claude 4 Launch ───────────────────── [+] ──┐   │
│  │  Commentary (3)                               │   │
│  │  ┌──────┐ ┌──────┐ ┌──────┐                 │   │
│  │  │  ss  │ │  ss  │ │  ss  │                 │   │
│  │  └──────┘ └──────┘ └──────┘                 │   │
│  │  Reactions (5)                                │   │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ...   │   │
│  │  │  ss  │ │  ss  │ │  ss  │ │  ss  │       │   │
│  │  └──────┘ └──────┘ └──────┘ └──────┘       │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  ┌─ OpenAI Funding ────────────────────── [+] ──┐   │
│  │  ...                                          │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  [+ New Topic]                                      │
└─────────────────────────────────────────────────────┘
```

### Views

**Daily view (landing):** Date → Unsorted inbox → Topic sections with categorized tweets. Checkboxes for bulk assign. Collapsible topic sections.

**Tweet detail:** Click a screenshot → opens overlay with full-size screenshot + crop tool + tweet metadata + thread view if part of a thread.

**Settings:** Category management (add/rename/recolor discourse types), extension backend URL display.

### Interactions

- **Bulk assign:** Select tweets via checkbox → "Assign to..." dropdown → pick topic + category
- **Create topic inline:** "+ New Topic" button at bottom of daily view
- **Reorder topics:** Drag handle or position arrows
- **Thread expansion:** Tweets in a thread show a thread indicator; click to expand and see all thread tweets in order
- **Screenshot crop:** In detail view, a crop tool to trim screenshots for video use

## What's NOT in this version

- AI/LLM clustering or topic suggestion
- Knowledge graph / topic edges
- Lifecycle tracking (emerging/trending/peaked/fading)
- Quality scoring / slop detection
- Article extraction / Archive.ph
- Engagement snapshots / time-series tracking
- Account management (seed/boost/block)
- Annotation editor (Konva) — replaced by simpler crop tool
- Graph explorer
- Asset manager / ZIP download
- Scheduled pipeline / scraping

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DB_USER` | No (default: tpot) | PostgreSQL user |
| `DB_PASSWORD` | Yes (prod) | PostgreSQL password |
| `DATABASE_URL` | Auto | Set by docker-compose |
| `DATA_DIR` | Auto | Screenshot storage directory |
| `AUTH_USER` | No | Dashboard basic auth username |
| `AUTH_PASS` | No | Dashboard basic auth password |
| `DOMAIN` | No | Domain for Caddy HTTPS |

## Deployment

Docker Compose with 4 services: db (pgvector), backend (FastAPI), frontend (static build via serve), caddy (reverse proxy + auto-HTTPS).

Same Hetzner deployment as before, but significantly simpler backend.
