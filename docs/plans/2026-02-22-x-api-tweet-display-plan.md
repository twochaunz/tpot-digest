# X API Tweet Display Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace screenshot-based tweet display with native tweet cards rendered from X API v2 data fetched at save time.

**Architecture:** Extension sends minimal payload (tweet_id + page context) to backend. Backend calls X API v2 to fetch full tweet data (author, text, media, engagement), stores it, and serves it to the frontend. Frontend renders native tweet cards with engagement toggle and download-as-PNG.

**Tech Stack:** Python/FastAPI + httpx (X API client), React/TypeScript + html-to-image (card screenshot), Alembic (migration)

---

### Task 1: Database Migration - Add New Columns

**Files:**
- Create: `backend/alembic/versions/005_add_x_api_fields.py`
- Modify: `backend/app/models/tweet.py`

**Step 1: Write the Alembic migration**

Create `backend/alembic/versions/005_add_x_api_fields.py`:

```python
"""add X API fields to tweets

Revision ID: 005_x_api_fields
Revises: 004_add_waitlist
Create Date: 2026-02-22
"""
from alembic import op
import sqlalchemy as sa

revision = "005_x_api_fields"
down_revision = "004_add_waitlist"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tweets", sa.Column("author_avatar_url", sa.String(1024)))
    op.add_column("tweets", sa.Column("author_verified", sa.Boolean(), server_default="false"))
    op.add_column("tweets", sa.Column("created_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("tweets", "created_at")
    op.drop_column("tweets", "author_verified")
    op.drop_column("tweets", "author_avatar_url")
```

**Step 2: Update the Tweet model**

In `backend/app/models/tweet.py`, add three new fields after `author_display_name` (line 16):

```python
author_avatar_url: Mapped[str | None] = mapped_column(String(1024))
author_verified: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
```

And add `created_at` after `url` (line 29):

```python
created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
```

**Step 3: Run migration locally to verify**

Run: `cd backend && alembic upgrade head`
Expected: Migration applies cleanly (or skip if no local DB)

**Step 4: Commit**

```bash
git add backend/alembic/versions/005_add_x_api_fields.py backend/app/models/tweet.py
git commit -m "feat: add X API fields (avatar, verified, created_at) to tweet model"
```

---

### Task 2: Add X API Bearer Token to Config

**Files:**
- Modify: `backend/app/config.py`

**Step 1: Add the config field**

In `backend/app/config.py`, add to the `Settings` class (after line 6):

```python
x_api_bearer_token: str = ""
```

**Step 2: Update docker-compose.prod.yml**

In `docker-compose.prod.yml`, add to the backend service's environment (after the AUTH_PASS line):

```yaml
      X_API_BEARER_TOKEN: ${X_API_BEARER_TOKEN}
```

**Step 3: Commit**

```bash
git add backend/app/config.py docker-compose.prod.yml
git commit -m "feat: add X_API_BEARER_TOKEN config"
```

---

### Task 3: X API Service - Write Tests

**Files:**
- Create: `backend/tests/test_x_api_service.py`

**Step 1: Write the test file**

