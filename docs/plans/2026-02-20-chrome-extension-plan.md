# Chrome Extension Migration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Playwright-based Twitter scraping with a Chrome extension that lets the user explicitly save tweets while browsing, then remove all Playwright code from the backend.

**Architecture:** Chrome extension (Manifest V3 content script + service worker) captures tweet data and screenshots from the user's browser, sends them to the existing FastAPI backend via a new `/api/ingest` endpoint. Backend keeps all clustering, knowledge graph, and dashboard functionality unchanged. Playwright, APScheduler scrape jobs, and session management scripts are removed entirely.

**Tech Stack:** Chrome Extension (Manifest V3, vanilla JS), Python 3.12 (FastAPI, SQLAlchemy), React 19, TypeScript, existing PostgreSQL + pgvector

**Design References:**
- `docs/plans/2026-02-20-chrome-extension-design.md` — architecture and data flow
- `docs/plans/2026-02-20-dashboard-design.md` — UI design system and component specs
- `docs/design-reference/dashboard-preview.html` — visual reference (open in browser)

---

## Phase 1: Backend Ingest API (Tasks 1–4)

Build the backend endpoint first so the extension has something to talk to.

---

### Task 1: Ingest Schema & Router Skeleton

**Files:**
- Create: `backend/app/schemas/ingest.py`
- Create: `backend/app/routers/ingest.py`
- Modify: `backend/app/main.py` (register router)
- Test: `backend/tests/test_ingest_api.py`

**Step 1: Write the failing test**

`backend/tests/test_ingest_api.py`:
```python
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db import Base, get_db
from app.main import app
from app.models.account import Account  # noqa: F401
from app.models.article import Article  # noqa: F401
from app.models.screenshot import Screenshot  # noqa: F401
from app.models.tweet import Tweet  # noqa: F401

from sqlalchemy.ext.compiler import compiles  # noqa: E402


@compiles(JSONB, "sqlite")
def _compile_jsonb_as_json(type_, compiler, **kw):
    return compiler.visit_JSON(type_, **kw)


TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
engine_test = create_async_engine(TEST_DATABASE_URL, echo=False)
async_session_test = async_sessionmaker(engine_test, expire_on_commit=False)


async def override_get_db():
    async with async_session_test() as session:
        yield session


@pytest_asyncio.fixture(autouse=True)
async def setup_database():
    app.dependency_overrides[get_db] = override_get_db
    async with engine_test.begin() as conn:
        await conn.run_sync(Account.__table__.create)
        await conn.run_sync(Tweet.__table__.create)
        await conn.run_sync(Article.__table__.create)
        await conn.run_sync(Screenshot.__table__.create)
    yield
    async with engine_test.begin() as conn:
        await conn.run_sync(Screenshot.__table__.drop)
        await conn.run_sync(Article.__table__.drop)
        await conn.run_sync(Tweet.__table__.drop)
        await conn.run_sync(Account.__table__.drop)
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# -- Minimal base64 PNG (1x1 transparent pixel) for testing --
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4"
    "nGNgYPgPAAEDAQAIicLsAAAABJRU5ErkJggg=="
)


@pytest.mark.asyncio
async def test_ingest_single_tweet(client: AsyncClient):
    payload = {
        "tweet_id": "1892345678",
        "author_handle": "karpathy",
        "author_display_name": "Andrej Karpathy",
        "text": "Claude 4 just dropped and it's amazing",
        "engagement": {"likes": 5000, "retweets": 1200, "replies": 300},
        "screenshot_base64": TINY_PNG_B64,
        "feed_source": "for_you",
    }
    response = await client.post("/api/ingest", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["tweet_id"] == "1892345678"
    assert data["author_handle"] == "karpathy"
    assert data["status"] == "saved"


@pytest.mark.asyncio
async def test_ingest_duplicate_returns_existing(client: AsyncClient):
    payload = {
        "tweet_id": "1892345678",
        "author_handle": "karpathy",
        "text": "Claude 4 just dropped",
        "screenshot_base64": TINY_PNG_B64,
    }
    resp1 = await client.post("/api/ingest", json=payload)
    assert resp1.status_code == 201

    resp2 = await client.post("/api/ingest", json=payload)
    assert resp2.status_code == 200
    assert resp2.json()["status"] == "duplicate"
```

**Step 2: Run test to verify it fails**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_ingest_api.py -v
```
Expected: FAIL — no route for `/api/ingest`

**Step 3: Implement schema**

`backend/app/schemas/ingest.py`:
```python
from pydantic import BaseModel


class TweetIngest(BaseModel):
    tweet_id: str
    author_handle: str
    author_display_name: str | None = None
    text: str
    media_urls: list[str] | None = None
    article_urls: list[str] | None = None
    engagement: dict | None = None
    is_retweet: bool = False
    is_quote_tweet: bool = False
    quoted_tweet_id: str | None = None
    screenshot_base64: str
    feed_source: str | None = None


class IngestResponse(BaseModel):
    id: int
    tweet_id: str
    author_handle: str
    status: str  # "saved" | "duplicate"

    model_config = {"from_attributes": True}


class BatchIngestRequest(BaseModel):
    tweets: list[TweetIngest]


class BatchIngestResponse(BaseModel):
    results: list[IngestResponse]
    saved_count: int
    duplicate_count: int
```

**Step 4: Implement router**

`backend/app/routers/ingest.py`:
```python
import base64
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.models.tweet import Tweet
from app.models.screenshot import Screenshot
from app.schemas.ingest import (
    BatchIngestRequest,
    BatchIngestResponse,
    IngestResponse,
    TweetIngest,
)

router = APIRouter(prefix="/api/ingest", tags=["ingest"])


def _save_screenshot(tweet_id: str, screenshot_b64: str) -> str:
    """Decode base64 PNG and save to filesystem. Returns relative file path."""
    today = date.today().strftime("%Y%m%d")
    dir_path = Path(settings.data_dir) / today / "screenshots"
    dir_path.mkdir(parents=True, exist_ok=True)
    file_path = dir_path / f"tweet_{tweet_id}.png"
    file_path.write_bytes(base64.b64decode(screenshot_b64))
    return str(file_path.relative_to(settings.data_dir))


