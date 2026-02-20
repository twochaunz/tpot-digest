# tpot-digest

Tech Twitter Daily Digest — a feed ingestion, topic clustering, and asset organization tool for daily tech video production.

## What This Is

Ingests tweets from Twitter via a Chrome extension, clusters them into Topics and Sub-Topics (narrative threads), captures clean screenshots, extracts linked articles, and organizes everything into daily folders for video script writing. Includes a web dashboard, annotation toolkit, and persistent knowledge graph.

## Tech Stack

- **Backend**: Python 3.12, FastAPI, SQLAlchemy (async), PostgreSQL 16 + pgvector
- **Frontend**: React 19, TypeScript, Vite, TanStack React Query, Konva.js, react-router-dom
- **Browser Integration**: Chrome Extension (Manifest V3) — content script injects save buttons, service worker captures screenshots and posts to backend
- **Infrastructure**: Docker Compose, Caddy (reverse proxy + auto-HTTPS)
- **Testing**: pytest + pytest-asyncio (SQLite in-memory for tests)

## Commands

```bash
# Run backend tests (128 tests)
backend/.venv/bin/python -m pytest backend/tests/ -q

# Run a specific test file
backend/.venv/bin/python -m pytest backend/tests/test_clustering.py -v

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

### Pipeline Flow

```
Chrome Extension (content script + service worker)
  → Save button click on tweet
  → Capture screenshot (html2canvas in service worker)
  → POST /api/ingest (tweet data + base64 screenshot)
  → Store Tweet + Screenshot to DB and filesystem
  → POST /api/ingest/cluster (manual trigger)
  → Cluster into Topics (LLM + keyword fallback)
  → Identify Sub-Topics (LLM + sentiment fallback)
  → Extract Articles (httpx + Archive.ph fallback)
  → Write Filesystem (YYYYMMDD/topic/subtopic/)
  → Update Lifecycle (EMERGING → TRENDING → PEAKED → FADING)
  → Compute Graph Edges (semantic similarity + entity overlap + narrative continuation)
```

### Extension Structure

```
extension/
├── manifest.json          # Manifest V3 — permissions, content scripts, service worker
├── content.js             # Injected into twitter.com/x.com — save button + tweet parsing
├── content.css            # Styles for injected save button
├── background.js          # Service worker — screenshot capture, API calls to backend
├── popup.html             # Extension popup UI
├── popup.css              # Popup styles
├── popup.js               # Popup logic — connection status, stats
└── icons/                 # Extension icons (16, 48, 128px)
```

### Backend Structure

```
backend/app/
├── main.py              # FastAPI app, CORS, router registration
├── config.py            # Pydantic Settings (database_url, data_dir)
├── db.py                # Async SQLAlchemy engine, session factory, Base
├── scheduler.py         # process_pipeline() — on-demand clustering orchestration
├── storage.py           # Filesystem organization (YYYYMMDD/topic/subtopic/tweets/)
├── models/
│   ├── account.py       # Account (seed/auto_discovered/manual, priority, blocked, boosted)
│   ├── tweet.py         # Tweet (JSONB engagement, quality_score), EngagementSnapshot
│   ├── topic.py         # Topic (lifecycle, Vector embedding), SubTopic, SubTopicTweet, TopicEdge
│   ├── screenshot.py    # Screenshot (file_path, annotations_json)
│   └── article.py       # Article (url, archive_url, full_text)
├── routers/
│   ├── accounts.py      # CRUD /api/accounts
│   ├── tweets.py        # /api/tweets, /api/tweets/from-url
│   ├── topics.py        # /api/topics?date=, /api/topics/:id/subtopics
│   ├── ingest.py        # POST /api/ingest, /batch, GET /unclustered, POST /cluster
│   ├── auth.py          # /api/auth/status
│   ├── scheduler.py     # /api/scheduler/status, /trigger
│   ├── assets.py        # /api/assets/dates, /browse/:date, /download (ZIP)
│   ├── graph.py         # /api/graph, /api/graph/search, /api/graph/link
│   └── discovery.py     # /api/discovery, /approve, /reject
├── schemas/
│   ├── account.py       # AccountCreate, AccountUpdate, AccountOut
│   ├── tweet.py         # TweetCreate, TweetOut, TweetFromUrl
│   ├── topic.py         # TopicCreate, TopicUpdate, TopicOut, SubTopicOut
│   ├── ingest.py        # TweetIngest, IngestResponse, BatchIngestRequest, ClusterTriggerResponse
│   └── graph.py         # GraphNode, GraphEdge, GraphResponse, ManualLinkRequest
├── scraper/
│   ├── parser.py        # parse_tweet_data(), parse_count(), extract_urls()
│   └── article.py       # fetch_article() — Archive.ph fallback, extract_article_content()
└── pipeline/
    ├── llm.py           # llm_structured_output() — Anthropic Claude API wrapper
    ├── quality.py       # compute_quality_score(), apply_diversity_cap(), filter_tweets()
    ├── clustering.py    # cluster_into_topics() (Pass 1), identify_subtopics() (Pass 2)
    ├── lifecycle.py     # compute_lifecycle_status() state machine, refresh_engagement()
    ├── graph.py         # generate_embedding(), cosine similarity, entity extraction, edge formation
    ├── relevance.py     # classify_relevance() — LLM or keyword-based tech relevance gate
    └── discovery.py     # discover_accounts(), approve_discovery(), reject_discovery()