Create `backend/tests/test_x_api_service.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch
from httpx import Response, Request

from app.services.x_api import fetch_tweet, XAPIError


def _make_response(status_code: int, json_data: dict) -> Response:
    """Create a mock httpx Response."""
    return Response(
        status_code=status_code,
        json=json_data,
        request=Request("GET", "https://api.x.com/2/tweets/123"),
    )


SAMPLE_API_RESPONSE = {
    "data": {
        "id": "123456",
        "text": "Claude 4 is amazing",
        "created_at": "2026-02-20T15:30:00.000Z",
        "public_metrics": {
            "like_count": 5000,
            "retweet_count": 1200,
            "reply_count": 300,
            "quote_count": 50,
        },
        "entities": {
            "urls": [{"expanded_url": "https://example.com"}],
        },
        "author_id": "999",
        "attachments": {
            "media_keys": ["media_1"],
        },
        "referenced_tweets": [
            {"type": "quoted", "id": "111"},
        ],
    },
    "includes": {
        "users": [
            {
                "id": "999",
                "name": "Andrej Karpathy",
                "username": "karpathy",
                "profile_image_url": "https://pbs.twimg.com/profile/karpathy_normal.jpg",
                "verified": True,
            }
        ],
        "media": [
            {
                "media_key": "media_1",
                "type": "photo",
                "url": "https://pbs.twimg.com/media/photo1.jpg",
                "width": 1200,
                "height": 800,
            }
        ],
    },
}


@pytest.mark.asyncio
@patch("app.services.x_api.settings")
async def test_fetch_tweet_success(mock_settings):
    mock_settings.x_api_bearer_token = "test_token"

    with patch("app.services.x_api.httpx.AsyncClient") as MockClient:
        mock_client = AsyncMock()
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_client.get.return_value = _make_response(200, SAMPLE_API_RESPONSE)

        result = await fetch_tweet("123456")

    assert result["author_handle"] == "karpathy"
    assert result["author_display_name"] == "Andrej Karpathy"
    assert result["author_avatar_url"] == "https://pbs.twimg.com/profile/karpathy_normal.jpg"
    assert result["author_verified"] is True
    assert result["text"] == "Claude 4 is amazing"
    assert result["engagement"]["likes"] == 5000
    assert result["engagement"]["retweets"] == 1200
    assert result["engagement"]["replies"] == 300
    assert result["is_quote_tweet"] is True
    assert result["url"] == "https://x.com/karpathy/status/123456"
    assert len(result["media_urls"]) == 1
    assert result["media_urls"][0]["type"] == "photo"
    assert result["created_at"] == "2026-02-20T15:30:00.000Z"


@pytest.mark.asyncio
@patch("app.services.x_api.settings")
async def test_fetch_tweet_not_found(mock_settings):
    mock_settings.x_api_bearer_token = "test_token"

    error_response = {
        "errors": [{"detail": "Could not find tweet", "type": "https://api.twitter.com/2/problems/resource-not-found"}]
    }

    with patch("app.services.x_api.httpx.AsyncClient") as MockClient:
        mock_client = AsyncMock()
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_client.get.return_value = _make_response(200, error_response)

        with pytest.raises(XAPIError, match="not found"):
            await fetch_tweet("999999")


@pytest.mark.asyncio
@patch("app.services.x_api.settings")
async def test_fetch_tweet_rate_limited(mock_settings):
    mock_settings.x_api_bearer_token = "test_token"

    with patch("app.services.x_api.httpx.AsyncClient") as MockClient:
        mock_client = AsyncMock()
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_client.get.return_value = _make_response(429, {"title": "Too Many Requests"})

        with pytest.raises(XAPIError, match="rate limit"):
            await fetch_tweet("123456")


@pytest.mark.asyncio
@patch("app.services.x_api.settings")
async def test_fetch_tweet_no_token(mock_settings):
    mock_settings.x_api_bearer_token = ""

    with pytest.raises(XAPIError, match="not configured"):
        await fetch_tweet("123456")


@pytest.mark.asyncio
@patch("app.services.x_api.settings")
async def test_fetch_tweet_minimal_response(mock_settings):
    """Tweet with no media, no referenced tweets, unverified author."""
    mock_settings.x_api_bearer_token = "test_token"

    minimal_response = {
        "data": {
            "id": "789",
            "text": "Hello world",
            "created_at": "2026-02-21T10:00:00.000Z",
            "public_metrics": {
                "like_count": 3,
                "retweet_count": 0,
                "reply_count": 1,
                "quote_count": 0,
            },
            "author_id": "555",
        },
        "includes": {
            "users": [
                {
                    "id": "555",
                    "name": "Test User",
                    "username": "testuser",
                    "profile_image_url": "https://pbs.twimg.com/profile/test_normal.jpg",
                }
            ],
        },
    }

    with patch("app.services.x_api.httpx.AsyncClient") as MockClient:
        mock_client = AsyncMock()
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_client.get.return_value = _make_response(200, minimal_response)

        result = await fetch_tweet("789")

    assert result["author_handle"] == "testuser"
    assert result["author_verified"] is False
    assert result["is_quote_tweet"] is False
    assert result["is_reply"] is False
    assert result["media_urls"] is None
```

**Step 2: Run tests to verify they fail**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_x_api_service.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.x_api'`

**Step 3: Commit**

```bash
git add backend/tests/test_x_api_service.py
git commit -m "test: add X API service tests"
```

---

### Task 4: X API Service - Implementation

**Files:**
- Create: `backend/app/services/__init__.py`
- Create: `backend/app/services/x_api.py`

**Step 1: Create the services package**

Create `backend/app/services/__init__.py` (empty file).

**Step 2: Implement the X API service**

Create `backend/app/services/x_api.py`:

```python
import httpx

from app.config import settings


class XAPIError(Exception):
    """Raised when X API call fails."""
    pass


async def fetch_tweet(tweet_id: str) -> dict:
    """Fetch tweet data from X API v2 and return normalized dict."""
    if not settings.x_api_bearer_token:
        raise XAPIError("X API bearer token not configured")

    params = {
        "tweet.fields": "text,created_at,public_metrics,entities,referenced_tweets",
        "expansions": "author_id,attachments.media_keys",
        "user.fields": "profile_image_url,verified,name,username",
        "media.fields": "url,preview_image_url,type,width,height",
    }
    headers = {"Authorization": f"Bearer {settings.x_api_bearer_token}"}

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"https://api.x.com/2/tweets/{tweet_id}",
            params=params,
            headers=headers,
            timeout=10.0,
        )

    if resp.status_code == 429:
        raise XAPIError("X API rate limit exceeded")
    if resp.status_code == 401:
        raise XAPIError("X API authentication failed")
    if resp.status_code not in (200, 201):
        raise XAPIError(f"X API error: HTTP {resp.status_code}")

    body = resp.json()

    # Check for errors in response (e.g. tweet deleted, not found)
    if "data" not in body:
        errors = body.get("errors", [])
        detail = errors[0].get("detail", "Unknown error") if errors else "Tweet not found"
        raise XAPIError(f"Tweet not found: {detail}")

    data = body["data"]
    includes = body.get("includes", {})

    # Extract author from includes
    users = includes.get("users", [])
    author = users[0] if users else {}

    # Extract media from includes
    media_list = includes.get("media", [])
    media_urls = None
    if media_list:
        media_urls = [
            {
                "type": m.get("type", "photo"),
                "url": m.get("url") or m.get("preview_image_url", ""),
                "width": m.get("width"),
                "height": m.get("height"),
            }
            for m in media_list
        ]

    # Detect quote tweet / reply from referenced_tweets
    referenced = data.get("referenced_tweets", [])
    is_quote_tweet = any(r.get("type") == "quoted" for r in referenced)
    is_reply = any(r.get("type") == "replied_to" for r in referenced)
    quoted_tweet_id = next(
        (r["id"] for r in referenced if r.get("type") == "quoted"), None
    )
    reply_to_tweet_id = next(
        (r["id"] for r in referenced if r.get("type") == "replied_to"), None
    )

    # Build public metrics
    metrics = data.get("public_metrics", {})

    username = author.get("username", "")

    return {
        "author_handle": username,
        "author_display_name": author.get("name", ""),
        "author_avatar_url": author.get("profile_image_url", ""),
        "author_verified": author.get("verified", False),
        "text": data.get("text", ""),
        "url": f"https://x.com/{username}/status/{tweet_id}" if username else None,
        "media_urls": media_urls,
        "engagement": {
            "likes": metrics.get("like_count", 0),
            "retweets": metrics.get("retweet_count", 0),
            "replies": metrics.get("reply_count", 0),
        },
        "is_quote_tweet": is_quote_tweet,
        "is_reply": is_reply,
        "quoted_tweet_id": quoted_tweet_id,
        "reply_to_tweet_id": reply_to_tweet_id,
        "created_at": data.get("created_at"),
    }
```