async def _ingest_one(body: TweetIngest, db: AsyncSession) -> IngestResponse:
    """Ingest a single tweet. Returns saved or duplicate status."""
    # Check for duplicate
    result = await db.execute(
        select(Tweet).where(Tweet.tweet_id == body.tweet_id)
    )
    existing = result.scalar_one_or_none()
    if existing:
        return IngestResponse(
            id=existing.id,
            tweet_id=existing.tweet_id,
            author_handle=existing.author_handle,
            status="duplicate",
        )

    # Save screenshot
    file_path = _save_screenshot(body.tweet_id, body.screenshot_base64)

    # Create tweet
    tweet = Tweet(
        tweet_id=body.tweet_id,
        author_handle=body.author_handle,
        text=body.text,
        media_urls={"urls": body.media_urls} if body.media_urls else None,
        article_urls={"urls": body.article_urls} if body.article_urls else None,
        engagement=body.engagement,
        is_retweet=body.is_retweet,
        is_quote_tweet=body.is_quote_tweet,
        quoted_tweet_id=body.quoted_tweet_id,
        feed_source=body.feed_source,
    )
    db.add(tweet)
    await db.flush()

    # Create screenshot record
    screenshot = Screenshot(
        tweet_id=tweet.id,
        file_path=file_path,
    )
    db.add(screenshot)
    await db.commit()
    await db.refresh(tweet)

    return IngestResponse(
        id=tweet.id,
        tweet_id=tweet.tweet_id,
        author_handle=tweet.author_handle,
        status="saved",
    )


@router.post("", response_model=IngestResponse, status_code=201)
async def ingest_tweet(body: TweetIngest, db: AsyncSession = Depends(get_db)):
    result = await _ingest_one(body, db)
    return result


@router.post("/batch", response_model=BatchIngestResponse)
async def ingest_batch(body: BatchIngestRequest, db: AsyncSession = Depends(get_db)):
    results = []
    for tweet in body.tweets:
        result = await _ingest_one(tweet, db)
        results.append(result)
    return BatchIngestResponse(
        results=results,
        saved_count=sum(1 for r in results if r.status == "saved"),
        duplicate_count=sum(1 for r in results if r.status == "duplicate"),
    )
```

**Step 5: Register router in main.py**

Add to `backend/app/main.py` alongside existing router imports:
```python
from app.routers.ingest import router as ingest_router
# ...
app.include_router(ingest_router)
```

**Step 6: Run tests**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_ingest_api.py -v
```
Expected: PASS

**Step 7: Commit**

```bash
git add backend/app/schemas/ingest.py backend/app/routers/ingest.py backend/app/main.py backend/tests/test_ingest_api.py
git commit -m "feat: add /api/ingest endpoint for Chrome extension tweet ingestion"
```

---

### Task 2: Ingest Response Codes & Edge Cases

**Files:**
- Modify: `backend/app/routers/ingest.py`
- Test: `backend/tests/test_ingest_api.py`

**Step 1: Add edge case tests**

Append to `backend/tests/test_ingest_api.py`:
```python
@pytest.mark.asyncio
async def test_ingest_returns_200_for_duplicate(client: AsyncClient):
    """Duplicate ingestion should return 200, not 201."""
    payload = {
        "tweet_id": "9999",
        "author_handle": "test",
        "text": "test tweet",
        "screenshot_base64": TINY_PNG_B64,
    }
    await client.post("/api/ingest", json=payload)
    resp2 = await client.post("/api/ingest", json=payload)
    assert resp2.status_code == 200


@pytest.mark.asyncio
async def test_ingest_batch(client: AsyncClient):
    payload = {
        "tweets": [
            {
                "tweet_id": "111",
                "author_handle": "alice",
                "text": "First tweet",
                "screenshot_base64": TINY_PNG_B64,
            },
            {
                "tweet_id": "222",
                "author_handle": "bob",
                "text": "Second tweet",
                "screenshot_base64": TINY_PNG_B64,
            },
        ]
    }
    response = await client.post("/api/ingest/batch", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["saved_count"] == 2
    assert data["duplicate_count"] == 0
    assert len(data["results"]) == 2


@pytest.mark.asyncio
async def test_ingest_batch_with_duplicates(client: AsyncClient):
    # Pre-create one tweet
    await client.post("/api/ingest", json={
        "tweet_id": "333",
        "author_handle": "alice",
        "text": "Already exists",
        "screenshot_base64": TINY_PNG_B64,
    })
    payload = {
        "tweets": [
            {
                "tweet_id": "333",
                "author_handle": "alice",
                "text": "Already exists",
                "screenshot_base64": TINY_PNG_B64,
            },
            {
                "tweet_id": "444",
                "author_handle": "bob",
                "text": "New tweet",
                "screenshot_base64": TINY_PNG_B64,
            },
        ]
    }
    response = await client.post("/api/ingest/batch", json=payload)
    data = response.json()
    assert data["saved_count"] == 1
    assert data["duplicate_count"] == 1
```

**Step 2: Run tests to verify failures**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_ingest_api.py -v
```
Expected: `test_ingest_returns_200_for_duplicate` FAILS (currently always returns 201)

**Step 3: Fix response codes**

In `backend/app/routers/ingest.py`, update the `ingest_tweet` endpoint to return 200 for duplicates:

```python
from fastapi.responses import JSONResponse

@router.post("")
async def ingest_tweet(body: TweetIngest, db: AsyncSession = Depends(get_db)):
    result = await _ingest_one(body, db)
    status_code = 201 if result.status == "saved" else 200
    return JSONResponse(content=result.model_dump(), status_code=status_code)
```

**Step 4: Run tests**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_ingest_api.py -v
```
Expected: All PASS

**Step 5: Commit**

```bash
git add backend/app/routers/ingest.py backend/tests/test_ingest_api.py
git commit -m "feat: ingest batch endpoint and duplicate handling"
```

---

### Task 3: Unclustered Tweets API Endpoint

**Files:**
- Modify: `backend/app/routers/ingest.py`
- Test: `backend/tests/test_ingest_api.py`

The dashboard needs to show tweets that haven't been assigned to any topic yet.

**Step 1: Write the failing test**

Append to `backend/tests/test_ingest_api.py`:
```python
from app.models.topic import SubTopic, SubTopicTweet, Topic  # noqa: F401


@pytest_asyncio.fixture(autouse=True)
async def setup_database_with_topics():
    """Extended fixture that also creates topic tables."""
    app.dependency_overrides[get_db] = override_get_db
    async with engine_test.begin() as conn:
        await conn.run_sync(Account.__table__.create)
        await conn.run_sync(Tweet.__table__.create)
        await conn.run_sync(Article.__table__.create)
        await conn.run_sync(Screenshot.__table__.create)
        await conn.run_sync(Topic.__table__.create)
        await conn.run_sync(SubTopic.__table__.create)
        await conn.run_sync(SubTopicTweet.__table__.create)
    yield
    async with engine_test.begin() as conn:
        await conn.run_sync(SubTopicTweet.__table__.drop)
        await conn.run_sync(SubTopic.__table__.drop)
        await conn.run_sync(Topic.__table__.drop)
        await conn.run_sync(Screenshot.__table__.drop)
        await conn.run_sync(Article.__table__.drop)
        await conn.run_sync(Tweet.__table__.drop)
        await conn.run_sync(Account.__table__.drop)
    app.dependency_overrides.pop(get_db, None)
```

