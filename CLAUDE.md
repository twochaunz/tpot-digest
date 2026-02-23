# tpot-digest

A focused tweet curation tool for daily tech video production.

## What This Is

Save tweets while browsing Twitter via a Chrome extension, organize them into daily topic folders with discourse categories, and use the organized collections during video recording. The user is the curator -- no AI clustering, no scheduled scraping, no automated pipelines.

Core workflow:
1. Browse Twitter, save tweets via Chrome extension (one-click save sends tweet ID)
2. Backend fetches full tweet data from X API v2 (text, author, engagement, media)
3. Review saved tweets in the dashboard as native tweet cards, organized by date
4. Create topic folders per day, assign tweets to topics
5. Categorize tweets within topics by discourse type (commentary, reaction, callout, etc.)
6. Toggle engagement metrics on/off for distraction-free curation
7. Use the organized view during video production

## Tech Stack

- **Backend**: Python 3.12, FastAPI, SQLAlchemy (async), PostgreSQL 16
- **Frontend**: React 19, TypeScript, Vite, TanStack React Query, react-router-dom, html-to-image
- **Browser Integration**: Chrome Extension (Manifest V3) -- content script injects save buttons, service worker extracts tweet ID and posts to backend
- **External API**: X API v2 -- backend fetches tweet data (text, author, engagement, media) server-side
- **Infrastructure**: Docker Compose, Caddy (reverse proxy + auto-HTTPS)
- **Testing**: pytest + pytest-asyncio (SQLite in-memory for tests)

## Commands

```bash
# Run backend tests
backend/.venv/bin/python -m pytest backend/tests/ -q

# Run a specific test file
backend/.venv/bin/python -m pytest backend/tests/test_tweets.py -v

# TypeScript check (frontend)
cd frontend && npx tsc --noEmit

# Local dev (Docker)
docker compose up

# Production deploy
docker compose -f docker-compose.prod.yml up --build -d

# Install Chrome extension (local dev)
# 1. Open chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Load unpacked" and select the extension/ directory

# Deploy to server
./scripts/deploy.sh user@yourserver
```

## Architecture

### Data Flow

```
Chrome Extension (content script)
  -> Extract tweet_id + page context (feed_source, thread_id)
  -> POST /api/tweets {tweet_id, feed_source, thread_id}
  -> Backend calls X API v2 to fetch tweet data
  -> Store tweet metadata to DB
  -> User organizes in dashboard with native tweet cards
```

### Extension Structure

```
extension/
├── manifest.json          # Manifest V3 -- permissions, content scripts, service worker
├── content.js             # Injected into twitter.com/x.com -- save button + tweet ID extraction (minimal parsing)
├── content.css            # Styles for injected save button + toast
├── background.js          # Service worker -- sends tweet_id to backend API (no screenshot capture)
├── popup.html             # Extension popup UI
├── popup.css              # Popup styles
├── popup.js               # Popup logic -- backend URL config, connection status, daily count
└── icons/                 # Extension icons (16, 48, 128px)
```

### Backend Structure

```
backend/app/
├── main.py              # FastAPI app, CORS, router registration
├── config.py            # Pydantic Settings (database_url, data_dir)
├── db.py                # Async SQLAlchemy engine, session factory, Base
├── models/
│   ├── tweet.py         # Tweet (text, engagement JSONB, author fields, media_urls, thread fields)
│   ├── topic.py         # Topic (title, date, color, position)
│   ├── category.py      # Category (name, color, position) -- global discourse types
│   └── tweet_assignment.py  # TweetAssignment (tweet_id, topic_id, category_id)
├── routers/
│   ├── tweets.py        # POST /api/tweets, GET /api/tweets, PATCH, DELETE, /assign, /unassign
│   ├── topics.py        # GET /api/topics?date=, POST, PATCH, DELETE
│   ├── categories.py    # GET /api/categories, POST, PATCH, DELETE
│   └── health.py        # GET /api/health
├── services/
│   └── x_api.py         # X API v2 client -- fetch_tweet() returns normalized tweet data
└── schemas/
    ├── tweet.py         # TweetSave, TweetUpdate, TweetOut
    ├── topic.py         # TopicCreate, TopicUpdate, TopicOut
    ├── category.py      # CategoryCreate, CategoryUpdate, CategoryOut
    └── tweet_assignment.py  # BulkAssignRequest, BulkUnassignRequest
```

### Frontend Structure