**Step 3: Run tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_x_api_service.py -v`
Expected: All 5 tests PASS

**Step 4: Commit**

```bash
git add backend/app/services/__init__.py backend/app/services/x_api.py
git commit -m "feat: implement X API v2 tweet fetch service"
```

---

### Task 5: Update Schemas for X API Flow

**Files:**
- Modify: `backend/app/schemas/tweet.py`

**Step 1: Update TweetSave schema**

Replace the `TweetSave` class in `backend/app/schemas/tweet.py` (lines 6-27) with:

```python
class TweetSave(BaseModel):
    tweet_id: str
    # Extension-only context fields
    feed_source: str | None = None
    thread_id: str | None = None
    thread_position: int | None = None
    topic_id: int | None = None
    category_id: int | None = None
    saved_at: datetime | None = None
```

**Step 2: Update TweetOut schema**

Add new fields to `TweetOut` in `backend/app/schemas/tweet.py`. After `author_display_name` (line 34), add:

```python
    author_avatar_url: str | None
    author_verified: bool
```

After `url` (line 47), add:

```python
    created_at: datetime | None
```

**Step 3: Run existing tests to check what breaks**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_tweets_api.py -v`
Expected: Tests will fail because they still send the old payload format. This is expected — we fix them in Task 7.

**Step 4: Commit**

```bash
git add backend/app/schemas/tweet.py
git commit -m "feat: simplify TweetSave schema for X API flow"
```

---

### Task 6: Update Save Endpoint to Use X API

**Files:**
- Modify: `backend/app/routers/tweets.py`

**Step 1: Rewrite the save_tweet endpoint**

Replace the `save_tweet` function in `backend/app/routers/tweets.py` (lines 28-79) with:

```python
@router.post("", status_code=201)
async def save_tweet(body: TweetSave, db: AsyncSession = Depends(get_db)):
    # Check duplicate
    existing = (await db.execute(
        select(Tweet).where(Tweet.tweet_id == body.tweet_id)
    )).scalar_one_or_none()
    if existing:
        out = TweetOut.model_validate(existing)
        out.status = "duplicate"
        return JSONResponse(content=out.model_dump(mode="json"), status_code=200)

    # Fetch tweet data from X API
    from app.services.x_api import fetch_tweet, XAPIError
    try:
        api_data = await fetch_tweet(body.tweet_id)
    except XAPIError as e:
        raise HTTPException(status_code=502, detail=str(e))

    kwargs = dict(
        tweet_id=body.tweet_id,
        author_handle=api_data["author_handle"],
        author_display_name=api_data["author_display_name"],
        author_avatar_url=api_data["author_avatar_url"],
        author_verified=api_data["author_verified"],
        text=api_data["text"],
        media_urls=api_data["media_urls"],
        engagement=api_data["engagement"],
        is_quote_tweet=api_data["is_quote_tweet"],
        is_reply=api_data["is_reply"],
        quoted_tweet_id=api_data["quoted_tweet_id"],
        reply_to_tweet_id=api_data.get("reply_to_tweet_id"),
        url=api_data["url"],
        created_at=api_data["created_at"],
        # Extension context fields
        feed_source=body.feed_source,
        thread_id=body.thread_id,
        thread_position=body.thread_position,
    )
    if body.saved_at:
        kwargs["saved_at"] = body.saved_at
    tweet = Tweet(**kwargs)
    db.add(tweet)
    await db.flush()

    if body.topic_id:
        assignment = TweetAssignment(
            tweet_id=tweet.id, topic_id=body.topic_id, category_id=body.category_id
        )
        db.add(assignment)

    await db.commit()
    await db.refresh(tweet)
    return JSONResponse(
        content=TweetOut.model_validate(tweet).model_dump(mode="json"),
        status_code=201,
    )
```

**Step 2: Remove the `_save_screenshot` helper function** (lines 19-25) and the `base64` import (line 1). Keep `Path` import if used elsewhere, otherwise remove it too.

Clean up imports at top of file — remove `base64` and `Path`:

```python
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.models.assignment import TweetAssignment
from app.models.tweet import Tweet
from app.schemas.tweet import TweetAssignRequest, TweetCheckRequest, TweetOut, TweetSave, TweetUnassignRequest, TweetUpdate
```

Note: `settings` import can be removed too since we no longer reference `settings.data_dir` in this file. But keep it if the screenshot static mount is in `main.py` (it is — the mount is in main.py, not here). So remove the `settings` import.

Updated imports:

