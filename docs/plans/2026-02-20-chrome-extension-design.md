# Chrome Extension Migration — Design Document

**Date:** 2026-02-20
**Status:** Approved
**Replaces:** Playwright-based scraping (Tasks 6-9, 13 from original plan)

## Problem

The current Playwright-based scraping architecture has friction:
- Requires a persistent headless browser running on a server
- Twitter session cookies expire and need manual re-auth via `scripts/twitter-login.py`
- Automated feed scrolling is fragile — DOM selectors break, rate limits hit, anti-bot detection triggers
- Screenshots require navigating to individual tweet URLs in a headless browser
- The server needs Playwright + Chromium installed (~400MB Docker image bloat)

## Solution: Chrome Extension with Explicit Capture

Replace automated Playwright scraping with a Chrome extension that lets the user explicitly save tweets while browsing Twitter naturally.

**Core principle:** The user is the curator. No automated scraping. Every saved tweet is an intentional choice.

## Architecture

```
Chrome Extension (twitter.com / x.com)
  ├── Content Script
  │   ├── Inject "Save" button on each tweet
  │   ├── Extract tweet data from DOM on click
  │   └── Capture screenshot of tweet element
  ├── Service Worker (background)
  │   ├── Receive messages from content script
  │   ├── Queue and batch-send to backend API
  │   └── Track saved count, manage auth token
  └── Popup
      ├── Today's saved count
      ├── Backend connection status
      └── Quick settings (backend URL, auth)

Backend API (FastAPI — unchanged core)
  ├── POST /api/ingest          ← receives tweet data + screenshot from extension
  ├── POST /api/ingest/batch    ← receives multiple tweets at once
  ├── Clustering pipeline       ← runs on demand when tweets arrive
  ├── Article extraction        ← unchanged (httpx + Archive.ph)
  ├── Knowledge graph           ← unchanged
  └── Dashboard API             ← unchanged
```

## Extension Design

### Manifest V3

```
extension/
├── manifest.json
├── content.js              # Injected into twitter.com / x.com
├── background.js           # Service worker
├── popup.html + popup.js   # Extension popup
├── styles.css              # Save button styling
└── icons/                  # Extension icons (16, 48, 128px)
```

### Content Script (`content.js`)

**Injection target:** `https://twitter.com/*`, `https://x.com/*`

**Save Button:**
- Injects a small "Save" button (bookmark/plus icon) on each tweet article element
- Uses `article[data-testid="tweet"]` selector (same as current scraper)
- Button appears on hover or always visible (user preference in popup settings)
- MutationObserver watches for new tweets as user scrolls (Twitter is an SPA)
- Already-saved tweets show a checkmark instead of save button

**On Save Click:**
1. Extract tweet data from the DOM element:
   - Tweet ID (from `a[href*="/status/"]`)
   - Author handle and display name
   - Tweet text
   - Media URLs (images, video thumbnails)
   - Article URLs from cards
   - Engagement counts (likes, retweets, replies)
   - Whether it's a retweet or quote tweet
   - Quoted tweet ID if applicable
2. Capture screenshot of the tweet element:
   - Use `chrome.tabs.captureVisibleTab()` to get the visible tab as a PNG
   - Calculate bounding rect of the tweet element via `getBoundingClientRect()`
   - Crop to tweet bounds using an offscreen canvas
   - Before capture: temporarily inject CSS to hide engagement metrics, reply threads, and surrounding UI (same `CLEANUP_CSS` approach as current screenshot.py)
   - After capture: remove injected CSS
   - Result: clean, cropped PNG at device pixel ratio (2x on Retina)
3. Send message to service worker with `{ tweet_data, screenshot_blob }`

**DOM Extraction (reuse from current `feed.py`):**
The JavaScript extraction logic from `extract_tweets_from_page()` in `feed.py` is 100% portable — same selectors, same parsing. Move it to content script as-is.

### Service Worker (`background.js`)

**Responsibilities:**
- Receive `SAVE_TWEET` messages from content script
- Store backend URL and auth credentials in `chrome.storage.sync`
- Send tweet data + screenshot to backend via `POST /api/ingest`
  - Screenshot sent as base64-encoded PNG in JSON body (simple) or as multipart form data (efficient for large images)
- Maintain a queue for offline/retry:
  - If backend is unreachable, queue tweets in `chrome.storage.local`
  - Retry on next successful connection