```

### Frontend Structure

```
frontend/src/
├── App.tsx                        # BrowserRouter + QueryClient (30s refetch)
├── api/
│   ├── client.ts                  # Axios instance (relative /api URL behind proxy)
│   ├── topics.ts                  # useTopics(date), useTopic(id)
│   ├── tweets.ts                  # useTweetsBySubTopic()
│   ├── accounts.ts                # useAccounts(), useCreateAccount(), etc.
│   ├── ingest.ts                  # useUnclusteredTweets(), useTriggerClustering()
│   ├── scheduler.ts               # useSchedulerStatus(), useTriggerPipeline()
│   ├── articles.ts                # useArticle()
│   ├── assets.ts                  # useAssetDates(), useAssetBrowse(), downloadAssets()
│   └── graph.ts                   # useGraph(), useGraphSearch(), useCreateLink()
├── pages/
│   ├── TodaysFeed.tsx             # Topics ranked by momentum, auto-refresh
│   ├── TopicDetail.tsx            # Sub-topics with tweet clusters
│   ├── GraphExplorer.tsx          # Force-directed graph + search + filters
│   ├── AssetManager.tsx           # Folder browser + asset grid + bulk ZIP download
│   └── Settings.tsx               # Account manager + filter controls + manual tweet input
├── components/
│   ├── Sidebar.tsx                # Nav sidebar
│   ├── TopicCard.tsx              # Expandable topic card with lifecycle badge
│   ├── LifecycleBadge.tsx         # Colored badge (emerging/trending/peaked/fading)
│   ├── SubTopicPanel.tsx          # Sub-topic with sentiment, title, summary
│   ├── TweetCard.tsx              # Tweet display with engagement
│   ├── ArticleViewer.tsx          # Clean reading view with AI summary
│   ├── ArticleSplitView.tsx       # Full-screen modal: tweet left, article right
│   ├── AnnotationEditor.tsx       # Konva canvas: highlight, box, freehand, export PNG
│   ├── ExtensionStatus.tsx        # Chrome extension connection status indicator
│   ├── UnclusteredQueue.tsx       # Queue of tweets awaiting clustering
│   ├── GraphCanvas.tsx            # HTML5 Canvas force-directed graph visualization
│   ├── GraphFilters.tsx           # Date range, entity, search filter bar
│   ├── GraphSearchResults.tsx     # Topic search results list
│   ├── FolderBrowser.tsx          # Date picker + topic/subtopic tree
│   ├── AssetGrid.tsx              # Grid thumbnails with checkboxes
│   ├── AccountManager.tsx         # Account list with add/priority/boost/block
│   ├── FilterControls.tsx         # Scheduler status + config
│   ├── ManualTweetInput.tsx       # URL input for manual tweet addition
│   └── tools/
│       ├── Toolbar.tsx            # Annotation tool buttons, undo/redo, export
│       └── ColorPicker.tsx        # 6 preset colors
└── hooks/
    └── useAnnotationHistory.ts    # Undo/redo stack for annotations