```python
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.assignment import TweetAssignment
from app.models.tweet import Tweet
from app.schemas.tweet import TweetAssignRequest, TweetCheckRequest, TweetOut, TweetSave, TweetUnassignRequest, TweetUpdate
```

**Step 3: Commit**

```bash
git add backend/app/routers/tweets.py
git commit -m "feat: use X API to populate tweet data on save"
```

---

### Task 7: Fix Backend Tests for New Flow

**Files:**
- Modify: `backend/tests/test_tweets_api.py`

**Step 1: Update test fixtures to mock X API**

The tests need to mock `fetch_tweet` since the save endpoint now calls it. Add a mock fixture and update all test payloads.

Replace the entire file with:

```python
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, patch
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles

from app.db import Base, get_db
from app.main import app

# Import all models so Base.metadata knows about them
from app.models import Tweet, Topic, Category, TweetAssignment  # noqa: F401


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):
    return compiler.visit_JSON(type_, **kw)


TEST_DB_URL = "sqlite+aiosqlite:///:memory:"
engine = create_async_engine(TEST_DB_URL, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)


async def override_get_db():
    async with async_session() as session:
        yield session


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    app.dependency_overrides[get_db] = override_get_db
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


MOCK_X_API_RESULT = {
    "author_handle": "karpathy",
    "author_display_name": "Andrej Karpathy",
    "author_avatar_url": "https://pbs.twimg.com/profile/karpathy_normal.jpg",
    "author_verified": True,
    "text": "Claude 4 is amazing",
    "url": "https://x.com/karpathy/status/123456",
    "media_urls": None,
    "engagement": {"likes": 5000, "retweets": 1200, "replies": 300},
    "is_quote_tweet": False,
    "is_reply": False,
    "quoted_tweet_id": None,
    "reply_to_tweet_id": None,
    "created_at": "2026-02-20T15:30:00.000Z",
}


def _mock_x_api(tweet_id: str = "123456", **overrides):
    """Return a mock fetch_tweet result, optionally with custom tweet_id."""
    result = {**MOCK_X_API_RESULT, **overrides}
    result["url"] = f"https://x.com/{result['author_handle']}/status/{tweet_id}"
    return result


@pytest.fixture(autouse=True)
def mock_fetch_tweet():
    """Mock the X API service for all tests."""
    with patch("app.routers.tweets.fetch_tweet") as mock:
        async def side_effect(tweet_id):
            return _mock_x_api(tweet_id)
        mock.side_effect = side_effect
        yield mock


@pytest.mark.asyncio
async def test_save_tweet(client: AsyncClient):
    payload = {
        "tweet_id": "123456",
        "feed_source": "for_you",
    }
    resp = await client.post("/api/tweets", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["tweet_id"] == "123456"
    assert data["author_handle"] == "karpathy"
    assert data["author_avatar_url"] == "https://pbs.twimg.com/profile/karpathy_normal.jpg"
    assert data["author_verified"] is True
    assert data["text"] == "Claude 4 is amazing"


@pytest.mark.asyncio
async def test_save_duplicate_returns_200(client: AsyncClient):
    payload = {"tweet_id": "123456"}
    resp1 = await client.post("/api/tweets", json=payload)
    assert resp1.status_code == 201

    resp2 = await client.post("/api/tweets", json=payload)
    assert resp2.status_code == 200
    assert resp2.json()["status"] == "duplicate"


@pytest.mark.asyncio
async def test_list_tweets(client: AsyncClient):
    for i in range(3):
        await client.post("/api/tweets", json={"tweet_id": str(i)})
    resp = await client.get("/api/tweets")
    assert resp.status_code == 200
    assert len(resp.json()) == 3


@pytest.mark.asyncio
async def test_delete_tweet(client: AsyncClient):
    await client.post("/api/tweets", json={"tweet_id": "del1"})
    tweets = (await client.get("/api/tweets")).json()
    tweet_id = tweets[0]["id"]

    resp = await client.delete(f"/api/tweets/{tweet_id}")
    assert resp.status_code == 204

    tweets_after = (await client.get("/api/tweets")).json()
    assert len(tweets_after) == 0


@pytest.mark.asyncio
async def test_list_unassigned_tweets(client: AsyncClient):
    for i in range(2):
        await client.post("/api/tweets", json={"tweet_id": f"unassigned_{i}"})
    resp = await client.get("/api/tweets", params={"unassigned": True})
    assert resp.status_code == 200
    assert len(resp.json()) == 2


@pytest.mark.asyncio
async def test_search_tweets(client: AsyncClient):
    await client.post("/api/tweets", json={"tweet_id": "s1"})
    await client.post("/api/tweets", json={"tweet_id": "s2"})
    resp = await client.get("/api/tweets", params={"q": "Claude"})
    assert resp.status_code == 200
    # Both tweets have "Claude 4 is amazing" from mock
    assert len(resp.json()) == 2


@pytest.mark.asyncio
async def test_patch_tweet_memo(client: AsyncClient):
    await client.post("/api/tweets", json={"tweet_id": "patch1"})
    tweets = (await client.get("/api/tweets")).json()
    tid = tweets[0]["id"]

    resp = await client.patch(f"/api/tweets/{tid}", json={"memo": "use as opener"})
    assert resp.status_code == 200
    assert resp.json()["memo"] == "use as opener"


@pytest.mark.asyncio
async def test_patch_tweet_saved_at(client: AsyncClient):
    await client.post("/api/tweets", json={"tweet_id": "patch2"})
    tweets = (await client.get("/api/tweets")).json()
    tid = tweets[0]["id"]

    resp = await client.patch(f"/api/tweets/{tid}", json={"saved_at": "2026-02-18T12:00:00Z"})
    assert resp.status_code == 200
    assert "2026-02-18" in resp.json()["saved_at"]


@pytest.mark.asyncio
async def test_check_saved_tweets(client: AsyncClient):
    for i in range(3):
        await client.post("/api/tweets", json={"tweet_id": f"check_{i}"})
    resp = await client.post("/api/tweets/check", json={
        "tweet_ids": ["check_0", "check_2", "not_saved"],
    })
    assert resp.status_code == 200
    saved = resp.json()["saved"]
    assert "check_0" in saved
    assert "check_2" in saved
    assert "not_saved" not in saved


@pytest.mark.asyncio
async def test_list_thread_tweets(client: AsyncClient):
    for i in range(3):
        await client.post("/api/tweets", json={
            "tweet_id": f"thread_{i}",
            "thread_id": "thread_0",
            "thread_position": i,
        })
    resp = await client.get("/api/tweets", params={"thread_id": "thread_0"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 3
    assert data[0]["thread_position"] == 0
    assert data[2]["thread_position"] == 2


@pytest.mark.asyncio
async def test_save_tweet_x_api_error(client: AsyncClient, mock_fetch_tweet):
    """When X API fails, save endpoint returns 502."""
    from app.services.x_api import XAPIError
    mock_fetch_tweet.side_effect = XAPIError("rate limit exceeded")

    resp = await client.post("/api/tweets", json={"tweet_id": "fail1"})
    assert resp.status_code == 502
    assert "rate limit" in resp.json()["detail"]
```