```
frontend/src/
├── App.tsx                        # BrowserRouter + QueryClient
├── api/
│   ├── client.ts                  # Axios instance (relative /api URL behind proxy)
│   ├── tweets.ts                  # useTweets(date, filters), useSaveTweet(), useAssignTweets()
│   ├── topics.ts                  # useTopics(date), useCreateTopic(), useUpdateTopic()
│   ├── categories.ts             # useCategories(), useCreateCategory()
│   └── waitlist.ts               # useJoinWaitlist() for landing page
├── pages/
│   ├── DailyView.tsx              # Main page: date picker, unsorted inbox, topic sections
│   ├── LandingPage.tsx            # Public landing page with waitlist
│   └── SettingsPage.tsx           # Category management
├── components/
│   ├── TweetCard.tsx              # Native tweet card with author, text, media, engagement metrics
│   ├── TweetDetailModal.tsx       # Full-size tweet detail overlay with metadata
│   ├── UnsortedSection.tsx        # Unassigned tweets for the selected date
│   ├── TopicSection.tsx           # Collapsible topic with categorized tweet groups
│   ├── AssignDropdown.tsx         # Topic + category picker for bulk assignment
│   ├── DragOverlayCard.tsx        # Drag preview card for drag-and-drop
│   ├── DatePicker.tsx             # Date navigation picker
│   ├── CreateTopicForm.tsx        # Inline form for creating new topics
│   ├── CategoryManager.tsx        # Category CRUD management
│   ├── ContextMenu.tsx            # Right-click context menu
│   ├── UndoToast.tsx              # Undo notification for bulk actions
│   └── CropTool.tsx               # Canvas-based screenshot crop for video use (legacy)
└── hooks/
    ├── useEngagementToggle.ts     # Toggle engagement metrics visibility (persisted to localStorage)
    └── useUndo.ts                 # Undo state management for bulk operations
```

## Key Design Decisions

- **Extension-driven ingestion**: Tweets are saved from the user's own browser via a Chrome extension. The extension sends only the tweet ID and minimal page context (feed_source, thread_id); the backend fetches all tweet data server-side from the X API.
- **X API as source of truth**: Tweet text, author info, engagement metrics, and media URLs are fetched from the X API v2 at save time. This ensures consistent, structured data and eliminates brittle DOM scraping in the extension.
- **User is the curator**: No AI clustering, no automated topic creation. The user manually creates topics, assigns tweets, and categorizes them. This keeps the tool predictable and under full user control.
- **Simple data model**: 4 tables (tweets, topics, categories, tweet_assignments) instead of 9. No embeddings, no lifecycle tracking, no engagement snapshots.
- **Discourse categories**: Global reusable labels (commentary, reaction, callout, etc.) that apply across all topics. Pre-seeded with defaults, user can add more.
- **Native tweet cards**: The frontend renders tweet data natively (author avatar, display name, text, media, engagement metrics) using `html-to-image` for export support, instead of relying on screenshots.
- **Screenshots (legacy)**: Screenshot capture via `captureVisibleTab()` is no longer used for new tweets. The `screenshot_path` column remains for backward compatibility with previously saved tweets.
- **Engagement toggle**: Users can show/hide engagement metrics (likes, retweets, replies, views) across all tweet cards for distraction-free curation. State is persisted to localStorage.
- **Thread awareness**: Tweets track thread_id and thread_position so threads can be displayed together in order.
- **Basic auth**: Only active when AUTH_USER/AUTH_PASS env vars are set. Skips /api/health.

## Database

PostgreSQL 16. 4 tables:

- `tweets` -- tweet_id, author_handle, author_display_name, author_avatar_url, author_verified, text, media_urls JSONB, engagement JSONB, url, is_quote_tweet, is_reply, quoted_tweet_id, reply_to_tweet_id, thread fields, feed_source, memo, screenshot_path (legacy), created_at, saved_at
- `topics` -- title, date, color, position (user-created daily folders)
- `categories` -- name, color, position (global discourse types, e.g. commentary, reaction, callout)
- `tweet_assignments` -- tweet_id FK, topic_id FK, category_id FK nullable (unique on tweet_id + topic_id)

Tweets with no row in tweet_assignments are "unsorted" for their save date.

Migrations: Alembic (async-aware) at `backend/alembic/`.

## Testing Patterns

- Tests use SQLite in-memory with compilation shims for JSONB -> JSON
- API tests use `httpx.ASGITransport` with `AsyncClient`
- DB fixtures create/drop tables per test via `autouse=True` fixture
- `app.dependency_overrides[get_db]` set in fixtures with cleanup

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DB_USER` | No (default: tpot) | PostgreSQL user |
| `DB_PASSWORD` | Yes (prod) | PostgreSQL password |
| `DATABASE_URL` | Auto | Set by docker-compose |
| `DATA_DIR` | Auto | Screenshot storage directory |
| `AUTH_USER` | No | Dashboard basic auth username |
| `AUTH_PASS` | No | Dashboard basic auth password |
| `X_API_BEARER_TOKEN` | Yes (prod) | X API v2 bearer token for fetching tweet data |
| `DOMAIN` | No | Domain for Caddy HTTPS (default: localhost) |

## Deployment

Production uses `docker-compose.prod.yml` with 4 services: db (PostgreSQL), backend (FastAPI), frontend (static build via serve), caddy (reverse proxy + auto-HTTPS).

The Chrome extension connects directly to the backend API. To set up:
1. Deploy the backend to your server
2. Install the Chrome extension locally (load unpacked from `extension/` directory)
3. Configure the extension popup with your server URL
4. Browse Twitter normally and click "Save" on tweets you want to capture