```

## Key Design Decisions

- **Extension-driven ingestion**: Tweets are saved from the user's own browser via a Chrome extension, replacing server-side Playwright scraping. This avoids rate limiting and session management issues.
- **On-demand pipeline**: No scheduled scraping. Tweets are ingested individually via the extension, then clustered on demand via the dashboard or API.
- **Two-pass clustering**: Pass 1 groups tweets into Topics. Pass 2 splits each topic into Sub-Topics (narrative threads, e.g. "hype", "criticism", "analysis").
- **LLM with keyword fallback**: All AI features (clustering, relevance, embeddings) gracefully degrade to keyword-based heuristics when no API key is set.
- **Topic lifecycle state machine**: EMERGING -> TRENDING (velocity >100 or count >=5) -> PEAKED (velocity <0) -> FADING (velocity <-50), with re-surge paths.
- **Quality scoring**: Weighted formula (network proximity 0.35, is_seed 0.25, followers 0.15, slop 0.15, engagement 0.10). Blocked = 0.0, boosted = 1.0.
- **Screenshots**: Captured by the Chrome extension service worker at save time, sent as base64 PNG to the backend.
- **Basic auth**: Only active when AUTH_USER/AUTH_PASS env vars are set. Skips /api/health.

## Database

PostgreSQL 16 + pgvector. 9 tables:

- `accounts` -- seed/manual/auto_discovered, priority 1-5, blocked/boosted flags
- `tweets` -- tweet_id, text, JSONB engagement, quality_score, feed_source
- `engagement_snapshots` -- time-series engagement tracking per tweet
- `topics` -- date, title, lifecycle_status, Vector(1536) embedding, JSONB tags
- `subtopics` -- FK to topics, title, sentiment, rank
- `subtopic_tweets` -- join table with relevance_score and stance
- `topic_edges` -- source/target FK to topics, relationship_type, strength
- `screenshots` -- FK to tweets/articles, file_path, annotations_json
- `articles` -- url, archive_url, title, author, full_text

Migrations: Alembic (async-aware) at `backend/alembic/`.

## Testing Patterns

- Tests use SQLite in-memory with compilation shims for JSONB -> JSON and Vector -> BLOB
- API tests use `httpx.ASGITransport` with `AsyncClient`
- DB fixtures create/drop tables per test via `autouse=True` fixture
- `app.dependency_overrides[get_db]` set in fixtures with cleanup
- All pipeline functions tested without API keys (keyword/heuristic fallback paths)

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DB_USER` | No (default: tpot) | PostgreSQL user |
| `DB_PASSWORD` | Yes (prod) | PostgreSQL password |
| `AUTH_USER` | No | Dashboard basic auth username |
| `AUTH_PASS` | No | Dashboard basic auth password |
| `DOMAIN` | No | Domain for Caddy HTTPS (default: localhost) |
| `ANTHROPIC_API_KEY` | No | Enables LLM clustering and relevance classification |
| `OPENAI_API_KEY` | No | Enables topic embeddings for knowledge graph |
| `DATABASE_URL` | Auto | Set by docker-compose |
| `DATA_DIR` | Auto | Set by docker-compose |

## Deployment

Production uses `docker-compose.prod.yml` with 4 services: db (pgvector), backend (FastAPI), frontend (static build via serve), caddy (reverse proxy + auto-HTTPS).

The Chrome extension connects directly to the backend API. To set up:
1. Deploy the backend to your server
2. Install the Chrome extension locally (load unpacked from `extension/` directory)
3. Configure the extension popup with your server URL
4. Browse Twitter normally and click "Save" on tweets you want to capture