NOTE: Replace the existing `setup_database` fixture with this expanded one. Then add:

```python
@pytest.mark.asyncio
async def test_unclustered_tweets(client: AsyncClient):
    # Ingest two tweets
    for tid in ["aaa", "bbb"]:
        await client.post("/api/ingest", json={
            "tweet_id": tid,
            "author_handle": "test",
            "text": f"Tweet {tid}",
            "screenshot_base64": TINY_PNG_B64,
        })

    response = await client.get("/api/ingest/unclustered")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
```

**Step 2: Run test to verify it fails**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_ingest_api.py::test_unclustered_tweets -v
```
Expected: FAIL — no route

**Step 3: Implement unclustered endpoint**

Add to `backend/app/routers/ingest.py`:
```python
from app.models.topic import SubTopicTweet
from app.schemas.tweet import TweetOut


@router.get("/unclustered", response_model=list[TweetOut])
async def get_unclustered_tweets(db: AsyncSession = Depends(get_db)):
    """Return tweets not assigned to any subtopic (awaiting clustering)."""
    assigned_ids = select(SubTopicTweet.tweet_id).subquery()
    stmt = (
        select(Tweet)
        .where(Tweet.id.not_in(select(assigned_ids)))
        .order_by(Tweet.scraped_at.desc())
    )
    result = await db.execute(stmt)
    return result.scalars().all()
```

**Step 4: Run tests**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_ingest_api.py -v
```
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/routers/ingest.py backend/tests/test_ingest_api.py
git commit -m "feat: GET /api/ingest/unclustered endpoint for dashboard queue"
```

---

### Task 4: Clustering Trigger Endpoint

**Files:**
- Modify: `backend/app/routers/ingest.py`
- Test: `backend/tests/test_ingest_api.py`

**Step 1: Write the failing test**

Append to `backend/tests/test_ingest_api.py`:
```python
@pytest.mark.asyncio
async def test_trigger_clustering(client: AsyncClient):
    # Ingest some tweets first
    for tid in ["t1", "t2", "t3"]:
        await client.post("/api/ingest", json={
            "tweet_id": tid,
            "author_handle": "test",
            "text": f"Tweet about AI {tid}",
            "screenshot_base64": TINY_PNG_B64,
        })

    response = await client.post("/api/ingest/cluster")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert data["status"] in ("started", "no_tweets")
```

**Step 2: Run test to verify it fails**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_ingest_api.py::test_trigger_clustering -v
```

**Step 3: Implement clustering trigger**

Add to `backend/app/routers/ingest.py`:
```python
import asyncio
from app.schemas.ingest import ClusterTriggerResponse
```

Add to `backend/app/schemas/ingest.py`:
```python
class ClusterTriggerResponse(BaseModel):
    status: str  # "started" | "no_tweets"
    unclustered_count: int
```

Add to `backend/app/routers/ingest.py`:
```python
@router.post("/cluster", response_model=ClusterTriggerResponse)
async def trigger_clustering(db: AsyncSession = Depends(get_db)):
    """Trigger clustering of unclustered tweets."""
    assigned_ids = select(SubTopicTweet.tweet_id).subquery()
    stmt = select(Tweet).where(Tweet.id.not_in(select(assigned_ids)))
    result = await db.execute(stmt)
    unclustered = result.scalars().all()

    if not unclustered:
        return ClusterTriggerResponse(status="no_tweets", unclustered_count=0)

    # Import and run pipeline in background
    # For now, just return status — pipeline integration comes in Phase 4
    return ClusterTriggerResponse(
        status="started",
        unclustered_count=len(unclustered),
    )
```

**Step 4: Run tests**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_ingest_api.py -v
```
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/schemas/ingest.py backend/app/routers/ingest.py backend/tests/test_ingest_api.py
git commit -m "feat: POST /api/ingest/cluster trigger endpoint"
```

---

## Phase 2: Chrome Extension (Tasks 5–10)

---