- Track daily saved count (badge on extension icon)
- Handle `BATCH_SAVE` for when user wants to save multiple visible tweets at once

**Auth:**
- If backend has `AUTH_USER`/`AUTH_PASS` set, service worker sends Basic Auth header
- Credentials stored in `chrome.storage.sync` (synced across Chrome instances)

### Popup (`popup.html`)

Minimal UI:
- **Saved today:** count badge (e.g., "23 tweets saved today")
- **Backend status:** green/red dot showing connection status
- **Settings:**
  - Backend URL input (default: `https://yourdomain.com`)
  - Username / Password for basic auth
  - Button visibility: "Show on hover" vs "Always visible"
  - Save confirmation: toast notification on/off

## Backend Changes

### New Endpoint: `POST /api/ingest`

```python
@router.post("/api/ingest", status_code=201)
async def ingest_tweet(body: TweetIngest, db: AsyncSession = Depends(get_db)):
    """Receive a single tweet + screenshot from the Chrome extension."""
    # 1. Parse and validate tweet data
    # 2. Check for duplicate (tweet_id already exists)
    # 3. Store tweet in DB
    # 4. Decode base64 screenshot, save to filesystem
    # 5. Create Screenshot record
    # 6. Trigger article extraction if URLs detected
    # 7. Queue for next clustering run
    return {"id": tweet.id, "status": "saved"}
```

**Schema:**
```python
class TweetIngest(BaseModel):
    tweet_id: str
    author_handle: str
    author_display_name: str | None = None
    text: str
    media_urls: list[str] | None = None
    article_urls: list[str] | None = None
    engagement: dict | None = None  # {likes, retweets, replies}
    is_retweet: bool = False
    is_quote_tweet: bool = False
    quoted_tweet_id: str | None = None
    screenshot_base64: str  # PNG as base64
    feed_source: str | None = None  # "for_you" | "following" | "search" | "profile"
```

### New Endpoint: `POST /api/ingest/batch`

Same as above but accepts a list. Returns list of results with per-tweet status (saved / duplicate / error).

### Removed Code

| File | Action |
|------|--------|
| `backend/app/scraper/browser.py` | **DELETE** — no more Playwright browser management |
| `backend/app/scraper/auth.py` | **DELETE** — no more interactive login |
| `backend/app/scraper/feed.py` | **DELETE** — feed scrolling moves to extension |
| `backend/app/scraper/screenshot.py` | **DELETE** — screenshots captured by extension |
| `backend/app/scheduler.py` | **REFACTOR** — remove `scrape_job()`, keep `process_pipeline()` |
| `scripts/twitter-login.py` | **DELETE** — no more session cookie management |
| `scripts/upload-session.sh` | **DELETE** — no more session upload |

### Modified Code

| File | Change |
|------|--------|
| `backend/app/main.py` | Remove scheduler startup; add ingest router |
| `backend/app/routers/tweets.py` | Keep existing endpoints; `from-url` endpoint simplified |
| `backend/pyproject.toml` | Remove `playwright` dependency |
| `backend/Dockerfile` | Remove Playwright install (~400MB savings) |
| `docker-compose.yml` | Remove browser-related volumes |

### Kept As-Is

| File | Reason |
|------|--------|
| `backend/app/scraper/parser.py` | Pure data transformation, no Playwright |
| `backend/app/scraper/article.py` | Uses httpx, not Playwright |
| `backend/app/pipeline/*` | All pipeline code is Playwright-independent |
| `backend/app/routers/*` (except tweets) | No changes needed |
| `backend/app/models/*` | No schema changes |
| `frontend/src/*` | Dashboard works as-is, enhanced later |

## Screenshot Strategy

**Extension-side capture** replaces Playwright screenshots entirely:

1. **Before capture:** Content script injects `CLEANUP_CSS` (same styles from current `screenshot.py`) to hide engagement metrics, reply threads, navigation, sidebar
2. **Capture:** `chrome.tabs.captureVisibleTab()` returns full visible tab as PNG data URL
3. **Crop:** Calculate tweet element's `getBoundingClientRect()`, crop the full-tab image to just the tweet using an OffscreenCanvas
4. **Scale:** Chrome automatically captures at device pixel ratio (2x on Retina displays)
5. **After capture:** Remove injected CSS to restore normal view
6. **Send:** Base64 PNG sent to backend with tweet data