**Step 2: Run tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_tweets_api.py -v`
Expected: All tests PASS

**Step 3: Run all backend tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -q`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add backend/tests/test_tweets_api.py
git commit -m "test: update tweet API tests for X API flow"
```

---

### Task 8: Update Frontend Tweet Type

**Files:**
- Modify: `frontend/src/api/tweets.ts`

**Step 1: Update the Tweet interface**

In `frontend/src/api/tweets.ts`, replace the `Tweet` interface (lines 4-20) with:

```typescript
export interface Tweet {
  id: number
  tweet_id: string
  author_handle: string
  author_display_name: string | null
  author_avatar_url: string | null
  author_verified: boolean
  text: string
  media_urls: { type: string; url: string; width?: number; height?: number }[] | null
  engagement: { likes: number; retweets: number; replies: number } | null
  is_quote_tweet: boolean
  is_reply: boolean
  thread_id: string | null
  thread_position: number | null
  screenshot_path: string | null
  feed_source: string | null
  url: string | null
  created_at: string | null
  saved_at: string
}
```

**Step 2: TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: Some errors in TweetCard.tsx and TweetDetailModal.tsx due to new fields — that's expected, we fix them in Task 9-10.

**Step 3: Commit**

```bash
git add frontend/src/api/tweets.ts
git commit -m "feat: update Tweet type with X API fields"
```

---

### Task 9: Install html-to-image and Create Engagement Toggle Hook

**Files:**
- Create: `frontend/src/hooks/useEngagementToggle.ts`

**Step 1: Install html-to-image**

Run: `cd frontend && npm install html-to-image`

**Step 2: Create the engagement toggle hook**

Create `frontend/src/hooks/useEngagementToggle.ts`:

```typescript
import { useState, useCallback } from 'react'

const STORAGE_KEY = 'tpot-show-engagement'

function getInitial(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === null ? true : stored === 'true'
  } catch {
    return true
  }
}