### Task 5: Extension Project Structure & Manifest

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/icons/icon16.png` (placeholder)
- Create: `extension/icons/icon48.png` (placeholder)
- Create: `extension/icons/icon128.png` (placeholder)

**Step 1: Create extension directory**

```bash
mkdir -p extension/icons
```

**Step 2: Create manifest.json**

`extension/manifest.json`:
```json
{
  "manifest_version": 3,
  "name": "tpot-digest",
  "version": "0.1.0",
  "description": "Save tweets to your tpot-digest dashboard",
  "permissions": [
    "activeTab",
    "storage"
  ],
  "host_permissions": [
    "https://twitter.com/*",
    "https://x.com/*"
  ],
  "content_scripts": [
    {
      "matches": ["https://twitter.com/*", "https://x.com/*"],
      "js": ["content.js"],
      "css": ["content.css"],
      "run_at": "document_idle"
    }
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

**Step 3: Create placeholder icon**

Generate a simple placeholder icon using a canvas-based approach (or use any 128x128 PNG). For now, create a simple SVG-converted PNG:

```bash
# Create a simple placeholder icon using Python
python3 -c "
import struct, zlib
def create_png(size, color):
    def chunk(ctype, data):
        c = ctype + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    raw = b''
    for y in range(size):
        raw += b'\x00' + bytes(color) * size
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
amber = (232, 168, 56)
for s in [16, 48, 128]:
    open(f'extension/icons/icon{s}.png', 'wb').write(create_png(s, amber))
print('Icons created')
"
```

**Step 4: Verify manifest loads in Chrome**

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → select `extension/` directory
4. Verify extension appears (will show errors for missing JS files — that's expected)

**Step 5: Commit**

```bash
git add extension/
git commit -m "feat: Chrome extension project structure and manifest"
```

---

### Task 6: Content Script — Save Button Injection

**Files:**
- Create: `extension/content.js`
- Create: `extension/content.css`

**Step 1: Create content CSS**

`extension/content.css`:
```css
/* Save button injected onto tweets */
.tpot-save-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(232, 168, 56, 0.9);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 150ms ease, transform 150ms ease;
  z-index: 10;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}

/* Show on tweet hover */
article[data-testid="tweet"]:hover .tpot-save-btn {
  opacity: 1;
}

.tpot-save-btn:hover {
  transform: scale(1.1);
  background: rgba(240, 184, 74, 1);
}

.tpot-save-btn:active {
  transform: scale(0.95);
}

/* Save icon (plus sign) */
.tpot-save-btn::before {
  content: "+";
  font-size: 20px;
  font-weight: 700;
  color: #0C0B0A;
  line-height: 1;
}

/* Saved state */
.tpot-save-btn.saved {
  background: rgba(92, 184, 92, 0.9);
  opacity: 1;
}

.tpot-save-btn.saved::before {
  content: "✓";
  font-size: 16px;
}

.tpot-save-btn.saving {
  opacity: 1;
  pointer-events: none;
}

.tpot-save-btn.saving::before {
  content: "";
}

.tpot-save-btn.saving::after {
  content: "";
  width: 14px;
  height: 14px;
  border: 2px solid #0C0B0A;
  border-top-color: transparent;
  border-radius: 50%;
  animation: tpot-spin 600ms linear infinite;
}

@keyframes tpot-spin {
  to { transform: rotate(360deg); }
}

/* Toast notification */
.tpot-toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  background: #161514;
  color: #E8E4DF;
  padding: 12px 20px;
  border-radius: 8px;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 14px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  border: 1px solid #2A2725;
  z-index: 100000;
  opacity: 0;
  transform: translateY(12px);
  transition: opacity 250ms ease, transform 250ms ease;
}

.tpot-toast.visible {
  opacity: 1;
  transform: translateY(0);
}

.tpot-toast .accent {
  color: #E8A838;
  font-weight: 600;
}

/* Ensure tweet article is positioned for absolute save button */
article[data-testid="tweet"] {
  position: relative !important;
}
```

**Step 2: Create content script with button injection**

`extension/content.js`:
```javascript
// tpot-digest content script — injects save buttons on tweets

(() => {
  "use strict";

  const SAVED_TWEET_IDS = new Set();

  // ── Button Injection ──────────────────────────────────────────────

  function injectSaveButton(article) {
    if (article.querySelector(".tpot-save-btn")) return;

    const btn = document.createElement("button");
    btn.className = "tpot-save-btn";
    btn.title = "Save to tpot-digest";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleSave(article, btn);
    });

    article.appendChild(btn);

    // Check if already saved
    const tweetId = extractTweetId(article);
    if (tweetId && SAVED_TWEET_IDS.has(tweetId)) {
      btn.classList.add("saved");
      btn.title = "Saved to tpot-digest";
    }
  }

  // ── Tweet ID Extraction ───────────────────────────────────────────

  function extractTweetId(article) {
    const link = article.querySelector('a[href*="/status/"]');
    if (!link) return null;
    const match = link.getAttribute("href").match(/status\/(\d+)/);
    return match ? match[1] : null;
  }

  // ── Tweet Data Extraction ─────────────────────────────────────────

  function extractTweetData(article) {
    const tweetId = extractTweetId(article);

    // Author
    const handleEl = article.querySelector('div[data-testid="User-Name"] a[href^="/"]');
    const authorHandle = handleEl
      ? handleEl.getAttribute("href").replace("/", "")
      : "";

    const displayNameEl = article.querySelector('div[data-testid="User-Name"] span');
    const authorDisplayName = displayNameEl ? displayNameEl.textContent : "";

    // Text
    const textEl = article.querySelector('div[data-testid="tweetText"]');
    const text = textEl ? textEl.textContent : "";

    // Media
    const mediaEls = article.querySelectorAll('img[src*="pbs.twimg.com/media"]');
    const mediaUrls = Array.from(mediaEls).map((el) => el.src);

    // Engagement
    const likesEl = article.querySelector('button[data-testid="like"] span');
    const retweetsEl = article.querySelector('button[data-testid="retweet"] span');
    const repliesEl = article.querySelector('button[data-testid="reply"] span');

    // Retweet / quote detection
    const rtIndicator = article.querySelector('span[data-testid="socialContext"]');
    const isRetweet = rtIndicator
      ? rtIndicator.textContent.includes("reposted")
      : false;
    const isQuoteTweet = !!article.querySelector('div[role="link"][tabindex="0"]');

    // Article URLs from card
    const cardLink = article.querySelector('a[data-testid="card.wrapper"]');
    const articleUrls = cardLink ? [cardLink.href] : [];

    return {
      tweet_id: tweetId,
      author_handle: authorHandle,
      author_display_name: authorDisplayName,
      text,
      media_urls: mediaUrls.length > 0 ? mediaUrls : null,
      article_urls: articleUrls.length > 0 ? articleUrls : null,
      engagement: {
        likes: parseCount(likesEl ? likesEl.textContent : "0"),
        retweets: parseCount(retweetsEl ? retweetsEl.textContent : "0"),
        replies: parseCount(repliesEl ? repliesEl.textContent : "0"),
      },
      is_retweet: isRetweet,
      is_quote_tweet: isQuoteTweet,
      feed_source: detectFeedSource(),
    };
  }

  function parseCount(text) {
    if (!text) return 0;
    text = text.trim().replace(/,/g, "");
    if (text.endsWith("K")) return Math.round(parseFloat(text) * 1000);
    if (text.endsWith("M")) return Math.round(parseFloat(text) * 1000000);
    return parseInt(text, 10) || 0;
  }

  function detectFeedSource() {
    const path = window.location.pathname;
    if (path === "/home") return "for_you";
    if (path.includes("/following")) return "following";
    if (path.includes("/search")) return "search";
    if (path.includes("/status/")) return "thread";
    return "profile";
  }

  // ── Screenshot Capture ────────────────────────────────────────────

  const CLEANUP_CSS = `
    div[role="group"]:has(button[data-testid="like"]) { display: none !important; }
    div[data-testid="cellInnerDiv"]:has(div[data-testid="tweet"]) ~ div { display: none !important; }
    div[data-testid="restrictedReplyNotice"] { display: none !important; }
    button[data-testid*="follow"] { display: none !important; }
    div[role="link"][tabindex="0"] { display: none !important; }
    .tpot-save-btn { display: none !important; }
  `;

  async function captureScreenshot(article) {
    // Inject cleanup CSS
    const style = document.createElement("style");
    style.textContent = CLEANUP_CSS;
    style.id = "tpot-cleanup-css";
    document.head.appendChild(style);

    // Wait a frame for CSS to apply
    await new Promise((r) => requestAnimationFrame(r));

    // Get bounding rect
    const rect = article.getBoundingClientRect();

    // Request screenshot from service worker
    const response = await chrome.runtime.sendMessage({
      type: "CAPTURE_SCREENSHOT",
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      devicePixelRatio: window.devicePixelRatio,
    });

    // Remove cleanup CSS
    style.remove();

    return response.screenshot_base64;
  }

  // ── Save Handler ──────────────────────────────────────────────────

  async function handleSave(article, btn) {
    const tweetId = extractTweetId(article);
    if (!tweetId || SAVED_TWEET_IDS.has(tweetId)) return;

    btn.classList.add("saving");

    try {
      const tweetData = extractTweetData(article);
      const screenshotBase64 = await captureScreenshot(article);

      const response = await chrome.runtime.sendMessage({
        type: "SAVE_TWEET",
        tweet: {
          ...tweetData,
          screenshot_base64: screenshotBase64,
        },
      });

      if (response.success) {
        SAVED_TWEET_IDS.add(tweetId);
        btn.classList.remove("saving");
        btn.classList.add("saved");
        btn.title = "Saved to tpot-digest";
        showToast(`Saved @${tweetData.author_handle}'s tweet`);
      } else {
        btn.classList.remove("saving");
        showToast(`Error: ${response.error}`, true);
      }
    } catch (err) {
      btn.classList.remove("saving");
      showToast(`Error: ${err.message}`, true);
    }
  }

  // ── Toast Notifications ───────────────────────────────────────────

  function showToast(message, isError = false) {
    const existing = document.querySelector(".tpot-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "tpot-toast";
    toast.innerHTML = isError
      ? `<span style="color:#D9534F">✕</span> ${message}`
      : `<span class="accent">✓</span> ${message}`;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("visible"));

    setTimeout(() => {
      toast.classList.remove("visible");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ── MutationObserver ──────────────────────────────────────────────

  function scanForTweets() {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    articles.forEach(injectSaveButton);
  }

  const observer = new MutationObserver(() => {
    scanForTweets();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Initial scan
  scanForTweets();
})();
```

**Step 3: Test by loading extension**

1. Open `chrome://extensions/` → reload the extension
2. Navigate to `https://x.com/home`
3. Verify save buttons appear on tweets (hover to see)
4. Clicking will fail (service worker not yet implemented) — that's expected

**Step 4: Commit**

```bash
git add extension/content.js extension/content.css
git commit -m "feat: content script with save button injection and tweet extraction"
```

---

### Task 7: Service Worker — Screenshot Capture & API Communication

**Files:**
- Create: `extension/background.js`

**Step 1: Create service worker**

`extension/background.js`:
```javascript
// tpot-digest service worker — handles screenshots and backend communication

// ── Configuration ───────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  backendUrl: "http://localhost:8000",
  authUser: "",
  authPass: "",
};

async function getConfig() {
  const result = await chrome.storage.sync.get(DEFAULT_CONFIG);
  return result;
}

// ── Daily Counter ───────────────────────────────────────────────────

async function incrementDailyCount() {
  const today = new Date().toISOString().slice(0, 10);
  const key = `count_${today}`;
  const result = await chrome.storage.local.get({ [key]: 0 });
  const count = result[key] + 1;
  await chrome.storage.local.set({ [key]: count });

  // Update badge
  chrome.action.setBadgeText({ text: String(count) });
  chrome.action.setBadgeBackgroundColor({ color: "#E8A838" });
  return count;
}

async function getDailyCount() {
  const today = new Date().toISOString().slice(0, 10);
  const key = `count_${today}`;
  const result = await chrome.storage.local.get({ [key]: 0 });
  return result[key];
}

// ── Message Handler ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CAPTURE_SCREENSHOT") {
    handleScreenshot(message, sender.tab.id).then(sendResponse);
    return true; // async response
  }

  if (message.type === "SAVE_TWEET") {
    handleSaveTweet(message.tweet).then(sendResponse);
    return true;
  }

  if (message.type === "GET_STATUS") {
    handleGetStatus().then(sendResponse);
    return true;
  }
});

// ── Screenshot Capture ──────────────────────────────────────────────

async function handleScreenshot(message, tabId) {
  try {
    // Capture the visible tab
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: "png",
    });

    // Crop to the tweet bounding rect
    const { rect, devicePixelRatio } = message;
    const cropped = await cropImage(dataUrl, rect, devicePixelRatio);

    return { screenshot_base64: cropped };
  } catch (err) {
    console.error("Screenshot capture failed:", err);
    return { screenshot_base64: null, error: err.message };
  }
}

async function cropImage(dataUrl, rect, dpr) {
  // Use OffscreenCanvas to crop the screenshot
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const x = Math.round(rect.x * dpr);
  const y = Math.round(rect.y * dpr);
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
  bitmap.close();

  const croppedBlob = await canvas.convertToBlob({ type: "image/png" });
  const buffer = await croppedBlob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ── Save Tweet to Backend ───────────────────────────────────────────

async function handleSaveTweet(tweet) {
  const config = await getConfig();

  try {
    const headers = { "Content-Type": "application/json" };
    if (config.authUser && config.authPass) {
      headers["Authorization"] =
        "Basic " + btoa(`${config.authUser}:${config.authPass}`);
    }

    const resp = await fetch(`${config.backendUrl}/api/ingest`, {
      method: "POST",
      headers,
      body: JSON.stringify(tweet),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return { success: false, error: `HTTP ${resp.status}: ${text}` };
    }

    const data = await resp.json();
    await incrementDailyCount();
    return { success: true, data };
  } catch (err) {
    // Queue for retry
    await queueForRetry(tweet);
    return { success: false, error: err.message };
  }
}

// ── Retry Queue ─────────────────────────────────────────────────────

async function queueForRetry(tweet) {
  const result = await chrome.storage.local.get({ retryQueue: [] });
  result.retryQueue.push({
    tweet,
    queuedAt: Date.now(),
  });
  await chrome.storage.local.set({ retryQueue: result.retryQueue });
}

async function processRetryQueue() {
  const result = await chrome.storage.local.get({ retryQueue: [] });
  if (result.retryQueue.length === 0) return;

  const remaining = [];
  for (const item of result.retryQueue) {
    const resp = await handleSaveTweet(item.tweet);
    if (!resp.success) {
      // Keep in queue if less than 1 hour old
      if (Date.now() - item.queuedAt < 3600000) {
        remaining.push(item);
      }
    }
  }
  await chrome.storage.local.set({ retryQueue: remaining });
}

// Retry every 5 minutes
chrome.alarms.create("retryQueue", { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "retryQueue") processRetryQueue();
});

// ── Status ──────────────────────────────────────────────────────────

async function handleGetStatus() {
  const config = await getConfig();
  const count = await getDailyCount();

  let connected = false;
  try {
    const resp = await fetch(`${config.backendUrl}/api/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    connected = resp.ok;
  } catch {
    connected = false;
  }

  return {
    connected,
    dailyCount: count,
    backendUrl: config.backendUrl,
  };
}

// ── Init ────────────────────────────────────────────────────────────

// Set initial badge count on startup
getDailyCount().then((count) => {
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: "#E8A838" });
  }
});
```

**Step 2: Test end-to-end**

1. Start backend: `docker compose up backend`
2. Reload extension in `chrome://extensions/`
3. Navigate to `https://x.com/home`
4. Hover over a tweet → click the amber save button
5. Verify toast shows "Saved @handle's tweet"
6. Check backend: `curl http://localhost:8000/api/tweets`