**Advantages over Playwright screenshots:**
- No separate page navigation per tweet (instant capture)
- Tweet renders exactly as the user sees it (same fonts, same rendering engine)
- No headless browser quirks (missing fonts, different rendering)
- Works with logged-in state automatically (private accounts, sensitive content)

**Trade-off:**
- Tweet must be visible on screen when saved (not a problem with explicit capture model)
- Screenshot includes whatever is currently rendered (may include partial rendering if captured too fast — mitigated by a brief delay)

## Pipeline Changes

### Current Pipeline (scheduled, automated)
```
Scheduler triggers every 2h
  → Launch Playwright browser
  → Scroll feeds, extract all tweets
  → Quality filter (network proximity, slop, diversity)
  → Store tweets
  → Cluster into topics (LLM)
  → Identify subtopics (LLM)
  → Capture screenshots (Playwright per-tweet)
  → Extract articles
  → Update lifecycle
  → Compute graph edges
```

### New Pipeline (event-driven, explicit)
```
User saves tweet via extension
  → Extension extracts data + captures screenshot
  → POST /api/ingest to backend
  → Store tweet + screenshot
  → Extract articles (if URLs detected)

Clustering runs on-demand or periodically:
  → Cluster today's saved tweets into topics (LLM)
  → Identify subtopics (LLM)
  → Update lifecycle
  → Compute graph edges
  → Write filesystem (YYYYMMDD/topic/subtopic/)
```

### Quality Pipeline Simplification

With explicit capture, quality filtering changes fundamentally:
- **Removed:** Network proximity scoring, slop detection, diversity cap — user is the filter
- **Kept:** Duplicate detection (same tweet_id), engagement tracking (for topic ranking)
- **New:** User curation signal — every saved tweet is inherently "high quality" because the user chose it
- **Optional:** Relevance classifier can still run to auto-suggest topic assignments

### Clustering Trigger

Two options for when clustering runs:

1. **On-demand:** Dashboard button "Re-cluster today's tweets" — user triggers manually
2. **Threshold-based:** Auto-trigger when N new tweets saved since last clustering (e.g., every 10 tweets)
3. **Periodic:** Run every 30 minutes if new tweets exist (lighter version of current scheduler)

Recommend option 2 (threshold-based) with option 1 available as manual override.

## Data Flow Summary

```
                    Chrome Extension
                    ┌─────────────────────────┐
                    │  Content Script          │
Twitter/X  ────►   │  ├── Save Button         │
(user browses)     │  ├── DOM Extraction      │
                    │  └── Screenshot Capture  │
                    └──────────┬──────────────┘
                               │ message
                    ┌──────────▼──────────────┐
                    │  Service Worker          │
                    │  ├── Queue & Batch       │
                    │  ├── Auth Headers        │
                    │  └── Retry Logic         │
                    └──────────┬──────────────┘
                               │ POST /api/ingest
                    ┌──────────▼──────────────┐
                    │  Backend (FastAPI)        │
                    │  ├── Store Tweet + PNG   │
                    │  ├── Extract Articles    │
                    │  ├── Cluster Topics      │
                    │  ├── Knowledge Graph     │
                    │  └── Serve Dashboard     │
                    └──────────┬──────────────┘
                               │
                    ┌──────────▼──────────────┐
                    │  Dashboard (React)        │
                    │  ├── Today's Feed        │
                    │  ├── Topic Detail        │
                    │  ├── Graph Explorer      │
                    │  ├── Asset Manager       │
                    │  └── Annotation Editor   │
                    └─────────────────────────┘
```

## What This Unlocks

1. **Zero server-side browser dependency** — no Playwright, no Chromium, ~400MB Docker savings
2. **No session management** — extension uses the user's actual logged-in browser
3. **No anti-bot risk** — user is browsing normally, not automating
4. **Better screenshots** — captured exactly as rendered, at native DPR
5. **Simpler deployment** — backend is pure Python API server, no browser automation
6. **Works on any Twitter page** — feed, search results, profiles, threads
7. **Mobile-friendly path** — could later add a bookmarklet or share-target for mobile

## Migration Path

The migration is additive then subtractive:
1. Build extension + new `/api/ingest` endpoint (additive)
2. Verify end-to-end flow works
3. Remove Playwright code, scheduler scrape job, login scripts (subtractive)
4. Update Docker images (remove Playwright/Chromium)
5. Update CLAUDE.md and documentation