export function useEngagementToggle() {
  const [showEngagement, setShowEngagement] = useState(getInitial)

  const toggle = useCallback(() => {
    setShowEngagement((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }, [])

  return { showEngagement, toggle }
}
```

**Step 3: Commit**

```bash
git add frontend/src/hooks/useEngagementToggle.ts frontend/package.json frontend/package-lock.json
git commit -m "feat: add engagement toggle hook and html-to-image dep"
```

---

### Task 10: Redesign TweetCard Component

**Files:**
- Modify: `frontend/src/components/TweetCard.tsx`

**Step 1: Rewrite TweetCard.tsx**

Replace the entire file content with a native tweet card that renders author avatar, display name, handle, verified badge, tweet text, media thumbnails, and toggleable engagement stats. Falls back to screenshot for old tweets without `author_avatar_url`.

```typescript
import { useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import type { Tweet } from '../api/tweets'

interface TweetCardProps {
  tweet: Tweet
  selected: boolean
  onToggle: (id: number) => void
  selectable?: boolean
  onTweetClick?: (tweet: Tweet) => void
  showEngagement?: boolean
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max).trimEnd() + '...'
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function screenshotUrl(path: string | null): string | null {
  if (!path) return null
  return `/api/screenshots/${path}`
}

export function TweetCard({ tweet, selected, onToggle, selectable = true, onTweetClick, showEngagement = true }: TweetCardProps) {
  const [hovered, setHovered] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  const isLegacy = !tweet.author_avatar_url && tweet.screenshot_path
  const ssUrl = screenshotUrl(tweet.screenshot_path)

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!cardRef.current) return
    try {
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 2 })
      const link = document.createElement('a')
      link.download = `tweet-${tweet.tweet_id}.png`
      link.href = dataUrl
      link.click()
    } catch (err) {
      console.error('Failed to capture tweet card:', err)
    }
  }

  return (
    <div
      ref={cardRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 280,
        background: hovered ? 'var(--bg-hover)' : 'var(--bg-raised)',
        border: selected
          ? '1.5px solid var(--accent)'
          : `1px solid ${hovered ? 'var(--border-strong)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        cursor: selectable ? 'pointer' : 'default',
        transition: 'all 0.15s ease',
        flexShrink: 0,
        position: 'relative',
      }}
      onClick={() => {
        if (onTweetClick) {
          onTweetClick(tweet)
        } else if (selectable) {
          onToggle(tweet.id)
        }
      }}
    >
      {/* Legacy screenshot fallback */}
      {isLegacy && ssUrl ? (
        <>
          <div style={{ width: '100%', height: 120, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
            <img
              src={ssUrl}
              alt={`Tweet by ${tweet.author_handle}`}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </div>
          <div style={{ padding: '8px 10px' }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
              @{tweet.author_handle}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.4, marginTop: 2 }}>
              {truncate(tweet.text, 80)}
            </div>
          </div>
        </>
      ) : (
        /* Native tweet card */
        <div style={{ padding: '12px 14px' }}>
          {/* Author row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            {tweet.author_avatar_url ? (
              <img
                src={tweet.author_avatar_url}
                alt={tweet.author_handle}
                style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }}
              />
            ) : (
              <div style={{
                width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-elevated)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, color: 'var(--text-tertiary)', flexShrink: 0,
              }}>
                @
              </div>
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{
                  fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {tweet.author_display_name || `@${tweet.author_handle}`}
                </span>
                {tweet.author_verified && (
                  <span style={{ color: 'var(--accent)', fontSize: 12, flexShrink: 0 }} title="Verified">
                    &#10003;
                  </span>
                )}
              </div>
              <div style={{
                fontSize: 11, color: 'var(--text-tertiary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                @{tweet.author_handle}
              </div>
            </div>
            {tweet.url && (
              <a
                href={tweet.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{ color: 'var(--text-tertiary)', fontSize: 11, lineHeight: 1, flexShrink: 0, textDecoration: 'none' }}
                title="Open on X"
              >
                &#8599;
              </a>
            )}
          </div>

          {/* Tweet text */}
          <div style={{
            fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5,
            display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            wordBreak: 'break-word',
          }}>
            {tweet.text}
          </div>

          {/* Media thumbnails */}
          {tweet.media_urls && tweet.media_urls.length > 0 && (
            <div style={{
              marginTop: 8, display: 'grid',
              gridTemplateColumns: tweet.media_urls.length === 1 ? '1fr' : '1fr 1fr',
              gap: 4, borderRadius: 'var(--radius-sm)', overflow: 'hidden',
            }}>
              {tweet.media_urls.slice(0, 4).map((media, i) => (
                <img
                  key={i}
                  src={media.url}
                  alt=""
                  style={{
                    width: '100%', height: tweet.media_urls!.length === 1 ? 140 : 70,
                    objectFit: 'cover', display: 'block',
                    borderRadius: 'var(--radius-sm)',
                  }}
                />
              ))}
            </div>
          )}

          {/* Engagement stats */}
          {showEngagement && tweet.engagement && (
            <div style={{
              display: 'flex', gap: 14, marginTop: 8, paddingTop: 8,
              borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-tertiary)',
            }}>
              <span>{formatCount(tweet.engagement.likes)} likes</span>
              <span>{formatCount(tweet.engagement.retweets)} RT</span>
              <span>{formatCount(tweet.engagement.replies)} replies</span>
            </div>
          )}
        </div>
      )}

      {/* Checkbox overlay */}
      {selectable && (
        <div
          onClick={(e) => { e.stopPropagation(); onToggle(tweet.id) }}
          style={{
            position: 'absolute', top: 6, left: 6, width: 18, height: 18,
            borderRadius: 'var(--radius-sm)',
            border: selected ? 'none' : '1.5px solid rgba(255,255,255,0.4)',
            background: selected ? 'var(--accent)' : 'rgba(0,0,0,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, color: '#fff', cursor: 'pointer', transition: 'all 0.15s ease',
          }}
        >
          {selected && '\u2713'}
        </div>
      )}

      {/* Download button on hover */}
      {hovered && (
        <button
          onClick={handleDownload}
          style={{
            position: 'absolute', top: 6, right: 6,
            width: 24, height: 24, borderRadius: 'var(--radius-sm)',
            background: 'rgba(0,0,0,0.5)', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: '#fff', fontSize: 12,
          }}
          title="Download as PNG"
        >
          &#8681;
        </button>
      )}
    </div>
  )
}
```

**Step 2: TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: May have errors in components that use TweetCard with the old props — fix in Task 12.

**Step 3: Commit**

```bash
git add frontend/src/components/TweetCard.tsx
git commit -m "feat: redesign TweetCard with native tweet display"
```

---

### Task 11: Update TweetDetailModal

**Files:**
- Modify: `frontend/src/components/TweetDetailModal.tsx`

**Step 1: Update TweetDetailModal**

Update the modal to show native tweet card for new tweets (with avatar, verified badge) and keep screenshot+crop for legacy tweets. Add engagement toggle support and download button.

Add `showEngagement` to the props interface (line 6-9):

```typescript
interface TweetDetailModalProps {
  tweet: Tweet
  onClose: () => void
  showEngagement?: boolean
}
```

Update the component signature (line 93):

```typescript
export function TweetDetailModal({ tweet, onClose, showEngagement = true }: TweetDetailModalProps) {
```

Add `toPng` import and a ref for download at the top of the file:

```typescript
import { useEffect, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import type { Tweet } from '../api/tweets'
import { useTweets } from '../api/tweets'
import { CropTool } from './CropTool'
```

Add download ref and handler inside the component (after line 96):

```typescript
  const contentRef = useRef<HTMLDivElement>(null)

  const handleDownload = async () => {
    if (!contentRef.current) return
    try {
      const dataUrl = await toPng(contentRef.current, { pixelRatio: 2 })
      const link = document.createElement('a')
      link.download = `tweet-${tweet.tweet_id}.png`
      link.href = dataUrl
      link.click()
    } catch (err) {
      console.error('Failed to capture:', err)
    }
  }
```

Update the author info section (lines 187-207) to include avatar and verified badge:

```typescript
          {/* Author info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            {tweet.author_avatar_url ? (
              <img
                src={tweet.author_avatar_url}
                alt={tweet.author_handle}
                style={{ width: 48, height: 48, borderRadius: '50%', flexShrink: 0 }}
              />
            ) : (
              <div style={{
                width: 48, height: 48, borderRadius: '50%', background: 'var(--bg-elevated)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20, color: 'var(--text-tertiary)', flexShrink: 0,
              }}>
                @
              </div>
            )}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {tweet.author_display_name || `@${tweet.author_handle}`}
                </span>
                {tweet.author_verified && (
                  <span style={{ color: 'var(--accent)', fontSize: 14 }} title="Verified">&#10003;</span>
                )}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 2 }}>
                @{tweet.author_handle}
              </div>
            </div>
          </div>
```

Wrap the engagement section with `showEngagement` check (around lines 223-239):

```typescript
          {/* Engagement stats */}
          {showEngagement && engagement && (
```

Add a download button next to the close button area. After the close button (line 183), add:

```typescript
        {/* Download button */}
        <button
          onClick={handleDownload}
          style={{
            position: 'sticky', top: 0, float: 'right', zIndex: 10,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)', width: 32, height: 32,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 14,
            margin: '12px 8px 0 0', transition: 'all 0.15s ease',
          }}
          aria-label="Download as PNG"
          title="Download as PNG"
        >
          &#8681;
        </button>
```

Add `ref={contentRef}` to the content div (the div with padding on line 186).

For the screenshot/crop section (lines 298-355), wrap in a check for legacy tweets:

```typescript
          {/* Screenshot (legacy tweets only) */}
          {!tweet.author_avatar_url && ssUrl && (
            ...existing screenshot/crop code...
          )}
```

Also add media display for new tweets (after tweet text, before engagement):

```typescript
          {/* Media (new tweets) */}
          {tweet.media_urls && tweet.media_urls.length > 0 && (
            <div style={{
              marginBottom: 16, display: 'grid',
              gridTemplateColumns: tweet.media_urls.length === 1 ? '1fr' : '1fr 1fr',
              gap: 4, borderRadius: 'var(--radius-md)', overflow: 'hidden',
            }}>
              {tweet.media_urls.map((media, i) => (
                <img
                  key={i}
                  src={media.url}
                  alt=""
                  style={{
                    width: '100%', maxHeight: 400, objectFit: 'cover', display: 'block',
                    borderRadius: 'var(--radius-md)',
                  }}
                />
              ))}
            </div>
          )}
```

**Step 2: TypeScript check**

Run: `cd frontend && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add frontend/src/components/TweetDetailModal.tsx
git commit -m "feat: update TweetDetailModal with avatar, verified, download"
```

---

### Task 12: Wire Engagement Toggle into DailyView

**Files:**
- Modify: `frontend/src/pages/DailyView.tsx`
- Modify: `frontend/src/components/UnsortedSection.tsx` (pass showEngagement through)
- Modify: `frontend/src/components/TopicSection.tsx` (pass showEngagement through)
- Modify: `frontend/src/components/DragOverlayCard.tsx` (if it uses TweetCard)

**Step 1: Add engagement toggle to DailyView**

In `frontend/src/pages/DailyView.tsx`:

Add import for the hook:
```typescript
import { useEngagementToggle } from '../hooks/useEngagementToggle'
```

Inside the `DailyView` component, add after the state declarations:
```typescript
const { showEngagement, toggle: toggleEngagement } = useEngagementToggle()
```

Add a toggle button in the header (before the Settings button, around line 264):
```typescript
          {/* Engagement toggle */}
          <button
            onClick={toggleEngagement}
            style={{
              background: showEngagement ? 'var(--accent-muted)' : 'none',
              border: `1px solid ${showEngagement ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-md)',
              padding: '5px 10px',
              cursor: 'pointer',
              color: showEngagement ? 'var(--accent-hover)' : 'var(--text-secondary)',
              fontSize: 12,
              fontFamily: 'var(--font-body)',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
            }}
            title={showEngagement ? 'Hide engagement stats' : 'Show engagement stats'}
          >
            {showEngagement ? 'Stats ON' : 'Stats OFF'}
          </button>