**Step 3: Commit**

```bash
git add extension/background.js
git commit -m "feat: service worker with screenshot capture and backend communication"
```

---

### Task 8: Extension Popup UI

**Files:**
- Create: `extension/popup.html`
- Create: `extension/popup.js`
- Create: `extension/popup.css`

**Step 1: Create popup HTML**

`extension/popup.html`:
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="popup">
    <div class="header">
      <div class="logo">t</div>
      <div class="title">tpot-digest</div>
    </div>

    <div class="status-bar" id="status">
      <span class="status-dot" id="statusDot"></span>
      <span id="statusText">Checking...</span>
    </div>

    <div class="stat">
      <span class="stat-count" id="dailyCount">0</span>
      <span class="stat-label">saved today</span>
    </div>

    <div class="divider"></div>

    <div class="settings">
      <label class="field-label">Backend URL</label>
      <input type="url" id="backendUrl" placeholder="http://localhost:8000">

      <label class="field-label">Username</label>
      <input type="text" id="authUser" placeholder="(optional)">

      <label class="field-label">Password</label>
      <input type="password" id="authPass" placeholder="(optional)">

      <button class="btn-save" id="saveBtn">Save Settings</button>
    </div>
  </div>
  <script src="popup.js"></script>
</body>
</html>
```

**Step 2: Create popup CSS**

`extension/popup.css`:
```css
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  width: 280px;
  background: #0C0B0A;
  color: #E8E4DF;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13px;
}

