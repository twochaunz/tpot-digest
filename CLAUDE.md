# tpot-digest

A focused tweet curation tool for daily tech video production.

## What This Is

Save tweets while browsing Twitter via a Chrome extension, organize them into daily topic folders with discourse categories, and use the organized collections during video recording. The user is the curator -- no AI clustering, no scheduled scraping, no automated pipelines.

Core workflow:
1. Browse Twitter, save tweets via Chrome extension (one-click save)
2. Review saved tweets in the dashboard, organized by date
3. Create topic folders per day, assign tweets to topics
4. Categorize tweets within topics by discourse type (commentary, reaction, callout, etc.)
5. Use the organized view + screenshot crop tool during video production

## Tech Stack

- **Backend**: Python 3.12, FastAPI, SQLAlchemy (async), PostgreSQL 16
- **Frontend**: React 19, TypeScript, Vite, TanStack React Query, react-router-dom
- **Browser Integration**: Chrome Extension (Manifest V3) -- content script injects save buttons, service worker captures screenshots and posts to backend
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
Chrome Extension (content script + service worker)
  -> Save button click on tweet
  -> Capture screenshot (captureVisibleTab + crop via OffscreenCanvas)
  -> POST /api/tweets (tweet data + base64 screenshot)
  -> Store tweet metadata to DB, screenshot to filesystem
  -> User organizes in dashboard: create topics, assign tweets, set categories
```

### Extension Structure

```
extension/
├── manifest.json          # Manifest V3 -- permissions, content scripts, service worker
├── content.js             # Injected into twitter.com/x.com -- save button + tweet parsing
├── content.css            # Styles for injected save button + toast
├── background.js          # Service worker -- screenshot capture, API calls to backend
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
│   ├── tweet.py         # Tweet (text, engagement JSONB, screenshot_path, thread fields)
│   ├── topic.py         # Topic (title, date, color, position)
│   ├── category.py      # Category (name, color, position) -- global discourse types
│   └── tweet_assignment.py  # TweetAssignment (tweet_id, topic_id, category_id)
├── routers/
│   ├── tweets.py        # POST /api/tweets, GET /api/tweets, PATCH, DELETE, /assign, /unassign
│   ├── topics.py        # GET /api/topics?date=, POST, PATCH, DELETE
│   ├── categories.py    # GET /api/categories, POST, PATCH, DELETE
│   └── health.py        # GET /api/health
└── schemas/
    ├── tweet.py         # TweetCreate, TweetUpdate, TweetOut
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
│   └── categories.ts             # useCategories(), useCreateCategory()
├── pages/
│   ├── DailyView.tsx              # Main page: date picker, unsorted inbox, topic sections
│   └── SettingsPage.tsx           # Category management
├── components/
│   ├── DateBar.tsx                # Date navigation with prev/next and search
│   ├── UnsortedInbox.tsx          # Unassigned tweets for the selected date
│   ├── TopicSection.tsx           # Collapsible topic with categorized tweet groups
│   ├── TweetCard.tsx              # Tweet screenshot thumbnail with checkbox
│   ├── TweetDetail.tsx            # Full-size screenshot overlay with crop tool + metadata
│   ├── CropTool.tsx               # Canvas-based screenshot crop for video use
│   ├── AssignDropdown.tsx         # Topic + category picker for bulk assignment
│   ├── ThreadView.tsx             # Expanded thread display
│   └── ExtensionStatus.tsx        # Chrome extension connection status indicator
└── hooks/
    └── useSelection.ts            # Checkbox selection state for bulk operations
```

## Key Design Decisions

- **Extension-driven ingestion**: Tweets are saved from the user's own browser via a Chrome extension. No server-side scraping, no rate limiting issues.
- **User is the curator**: No AI clustering, no automated topic creation. The user manually creates topics, assigns tweets, and categorizes them. This keeps the tool predictable and under full user control.
- **Simple data model**: 4 tables (tweets, topics, categories, tweet_assignments) instead of 9. No embeddings, no lifecycle tracking, no engagement snapshots.
- **Discourse categories**: Global reusable labels (commentary, reaction, callout, etc.) that apply across all topics. Pre-seeded with defaults, user can add more.
- **Screenshots**: Captured by the Chrome extension service worker at save time using `captureVisibleTab()` + crop, sent as base64 PNG to the backend.
- **Thread awareness**: Tweets track thread_id and thread_position so threads can be displayed together in order.
- **Simple crop tool**: Canvas-based crop replaces the Konva.js annotation editor. Just trim screenshots for video use.
- **Basic auth**: Only active when AUTH_USER/AUTH_PASS env vars are set. Skips /api/health.

## Database

PostgreSQL 16. 4 tables:

- `tweets` -- tweet_id, author_handle, text, engagement JSONB, screenshot_path, thread fields, feed_source, saved_at
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
| `DOMAIN` | No | Domain for Caddy HTTPS (default: localhost) |

## Deployment

Production uses `docker-compose.prod.yml` with 4 services: db (PostgreSQL), backend (FastAPI), frontend (static build via serve), caddy (reverse proxy + auto-HTTPS).

The Chrome extension connects directly to the backend API. To set up:
1. Deploy the backend to your server
2. Install the Chrome extension locally (load unpacked from `extension/` directory)
3. Configure the extension popup with your server URL
4. Browse Twitter normally and click "Save" on tweets you want to capture