```

Pass `showEngagement` to `UnsortedSection`, `TopicSectionWithData`, and `TweetDetailModal`.

For `TweetDetailModal` (around line 450):
```typescript
        <TweetDetailModal
          tweet={detailTweet}
          onClose={() => setDetailTweet(null)}
          showEngagement={showEngagement}
        />
```

**Step 2: Thread `showEngagement` prop through child components**

Update `UnsortedSection` and `TopicSectionWithData` to accept and forward `showEngagement` to their `TweetCard` children. The exact changes depend on how these components pass props to TweetCard. Add `showEngagement?: boolean` to their props interfaces and pass it through to `<TweetCard showEngagement={showEngagement} ... />`.

**Step 3: TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/pages/DailyView.tsx frontend/src/components/UnsortedSection.tsx frontend/src/components/TopicSection.tsx frontend/src/components/DragOverlayCard.tsx
git commit -m "feat: wire engagement toggle into DailyView and child components"
```

---

### Task 13: Simplify Chrome Extension

**Files:**
- Modify: `extension/content.js`
- Modify: `extension/background.js`

**Step 1: Simplify extractTweetData in content.js**

Replace the `extractTweetData` function (lines 37-86) with a minimal version:

```javascript
  function extractTweetData(article) {
    const timeLink = article.querySelector('a[href*="/status/"]');
    const href = timeLink ? timeLink.getAttribute("href") : "";
    const idMatch = href.match(/status\/(\d+)/);
    const tweetId = idMatch ? idMatch[1] : "";

    const handleEl = article.querySelector('div[data-testid="User-Name"] a[href^="/"]');
    const authorHandle = handleEl ? handleEl.getAttribute("href").replace("/", "") : "";

    // Thread detection
    const threadMatch = window.location.pathname.match(/\/status\/(\d+)/);
    const threadId = threadMatch && detectFeedSource() === "thread" ? threadMatch[1] : null;

    return {
      tweet_id: tweetId,
      feed_source: detectFeedSource(),
      thread_id: threadId,
      _author_handle: authorHandle, // only used locally for action card display
    };
  }
```