.popup { padding: 16px; }

.header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.logo {
  width: 28px;
  height: 28px;
  background: #E8A838;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 16px;
  color: #0C0B0A;
}

.title {
  font-size: 15px;
  font-weight: 600;
}

.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #161514;
  border-radius: 6px;
  margin-bottom: 16px;
  font-size: 12px;
  color: #9B9590;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #6B6560;
}

.status-dot.connected { background: #5CB85C; }
.status-dot.disconnected { background: #D9534F; }

.stat {
  text-align: center;
  padding: 12px 0;
}

.stat-count {
  display: block;
  font-size: 32px;
  font-weight: 700;
  color: #E8A838;
  line-height: 1;
}

.stat-label {
  font-size: 12px;
  color: #9B9590;
}

.divider {
  height: 1px;
  background: #2A2725;
  margin: 12px 0;
}

.settings { display: flex; flex-direction: column; gap: 8px; }

.field-label {
  font-size: 11px;
  color: #6B6560;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

input {
  width: 100%;
  padding: 8px 10px;
  background: #161514;
  border: 1px solid #2A2725;
  border-radius: 4px;
  color: #E8E4DF;
  font-size: 13px;
  outline: none;
}

input:focus { border-color: #E8A838; }
input::placeholder { color: #6B6560; }

.btn-save {
  margin-top: 4px;
  padding: 8px;
  background: #E8A838;
  color: #0C0B0A;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
}

.btn-save:hover { background: #F0B84A; }
```

**Step 3: Create popup JS**

`extension/popup.js`:
```javascript
document.addEventListener("DOMContentLoaded", async () => {
  // Load saved settings
  const config = await chrome.storage.sync.get({
    backendUrl: "http://localhost:8000",
    authUser: "",
    authPass: "",
  });

  document.getElementById("backendUrl").value = config.backendUrl;
  document.getElementById("authUser").value = config.authUser;
  document.getElementById("authPass").value = config.authPass;

  // Get status from service worker
  const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });

  const dot = document.getElementById("statusDot");
  const text = document.getElementById("statusText");
  const count = document.getElementById("dailyCount");

  if (status.connected) {
    dot.className = "status-dot connected";
    text.textContent = "Connected to backend";
  } else {
    dot.className = "status-dot disconnected";
    text.textContent = "Cannot reach backend";
  }

  count.textContent = status.dailyCount || 0;

  // Save button
  document.getElementById("saveBtn").addEventListener("click", async () => {
    await chrome.storage.sync.set({
      backendUrl: document.getElementById("backendUrl").value.replace(/\/$/, ""),
      authUser: document.getElementById("authUser").value,
      authPass: document.getElementById("authPass").value,
    });

    const btn = document.getElementById("saveBtn");
    btn.textContent = "Saved!";
    setTimeout(() => (btn.textContent = "Save Settings"), 1500);
  });
});
```

**Step 4: Test popup**

1. Reload extension
2. Click extension icon in toolbar
3. Verify popup shows with status, count, and settings fields
4. Enter backend URL, save, verify it persists on popup reopen

**Step 5: Commit**

```bash
git add extension/popup.html extension/popup.js extension/popup.css
git commit -m "feat: extension popup with status and settings"
```

---

## Phase 3: Dashboard Updates (Tasks 9–12)

---

### Task 9: Dashboard Design System CSS

**Files:**
- Create: `frontend/src/styles/design-system.css`
- Modify: `frontend/src/App.tsx` (import CSS)

**Step 1: Create design system CSS**

`frontend/src/styles/design-system.css`:
```css
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;0,9..144,700;1,9..144,400&family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --bg-base: #0C0B0A;
  --bg-raised: #161514;
  --bg-elevated: #1E1D1B;
  --bg-hover: #252320;
  --bg-active: #2E2B28;

  --border-subtle: #2A2725;
  --border-strong: #3D3935;

  --text-primary: #E8E4DF;
  --text-secondary: #9B9590;
  --text-tertiary: #6B6560;
  --text-inverse: #0C0B0A;

  --accent: #E8A838;
  --accent-hover: #F0B84A;
  --accent-muted: rgba(232, 168, 56, 0.12);

  --emerging: #4ECDC4;
  --emerging-bg: rgba(78, 205, 196, 0.12);
  --trending: #E8A838;
  --trending-bg: rgba(232, 168, 56, 0.12);
  --peaked: #E85D3A;
  --peaked-bg: rgba(232, 93, 58, 0.12);
  --fading: #6B6560;
  --fading-bg: rgba(107, 101, 96, 0.12);

  --positive: #5CB85C;
  --negative: #D9534F;
  --neutral: #9B9590;
  --mixed: #E8A838;

  --font-display: 'Fraunces', Georgia, serif;
  --font-body: 'Outfit', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;

  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.4);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.5);

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border-subtle); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--border-strong); }
```

**Step 2: Import in App.tsx**

Add to the top of `frontend/src/App.tsx`:
```typescript
import './styles/design-system.css'
```

**Step 3: Verify**

```bash
cd frontend && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add frontend/src/styles/design-system.css frontend/src/App.tsx
git commit -m "feat: dashboard design system CSS with dark editorial theme"
```

---

### Task 10: Extension Status API Hook

**Files:**
- Create: `frontend/src/api/ingest.ts`
- Create: `frontend/src/components/ExtensionStatus.tsx`

**Step 1: Create API hook**

`frontend/src/api/ingest.ts`:
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

interface IngestResponse {
  id: number
  tweet_id: string
  author_handle: string
  status: 'saved' | 'duplicate'
}

interface UnclusteredTweet {
  id: number
  tweet_id: string
  author_handle: string
  text: string
  scraped_at: string
  engagement: Record<string, number> | null
}

interface ClusterResponse {
  status: 'started' | 'no_tweets'
  unclustered_count: number
}

export function useUnclusteredTweets() {
  return useQuery<UnclusteredTweet[]>({
    queryKey: ['unclustered'],
    queryFn: async () => {
      const { data } = await api.get('/ingest/unclustered')
      return data
    },
    refetchInterval: 15000,
  })
}

export function useTriggerClustering() {
  const queryClient = useQueryClient()
  return useMutation<ClusterResponse>({
    mutationFn: async () => {
      const { data } = await api.post('/ingest/cluster')
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unclustered'] })
      queryClient.invalidateQueries({ queryKey: ['topics'] })
    },
  })
}
```

