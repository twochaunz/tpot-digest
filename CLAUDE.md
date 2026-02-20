# tpot-digest

Tech Twitter Daily Digest — a feed ingestion, topic clustering, and asset organization tool for daily tech video production.

## What This Is

Scrapes Twitter (For You + Following feeds), clusters tweets into Topics and Sub-Topics (narrative threads), captures clean screenshots, extracts linked articles, and organizes everything into daily folders for video script writing. Includes a web dashboard, annotation toolkit, and persistent knowledge graph.

## Tech Stack

- **Backend**: Python 3.12, FastAPI, SQLAlchemy (async), PostgreSQL 16 + pgvector, Playwright, APScheduler
- **Frontend**: React 19, TypeScript, Vite, TanStack React Query, Konva.js, react-router-dom
- **Infrastructure**: Docker Compose, Caddy (reverse proxy + auto-HTTPS)
- **Testing**: pytest + pytest-asyncio (SQLite in-memory for tests)

## Commands

```bash
# Run backend tests (144 tests)
backend/.venv/bin/python -m pytest backend/tests/ -q

# Run a specific test file
backend/.venv/bin/python -m pytest backend/tests/test_clustering.py -v

# TypeScript check (frontend)
cd frontend && npx tsc --noEmit

# Local dev (Docker)
docker compose up

# Production deploy
docker compose -f docker-compose.prod.yml up --build -d

# Twitter login (local Mac, exports session cookies)
python scripts/twitter-login.py

# Upload session to server
./scripts/upload-session.sh user@yourserver

# Deploy to server
./scripts/deploy.sh user@yourserver
```

## Architecture

### Pipeline Flow

```
Scrape (Playwright) → Quality Filter → Store Tweets
  → Cluster into Topics (LLM + keyword fallback)
  → Identify Sub-Topics (LLM + sentiment fallback)
  → Capture Screenshots (CSS injection, 2x DPR)
  → Extract Articles (httpx + Archive.ph fallback)
  → Write Filesystem (YYYYMMDD/topic/subtopic/)
  → Update Lifecycle (EMERGING → TRENDING → PEAKED → FADING)
  → Compute Graph Edges (semantic similarity + entity overlap + narrative continuation)
```

### Backend Structure

```
backend/app/
├── main.py              # FastAPI app, CORS, basic auth middleware, router registration
├── config.py            # Pydantic Settings (database_url, data_dir, scrape_interval)
├── db.py                # Async SQLAlchemy engine, session factory, Base
├── scheduler.py         # APScheduler + process_pipeline() orchestration
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
│   ├── auth.py          # /api/auth/status, /api/auth/login
│   ├── scheduler.py     # /api/scheduler/status, /trigger, /config
│   ├── assets.py        # /api/assets/dates, /browse/:date, /download (ZIP)
│   ├── graph.py         # /api/graph, /api/graph/search, /api/graph/link
│   └── discovery.py     # /api/discovery, /approve, /reject
├── schemas/
│   ├── account.py       # AccountCreate, AccountUpdate, AccountOut
│   ├── tweet.py         # TweetCreate, TweetOut, TweetFromUrl
│   ├── topic.py         # TopicCreate, TopicUpdate, TopicOut, SubTopicOut
│   └── graph.py         # GraphNode, GraphEdge, GraphResponse, ManualLinkRequest
├── scraper/
│   ├── browser.py       # get_browser_context(), save_session(), check_session_valid()
│   ├── auth.py          # interactive_login() — headed browser for manual Twitter login
│   ├── feed.py          # scrape_feed(context, feed_type, max_scrolls) — DOM extraction
│   ├── parser.py        # parse_tweet_data(), parse_count(), extract_urls()
│   ├── screenshot.py    # capture_tweet_screenshot() — CSS injection, 2x DPR PNG
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
│   ├── scheduler.ts               # useSchedulerStatus(), useTriggerScrape()
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

- **Feed-first scraping**: Scrolls For You + Following feeds (not individual profiles). Seed accounts are signal amplifiers, not the primary data source.
- **Two-pass clustering**: Pass 1 groups tweets into Topics. Pass 2 splits each topic into Sub-Topics (narrative threads, e.g. "hype", "criticism", "analysis").
- **LLM with keyword fallback**: All AI features (clustering, relevance, embeddings) gracefully degrade to keyword-based heuristics when no API key is set.
- **Topic lifecycle state machine**: EMERGING → TRENDING (velocity >100 or count >=5) → PEAKED (velocity <0) → FADING (velocity <-50), with re-surge paths.
- **Quality scoring**: Weighted formula (network proximity 0.35, is_seed 0.25, followers 0.15, slop 0.15, engagement 0.10). Blocked = 0.0, boosted = 1.0.
- **Screenshots**: CSS injection hides engagement metrics, reply threads, nav. Captures at 2x DPR for crisp video overlays.
- **Basic auth**: Only active when AUTH_USER/AUTH_PASS env vars are set. Skips /api/health.

## Database

PostgreSQL 16 + pgvector. 9 tables:

- `accounts` — seed/manual/auto_discovered, priority 1-5, blocked/boosted flags
- `tweets` — tweet_id, text, JSONB engagement, quality_score, feed_source
- `engagement_snapshots` — time-series engagement tracking per tweet
- `topics` — date, title, lifecycle_status, Vector(1536) embedding, JSONB tags
- `subtopics` — FK to topics, title, sentiment, rank
- `subtopic_tweets` — join table with relevance_score and stance
- `topic_edges` — source/target FK to topics, relationship_type, strength
- `screenshots` — FK to tweets/articles, file_path, annotations_json
- `articles` — url, archive_url, title, author, full_text

Migrations: Alembic (async-aware) at `backend/alembic/`.

## Testing Patterns

- Tests use SQLite in-memory with compilation shims for JSONB → JSON and Vector → BLOB
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

Twitter session cookies are managed locally — run `scripts/twitter-login.py` on a Mac with Chrome, then `scripts/upload-session.sh` to push to server. Session typically lasts weeks before needing refresh.
