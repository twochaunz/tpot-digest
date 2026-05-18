# Dynamic Topic Link Previews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build dynamic social previews for topic share links, led by each topic's OG tweet media or a generated text-card fallback.

**Architecture:** Add a focused backend preview router that resolves topic share URLs, emits crawler HTML metadata, and generates a PNG fallback card. Update Caddy so only social crawler user agents hit the backend route; normal browser traffic keeps using the frontend app.

**Tech Stack:** FastAPI, SQLAlchemy async, Pillow, pytest/httpx ASGI tests, Caddy routing.

---

## File Structure

- Create `backend/app/routers/share.py`: topic URL parsing, topic resolution, metadata HTML response, PNG image response.
- Modify `backend/app/main.py`: register the share router.
- Modify `backend/pyproject.toml`: add Pillow for server-side PNG generation.
- Modify `Caddyfile`: add a crawler-only matcher for `/app/YYYYMMDD/N` and `/app/YYYY-MM-DD/N` before the frontend catch-all.
- Create `backend/tests/test_share_previews.py`: backend coverage for media-first metadata, generated image fallback, invalid-topic fallback, and PNG fallback rendering.

### Task 1: Preview Router Tests

**Files:**
- Create: `backend/tests/test_share_previews.py`

- [ ] **Step 1: Write failing tests**

```python
from datetime import date, datetime, timezone

import pytest
from httpx import AsyncClient

from app.models import Tweet, Topic, TweetAssignment
import app.db as db_module


async def _seed_topic_with_og(
    *,
    title: str = "AI Lab Launch",
    tweet_text: str = "Big launch today <watch this>",
    media_urls=None,
):
    async with db_module.async_session() as db:
        tweet = Tweet(
            tweet_id="1234567890",
            author_handle="founder",
            author_display_name="Founder",
            author_avatar_url=None,
            author_verified=False,
            text=tweet_text,
            media_urls=media_urls if media_urls is not None else [],
            engagement={},
            url_entities=[],
            is_quote_tweet=False,
            is_reply=False,
            saved_at=datetime(2026, 5, 17, 18, 0, tzinfo=timezone.utc),
        )
        db.add(tweet)
        await db.flush()
        topic = Topic(
            title=title,
            date=date(2026, 5, 17),
            color="#3b82f6",
            position=0,
            og_tweet_id=tweet.id,
        )
        db.add(topic)
        await db.flush()
        db.add(TweetAssignment(tweet_id=tweet.id, topic_id=topic.id))
        await db.commit()
        return topic.id, tweet.id


@pytest.mark.asyncio
async def test_topic_preview_uses_og_tweet_media_image(client: AsyncClient):
    await _seed_topic_with_og(media_urls=["https://pbs.twimg.com/media/example.jpg"])

    resp = await client.get("/app/20260517/1")

    assert resp.status_code == 200
    html = resp.text
    assert 'property="og:title" content="AI Lab Launch"' in html
    assert 'property="og:image" content="https://pbs.twimg.com/media/example.jpg"' in html
    assert 'name="twitter:card" content="summary_large_image"' in html
    assert "Big launch today &lt;watch this&gt;" in html


@pytest.mark.asyncio
async def test_topic_preview_uses_generated_image_for_text_only_og(client: AsyncClient):
    await _seed_topic_with_og(media_urls=[])

    resp = await client.get("/app/20260517/1")

    assert resp.status_code == 200
    assert 'property="og:image" content="https://abridged.tech/api/og/topic/20260517/1.png"' in resp.text


@pytest.mark.asyncio
async def test_topic_preview_falls_back_for_missing_topic(client: AsyncClient):
    resp = await client.get("/app/20260517/99")

    assert resp.status_code == 200
    assert 'property="og:title" content="abridged tech"' in resp.text
    assert 'property="og:image" content="https://abridged.tech/og-image.png"' in resp.text


@pytest.mark.asyncio
async def test_generated_topic_image_returns_png(client: AsyncClient):
    await _seed_topic_with_og(tweet_text='Text with <script>alert("x")</script>', media_urls=[])

    resp = await client.get("/api/og/topic/20260517/1.png")

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("image/png")
    assert resp.content.startswith(b"\x89PNG\r\n\x1a\n")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_share_previews.py -q`

Expected: FAIL with routes returning 404 because the preview router does not exist.

### Task 2: Preview Router Implementation

**Files:**
- Create: `backend/app/routers/share.py`
- Modify: `backend/app/main.py`
- Modify: `backend/pyproject.toml`

- [ ] **Step 1: Implement minimal router**

Add `backend/app/routers/share.py` with helpers for date parsing, topic ordering, first media image selection, HTML escaping, and PNG rendering. Register it in `backend/app/main.py` with `app.include_router(share_router)`.

- [ ] **Step 2: Run focused tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_share_previews.py -q`

Expected: PASS.

### Task 3: Crawler-Only Caddy Routing

**Files:**
- Modify: `Caddyfile`

- [ ] **Step 1: Add social crawler matcher**

Add a Caddy matcher before the frontend catch-all that matches topic share paths and known social crawler user agents. Reverse proxy those requests to `backend:8000`.

- [ ] **Step 2: Verify config shape**

Run: `sed -n '1,120p' Caddyfile`

Expected: API routes remain first, crawler topic preview route appears before the frontend catch-all, and the normal `handle` block still proxies frontend.

### Task 4: Regression Verification

**Files:**
- Existing test suites only

- [ ] **Step 1: Run backend tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -q`

Expected: PASS.

- [ ] **Step 2: Run frontend type check**

Run: `cd frontend && npx tsc --noEmit`

Expected: PASS.