**Step 2: Create ExtensionStatus component**

`frontend/src/components/ExtensionStatus.tsx`:
```typescript
import { useUnclusteredTweets } from '../api/ingest'

export function ExtensionStatus() {
  const { data: unclustered } = useUnclusteredTweets()
  const count = unclustered?.length ?? 0

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 12px',
      background: 'var(--bg-elevated)',
      borderRadius: '20px',
      border: '1px solid var(--border-subtle)',
      fontSize: '13px',
      color: 'var(--text-secondary)',
    }}>
      <span style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: 'var(--positive)',
      }} />
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--accent)' }}>
        {count}
      </span>
      <span>unclustered</span>
    </div>
  )
}
```

**Step 3: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add frontend/src/api/ingest.ts frontend/src/components/ExtensionStatus.tsx
git commit -m "feat: extension status component and ingest API hooks"
```

---

### Task 11: Unclustered Queue Component

**Files:**
- Create: `frontend/src/components/UnclusteredQueue.tsx`

**Step 1: Create component**

`frontend/src/components/UnclusteredQueue.tsx`:
```typescript
import { useUnclusteredTweets, useTriggerClustering } from '../api/ingest'

export function UnclusteredQueue() {
  const { data: tweets, isLoading } = useUnclusteredTweets()
  const clustering = useTriggerClustering()

  if (isLoading || !tweets || tweets.length === 0) return null

  return (
    <div style={{
      background: 'var(--bg-raised)',
      border: '1px dashed var(--border-strong)',
      borderRadius: 'var(--radius-lg)',
      padding: '20px 24px',
      marginBottom: '16px',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '16px',
      }}>
        <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
            {tweets.length}
          </span>
          {' '}tweets awaiting clustering
        </div>
        <button
          onClick={() => clustering.mutate()}
          disabled={clustering.isPending}
          style={{
            padding: '8px 16px',
            background: clustering.isPending ? 'var(--bg-active)' : 'var(--accent)',
            color: clustering.isPending ? 'var(--text-secondary)' : 'var(--text-inverse)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontFamily: 'var(--font-body)',
            fontSize: '13px',
            fontWeight: 600,
            cursor: clustering.isPending ? 'not-allowed' : 'pointer',
          }}
        >
          {clustering.isPending ? 'Clustering...' : 'Re-cluster Now'}
        </button>
      </div>
      <div style={{
        display: 'flex',
        gap: '8px',
        overflowX: 'auto',
        paddingBottom: '4px',
      }}>
        {tweets.map((tweet) => (
          <div
            key={tweet.id}
            style={{
              width: '120px',
              height: '90px',
              flexShrink: 0,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              @{tweet.author_handle}
            </div>
            <div style={{
              fontSize: '10px',
              color: 'var(--text-tertiary)',
              lineHeight: 1.3,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical' as const,
            }}>
              {tweet.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

**Step 2: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add frontend/src/components/UnclusteredQueue.tsx
git commit -m "feat: unclustered tweet queue component for dashboard"
```

---

### Task 12: Lifecycle Badge Component (design system aligned)

**Files:**
- Create: `frontend/src/components/LifecycleBadge.tsx` (rewrite with design system)

**Step 1: Read existing component**

Check `frontend/src/components/LifecycleBadge.tsx` — rewrite it to use the new design system CSS variables.

**Step 2: Rewrite component**

`frontend/src/components/LifecycleBadge.tsx`:
```typescript
type LifecycleStatus = 'emerging' | 'trending' | 'peaked' | 'fading'

const STYLES: Record<LifecycleStatus, { color: string; bg: string }> = {
  emerging: { color: 'var(--emerging)', bg: 'var(--emerging-bg)' },
  trending: { color: 'var(--trending)', bg: 'var(--trending-bg)' },
  peaked: { color: 'var(--peaked)', bg: 'var(--peaked-bg)' },
  fading: { color: 'var(--fading)', bg: 'var(--fading-bg)' },
}

interface Props {
  status: LifecycleStatus
}

export function LifecycleBadge({ status }: Props) {
  const style = STYLES[status] ?? STYLES.emerging

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '3px 10px',
      borderRadius: '20px',
      fontSize: '11px',
      fontWeight: 600,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      fontFamily: 'var(--font-body)',
      color: style.color,
      background: style.bg,
    }}>
      {status}
    </span>
  )
}
```

**Step 3: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add frontend/src/components/LifecycleBadge.tsx
git commit -m "feat: lifecycle badge aligned with dark editorial design system"
```

---

## Phase 4: Playwright Removal & Cleanup (Tasks 13–16)

---

### Task 13: Remove Playwright Scraper Code

**Files:**
- Delete: `backend/app/scraper/browser.py`
- Delete: `backend/app/scraper/auth.py`
- Delete: `backend/app/scraper/feed.py`
- Delete: `backend/app/scraper/screenshot.py`
- Delete: `scripts/twitter-login.py`
- Delete: `scripts/upload-session.sh`
- Modify: `backend/app/scraper/__init__.py` (remove imports)
- Test: Run existing test suite to verify no breakage

**Step 1: Verify what imports the files being deleted**

```bash
# Check for imports of the files we're deleting
backend/.venv/bin/python -m pytest backend/tests/ -q --co 2>/dev/null | head -20
```

Search the codebase for imports of `scraper.browser`, `scraper.auth`, `scraper.feed`, `scraper.screenshot`:

```bash
grep -r "from app.scraper.browser\|from app.scraper.auth\|from app.scraper.feed\|from app.scraper.screenshot" backend/app/ --include="*.py"
```

Expected matches: `scheduler.py` and possibly `routers/tweets.py` or `routers/scheduler.py`.

**Step 2: Delete files**

```bash
rm backend/app/scraper/browser.py
rm backend/app/scraper/auth.py
rm backend/app/scraper/feed.py
rm backend/app/scraper/screenshot.py
rm -f scripts/twitter-login.py
rm -f scripts/upload-session.sh
```

**Step 3: Clean up imports**

Remove any imports of deleted modules from:
- `backend/app/scraper/__init__.py`
- `backend/app/scheduler.py` (next task handles this)
- Any router that referenced scraper functions

**Step 4: Run all tests**

```bash
backend/.venv/bin/python -m pytest backend/tests/ -q
```
Expected: All existing tests PASS (none should depend on deleted files)

**Step 5: Commit**

```bash
git add -u
git commit -m "refactor: remove Playwright scraper code (browser, auth, feed, screenshot)"
```

---

### Task 14: Refactor Scheduler — Remove Scrape Job

**Files:**
- Modify: `backend/app/scheduler.py`
- Modify: `backend/app/main.py` (remove scheduler startup if empty)
- Test: `backend/tests/test_scheduler.py`

**Step 1: Read current scheduler**

Read `backend/app/scheduler.py` to understand what functions exist.

**Step 2: Remove scrape_job, keep process_pipeline**

The `scrape_job()` function launches Playwright and scrapes feeds — delete it. The `process_pipeline()` function does clustering, articles, lifecycle, graph — keep it. It's now called from the `/api/ingest/cluster` endpoint instead of a scheduled job.

Refactored `backend/app/scheduler.py`:
```python
"""Pipeline processing — called on-demand from ingest router."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tweet import Tweet
from app.models.topic import SubTopicTweet


async def process_pipeline(db: AsyncSession):
    """Run clustering pipeline on unclustered tweets."""
    # Get unclustered tweets
    assigned_ids = select(SubTopicTweet.tweet_id).subquery()
    stmt = select(Tweet).where(Tweet.id.not_in(select(assigned_ids)))
    result = await db.execute(stmt)
    tweets = result.scalars().all()

    if not tweets:
        return

    # Import pipeline functions
    from app.pipeline.clustering import cluster_into_topics, identify_subtopics
    from app.pipeline.lifecycle import compute_lifecycle_status

    # Pass 1: Cluster into topics
    tweet_dicts = [{"id": t.id, "text": t.text, "author_handle": t.author_handle} for t in tweets]
    topics = await cluster_into_topics(tweet_dicts)

    # Pass 2: Identify subtopics
    for topic in topics:
        await identify_subtopics(topic["title"], topic["tweets"])

    # Additional pipeline steps (articles, lifecycle, graph)
    # These are triggered by the existing pipeline code
```

**Step 3: Update main.py**

Remove scheduler startup/shutdown from lifespan if the scheduler is no longer time-based. Keep the lifespan for other startup tasks (like DB init).

**Step 4: Run tests**

```bash
backend/.venv/bin/python -m pytest backend/tests/ -q
```

**Step 5: Commit**

```bash
git add backend/app/scheduler.py backend/app/main.py
git commit -m "refactor: scheduler to on-demand pipeline, remove scrape job"
```

---

### Task 15: Remove Playwright from Dependencies & Docker

**Files:**
- Modify: `backend/pyproject.toml` (remove playwright)
- Modify: `backend/Dockerfile` (remove playwright install)
- Modify: `docker-compose.yml` (remove browser volumes if any)

**Step 1: Edit pyproject.toml**

Remove `"playwright>=1.49"` from the `dependencies` list in `backend/pyproject.toml`.

**Step 2: Edit Dockerfile**

Remove the `RUN playwright install chromium && playwright install-deps` line from `backend/Dockerfile`.

**Step 3: Verify build**

```bash
cd backend && pip install -e ".[dev]"
backend/.venv/bin/python -m pytest backend/tests/ -q
```

**Step 4: Commit**

```bash
git add backend/pyproject.toml backend/Dockerfile docker-compose.yml
git commit -m "refactor: remove Playwright from dependencies and Docker image"
```

---

### Task 16: Update CLAUDE.md and Documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update CLAUDE.md**

Key changes:
- Update "Tech Stack" to mention Chrome extension instead of Playwright
- Remove Playwright commands from "Commands" section
- Add extension install/usage instructions
- Update "Architecture" to describe extension → ingest → pipeline flow
- Update "Backend Structure" to reflect removed/added files
- Update "Pipeline Flow" diagram
- Remove twitter-login.py and upload-session.sh references
- Add extension directory to project structure

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for Chrome extension architecture"
```

---

## Dependency Order

```
Phase 1 (Backend):  Task 1 → Task 2 → Task 3 → Task 4
Phase 2 (Extension): Task 5 → Task 6 → Task 7 → Task 8
Phase 3 (Dashboard): Task 9 → Tasks 10,11,12 (parallel)
Phase 4 (Cleanup):   Task 13 → Task 14 → Task 15 → Task 16
```

Phase 1 and Phase 2 can run in parallel (backend and extension are independent until integration testing).
Phase 3 depends on Phase 1 (dashboard needs the ingest API).
Phase 4 depends on Phase 2 (don't remove Playwright until extension is working).

---

## Integration Testing Checklist

After all tasks complete, verify end-to-end:

1. Start backend: `docker compose up`
2. Load extension in Chrome: `chrome://extensions/` → Load unpacked → `extension/`
3. Configure extension popup: set backend URL to `http://localhost:8000`
4. Browse `https://x.com/home`
5. Hover over a tweet → amber save button appears
6. Click save → toast shows "Saved"
7. Open dashboard → unclustered queue shows the tweet
8. Click "Re-cluster Now" → tweet moves into a topic
9. Navigate to topic detail → see tweet card with screenshot
10. Verify extension badge shows save count
11. Run full test suite: `backend/.venv/bin/python -m pytest backend/tests/ -q`
12. TypeScript check: `cd frontend && npx tsc --noEmit`