**Step 2: Simplify handleSave in content.js**

Replace the save handler (lines 548-635) to remove screenshot capture:

```javascript
  async function handleSave(button, article) {
    if (button.classList.contains("saving")) return;

    // If already saved, unsave directly
    if (button.classList.contains("saved") && button.dataset.tpotDbId) {
      const dbId = Number(button.dataset.tpotDbId);
      button.classList.add("saving");
      button.classList.remove("saved");
      try {
        await sendMessage({ type: "DELETE_TWEET", tweetDbId: dbId });
        for (const [tid, id] of savedTweets) {
          if (id === dbId) { savedTweets.delete(tid); break; }
        }
        delete button.dataset.tpotDbId;
        delete button.dataset.tpotChecked;
        button.classList.remove("saving");
      } catch (err) {
        button.classList.remove("saving");
        button.classList.add("saved");
        showToast("Unsave failed: " + err.message, true);
      }
      return;
    }

    button.classList.add("saving");

    try {
      const tweetData = extractTweetData(article);
      if (!tweetData.tweet_id) throw new Error("Could not extract tweet ID");

      // Save tweet via service worker (no screenshot)
      const tweetPayload = {
        tweet_id: tweetData.tweet_id,
        feed_source: tweetData.feed_source,
        thread_id: tweetData.thread_id,
      };
      // Default saved_at to the tweet's posted date if available
      const postedDate = extractPostedDate(article);
      if (postedDate) tweetPayload.saved_at = postedDate + "T12:00:00";

      const saveResp = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: "SAVE_TWEET",
          tweet: tweetPayload,
        }, (resp) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(resp);
        });
      });

      if (saveResp && saveResp.error) throw new Error(saveResp.error);

      button.classList.remove("saving");
      button.classList.add("saved");
      button.dataset.tpotDbId = saveResp.id;
      savedTweets.set(tweetData.tweet_id, saveResp.id);

      if (saveResp && saveResp.status === "duplicate") {
        showToast("Tweet already saved — @" + tweetData._author_handle, false);
      } else {
        showActionCard(saveResp.id, tweetData._author_handle, article);
      }
    } catch (err) {
      button.classList.remove("saving");
      showToast("Save failed: " + err.message, true);
    }
  }
```

**Step 3: Remove screenshot handler from background.js**

In `extension/background.js`:
- Remove the `handleScreenshot` function (lines 35-63)
- Remove the `CAPTURE_SCREENSHOT` case from the message listener (line 239)

**Step 4: Remove `parseCount` function from content.js** (lines 8-15) since it's no longer used.

**Step 5: Commit**

```bash
git add extension/content.js extension/background.js
git commit -m "feat: simplify extension - remove screenshot capture, minimize DOM parsing"
```

---

### Task 14: Update Extension Manifest Permissions

**Files:**
- Modify: `extension/manifest.json`

**Step 1: Check and remove unused permissions**

Read `extension/manifest.json`. The `activeTab` and `tabs` permissions were needed for `captureVisibleTab`. Since we no longer capture screenshots:

- Remove `"activeTab"` from permissions (if present) — actually keep it, the extension still needs to interact with the active tab for content scripts.
- The `tabs` permission can be removed if it was only for screenshot capture. Check if it's used elsewhere first.

**Step 2: Commit**

```bash
git add extension/manifest.json
git commit -m "chore: update extension manifest permissions"
```

---

### Task 15: Final Integration Test

**Step 1: Run all backend tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -q`
Expected: All tests PASS

**Step 2: TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 3: Build frontend**

Run: `cd frontend && npm run build`
Expected: Build succeeds

**Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: fix any remaining integration issues"
```

---

### Task 16: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update documentation**

Update the CLAUDE.md to reflect the new X API integration:

- Add `X_API_BEARER_TOKEN` to the environment variables table
- Update the data flow diagram to show X API
- Update the extension structure to note simplified parsing
- Note the engagement toggle feature
- Update the key design decisions section

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for X API integration"
```
