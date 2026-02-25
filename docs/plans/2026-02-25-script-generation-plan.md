# Script Generation Pipeline — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add AI-generated narrative scripts to topics in the dashboard, with inline tweet embeds, iterative feedback, and multi-model support (Grok + Claude).

**Architecture:** New `topic_scripts` DB table stores versioned scripts as JSON blocks. Backend endpoints orchestrate Grok context fetching → script generation → storage. Frontend TopicSection gets a script mode that replaces the tweet list with a narrative + inline tweets. A multi-provider service layer routes generation calls to xAI or Anthropic APIs.

**Tech Stack:** FastAPI, SQLAlchemy (async), Alembic, React, TanStack Query, httpx, xAI API, Anthropic API

---

### Task 1: TopicScript model + migration

**Files:**
- Create: `backend/app/models/topic_script.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/010_add_topic_scripts.py`
- Test: `backend/tests/test_scripts_api.py`

**Step 1: Write the model**

Create `backend/app/models/topic_script.py`:

```python
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TopicScript(Base):
    __tablename__ = "topic_scripts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    topic_id: Mapped[int] = mapped_column(ForeignKey("topics.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    model_used: Mapped[str] = mapped_column(String(128))
    content: Mapped[list] = mapped_column(JSONB)
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

**Step 2: Register in models __init__**

Add `from app.models.topic_script import TopicScript` to `backend/app/models/__init__.py`.

**Step 3: Write the Alembic migration**

Create `backend/alembic/versions/010_add_topic_scripts.py`:

```python
"""Add topic_scripts table."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "010_topic_scripts"
down_revision = "009_url_entities"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "topic_scripts",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("topic_id", sa.Integer, sa.ForeignKey("topics.id", ondelete="CASCADE"), index=True, nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("model_used", sa.String(128), nullable=False),
        sa.Column("content", JSONB, nullable=False),
        sa.Column("feedback", sa.Text, nullable=True),
        sa.Column("is_active", sa.Boolean, server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("topic_scripts")
```

**Step 4: Write a basic model test**

Add to top of `backend/tests/test_scripts_api.py`:

```python
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from unittest.mock import AsyncMock, patch

from app.db import Base, get_db
from app.main import app

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
```

**Step 5: Run tests to verify model loads**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_scripts_api.py -v`
Expected: passes (no tests yet, but import/setup works)

**Step 6: Commit**

```bash
git add backend/app/models/topic_script.py backend/app/models/__init__.py backend/alembic/versions/010_add_topic_scripts.py backend/tests/test_scripts_api.py
git commit -m "feat: add TopicScript model and migration"
```

---

### Task 2: Pydantic schemas for scripts

**Files:**
- Create: `backend/app/schemas/topic_script.py`

**Step 1: Write the schemas**

Create `backend/app/schemas/topic_script.py`:

```python
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ScriptBlock(BaseModel):
    type: str  # "text" or "tweet"
    text: str | None = None
    tweet_id: str | None = None


class ScriptGenerateRequest(BaseModel):
    model: str = "grok-4-1-fast-reasoning"
    feedback: str | None = None
    fetch_grok_context: bool = True


class ScriptOut(BaseModel):
    id: int
    topic_id: int
    version: int
    model_used: str
    content: list[ScriptBlock]
    feedback: str | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class ScriptVersionSummary(BaseModel):
    id: int
    version: int
    model_used: str
    feedback: str | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class DayScriptGenerateRequest(BaseModel):
    model: str = "grok-4-1-fast-reasoning"
    fetch_grok_context: bool = True
```

**Step 2: Commit**

```bash
git add backend/app/schemas/topic_script.py
git commit -m "feat: add Pydantic schemas for script generation"
```

---

### Task 3: Multi-provider generation service

**Files:**
- Create: `backend/app/services/script_generator.py`
- Modify: `backend/app/config.py`
- Test: `backend/tests/test_script_generator.py`

**Step 1: Add `anthropic_api_key` to config**

In `backend/app/config.py`, add to the Settings class:

```python
anthropic_api_key: str = ""
```

**Step 2: Write the failing test**

Create `backend/tests/test_script_generator.py`:

```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.script_generator import generate_script, build_prompt, ScriptGeneratorError


@pytest.mark.asyncio
async def test_generate_script_grok():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "choices": [{"message": {"content": '[{"type":"text","text":"SpaceX acquired xAI."},{"type":"tweet","tweet_id":"123"}]'}}]
    }

    with patch("app.services.script_generator.settings") as mock_settings:
        mock_settings.xai_api_key = "test-key"
        mock_settings.anthropic_api_key = ""

        with patch("app.services.script_generator.httpx.AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await generate_script(
                model="grok-4-1-fast-reasoning",
                prompt="test prompt",
            )

    assert len(result) == 2
    assert result[0]["type"] == "text"
    assert result[1]["type"] == "tweet"
    assert result[1]["tweet_id"] == "123"


@pytest.mark.asyncio
async def test_generate_script_claude():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "content": [{"type": "text", "text": '[{"type":"text","text":"SpaceX acquired xAI."}]'}]
    }

    with patch("app.services.script_generator.settings") as mock_settings:
        mock_settings.xai_api_key = ""
        mock_settings.anthropic_api_key = "test-key"

        with patch("app.services.script_generator.httpx.AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await generate_script(
                model="claude-opus-4-6",
                prompt="test prompt",
            )

    assert len(result) == 1
    assert result[0]["type"] == "text"


def test_build_prompt():
    topic_title = "SpaceX Acquired xAI"
    og_tweet = {"text": "Breaking: SpaceX acquires xAI", "url": "https://x.com/user/status/1", "grok_context": "Major merger news", "tweet_id": "1"}
    tweets = [
        {"tweet_id": "2", "author_handle": "user2", "text": "This is huge", "category": "signal-boost", "grok_context": "Excitement"},
        {"tweet_id": "3", "author_handle": "user3", "text": "Not sure about this", "category": "pushback", "grok_context": "Skepticism"},
    ]
    style_guide = "Be concise and objective."

    prompt = build_prompt(topic_title, og_tweet, tweets, style_guide)

    assert "SpaceX Acquired xAI" in prompt
    assert "Breaking: SpaceX acquires xAI" in prompt
    assert "tweet_id" in prompt
    assert "signal-boost" in prompt
    assert "Be concise and objective." in prompt
```

**Step 3: Run test to verify it fails**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_script_generator.py -v`
Expected: FAIL (module doesn't exist)

**Step 4: Write the service**

Create `backend/app/services/script_generator.py`:

```python
"""Multi-provider script generation service.

Routes generation calls to xAI (Grok) or Anthropic (Claude) APIs
based on the model name. Parses the response into structured JSON blocks.
"""

from __future__ import annotations

import json
import re

import httpx

from app.config import settings

XAI_API_BASE = "https://api.x.ai/v1"
ANTHROPIC_API_BASE = "https://api.anthropic.com/v1"

CATEGORY_ORDER = ["context", "kek", "signal-boost", "pushback", "hot-take"]

DEFAULT_STYLE_GUIDE = """- Present discourse objectively — show what different sides said without editorializing
- Simplify complex topics so a general audience can follow
- Reference specific people/entities when they're central to the story
- Let the tweets do the heavy lifting for opinions — the script sets up context, tweets show the proof
- Conversational but informative — not academic, not meme-speak
- Natural prose, full sentences, clear and accessible"""


class ScriptGeneratorError(Exception):
    pass


def _is_grok_model(model: str) -> bool:
    return model.startswith("grok-")


def _is_claude_model(model: str) -> bool:
    return model.startswith("claude-")


def build_prompt(
    topic_title: str,
    og_tweet: dict | None,
    tweets: list[dict],
    style_guide: str,
    previous_script: list[dict] | None = None,
    feedback: str | None = None,
) -> str:
    parts = [
        "You are writing a narrative summary of a tech discourse topic for a daily digest.",
        "",
        "STYLE GUIDE:",
        style_guide or DEFAULT_STYLE_GUIDE,
        "",
        f"TOPIC: {topic_title}",
    ]

    if og_tweet:
        parts.append("")
        parts.append("OG POST:")
        parts.append(f"- Text: {og_tweet.get('text', '')}")
        parts.append(f"- URL: {og_tweet.get('url', '')}")
        parts.append(f"- Tweet ID: {og_tweet.get('tweet_id', '')}")
        if og_tweet.get("grok_context"):
            parts.append(f"- Grok Context: {og_tweet['grok_context']}")

    # Group tweets by category
    by_category: dict[str, list[dict]] = {}
    for t in tweets:
        cat = t.get("category") or "uncategorized"
        by_category.setdefault(cat, []).append(t)

    parts.append("")
    parts.append("TWEETS IN THIS TOPIC (grouped by category):")

    for cat in CATEGORY_ORDER + ["uncategorized"]:
        group = by_category.get(cat, [])
        if not group:
            continue
        parts.append(f"\n[{cat}]")
        for t in group:
            parts.append(f"- Author: @{t.get('author_handle', 'unknown')}")
            parts.append(f"  Text: {t.get('text', '')}")
            parts.append(f"  Tweet ID: {t.get('tweet_id', '')}")
            if t.get("grok_context"):
                parts.append(f"  Grok Context: {t['grok_context']}")

    if previous_script and feedback:
        parts.append("")
        parts.append("PREVIOUS SCRIPT VERSION:")
        parts.append(json.dumps(previous_script))
        parts.append("")
        parts.append(f"USER FEEDBACK: {feedback}")

    parts.append("")
    parts.append("Return a JSON array of blocks. Each block is either:")
    parts.append('- {"type": "text", "text": "narrative prose"}')
    parts.append('- {"type": "tweet", "tweet_id": "123456"}')
    parts.append("")
    parts.append("Place tweets at moments where they serve as evidence for what the script is saying.")
    parts.append("Use the category ordering to shape narrative flow: context → kek → signal-boost → pushback → hot-take.")
    parts.append("Only reference tweet_ids from the list above.")
    parts.append("Return ONLY the JSON array, no other text.")

    return "\n".join(parts)


def _parse_blocks(raw: str) -> list[dict]:
    """Extract JSON array from model response, handling markdown fences."""
    text = raw.strip()
    # Strip markdown code fences if present
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if match:
        text = match.group(1).strip()
    try:
        blocks = json.loads(text)
    except json.JSONDecodeError as e:
        raise ScriptGeneratorError(f"Failed to parse model response as JSON: {e}\nRaw: {raw[:500]}")
    if not isinstance(blocks, list):
        raise ScriptGeneratorError(f"Expected JSON array, got {type(blocks).__name__}")
    return blocks


async def generate_script(model: str, prompt: str) -> list[dict]:
    """Call the chosen model and return parsed script blocks."""
    if _is_grok_model(model):
        return await _call_grok(model, prompt)
    elif _is_claude_model(model):
        return await _call_claude(model, prompt)
    else:
        raise ScriptGeneratorError(f"Unsupported model: {model}")


async def _call_grok(model: str, prompt: str) -> list[dict]:
    if not settings.xai_api_key:
        raise ScriptGeneratorError("XAI_API_KEY is not configured")

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{XAI_API_BASE}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.xai_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
            },
        )

    if resp.status_code != 200:
        raise ScriptGeneratorError(f"Grok API returned {resp.status_code}: {resp.text}")

    data = resp.json()
    choices = data.get("choices", [])
    if not choices:
        raise ScriptGeneratorError("Grok API returned no choices")

    return _parse_blocks(choices[0]["message"]["content"])


async def _call_claude(model: str, prompt: str) -> list[dict]:
    if not settings.anthropic_api_key:
        raise ScriptGeneratorError("ANTHROPIC_API_KEY is not configured")

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{ANTHROPIC_API_BASE}/messages",
            headers={
                "x-api-key": settings.anthropic_api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": 4096,
                "messages": [{"role": "user", "content": prompt}],
            },
        )

    if resp.status_code != 200:
        raise ScriptGeneratorError(f"Anthropic API returned {resp.status_code}: {resp.text}")

    data = resp.json()
    content_blocks = data.get("content", [])
    if not content_blocks:
        raise ScriptGeneratorError("Anthropic API returned no content")

    return _parse_blocks(content_blocks[0]["text"])
```

**Step 5: Run tests to verify they pass**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_script_generator.py -v`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/app/config.py backend/app/services/script_generator.py backend/tests/test_script_generator.py
git commit -m "feat: add multi-provider script generation service"
```

---

### Task 4: Upgrade Grok context prompt

**Files:**
- Modify: `backend/app/services/grok_api.py`
- Modify: `backend/tests/test_grok_api.py`

**Step 1: Update the prompt in grok_api.py**

Replace the message content in `fetch_grok_context`:

```python
"content": (
    f"Explain this X post: {tweet_url}\n\n"
    "- Include relevant context, backstory, and discourse happening around this post\n"
    "- Cover sentiment: how are people reacting? Any sarcasm, ratio, pushback?\n"
    "- Note any parent tweet/thread context if this is a reply or quote tweet\n"
    "- Who are the key figures involved and why does that matter?\n"
    "- Keep it concise — bullet points, no fluff"
),
```

Also update the model from `"grok-3"` to `"grok-4-1-fast-reasoning"`.

**Step 2: Update tests to match new prompt**

Update the mock assertions in `test_grok_api.py` to expect the new prompt text.

**Step 3: Run tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_grok_api.py -v`
Expected: PASS

**Step 4: Commit**

```bash
git add backend/app/services/grok_api.py backend/tests/test_grok_api.py
git commit -m "feat: upgrade Grok context prompt and model to grok-4-1"
```

---

### Task 5: Script API endpoints

**Files:**
- Create: `backend/app/routers/scripts.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_scripts_api.py`

**Step 1: Write the failing tests**

Add to `backend/tests/test_scripts_api.py`:

```python
async def _create_topic_with_tweets(client: AsyncClient):
    """Helper: create a topic with tweets assigned to it."""
    # Create tweets (mock X API)
    with patch("app.routers.tweets.fetch_tweet", new_callable=AsyncMock) as mock_fetch:
        mock_fetch.return_value = {
            "author_handle": "testuser",
            "author_display_name": "Test User",
            "author_avatar_url": None,
            "author_verified": False,
            "text": "This is a test tweet about AI",
            "media_urls": None,
            "engagement": {"likes": 100, "retweets": 50, "replies": 10},
            "is_quote_tweet": False,
            "is_reply": False,
            "quoted_tweet_id": None,
            "reply_to_tweet_id": None,
            "reply_to_handle": None,
            "url_entities": None,
            "url": "https://x.com/testuser/status/111",
            "created_at": "2026-02-25T00:00:00Z",
        }
        await client.post("/api/tweets", json={"tweet_id": "111"})
        mock_fetch.return_value["text"] = "Pushback on the AI story"
        mock_fetch.return_value["url"] = "https://x.com/testuser/status/222"
        await client.post("/api/tweets", json={"tweet_id": "222"})

    # Create topic
    resp = await client.post("/api/topics", json={"title": "Test Topic", "date": "2026-02-25"})
    topic_id = resp.json()["id"]

    # Get tweet IDs
    tweets_resp = await client.get("/api/tweets")
    tweet_ids = [t["id"] for t in tweets_resp.json()]

    # Assign tweets
    await client.post("/api/tweets/assign", json={"tweet_ids": tweet_ids, "topic_id": topic_id, "category": "context"})

    return topic_id, tweet_ids


@pytest.mark.asyncio
async def test_generate_script(client: AsyncClient):
    topic_id, tweet_ids = await _create_topic_with_tweets(client)

    mock_blocks = [
        {"type": "text", "text": "Test narrative about AI."},
        {"type": "tweet", "tweet_id": "111"},
    ]

    with patch("app.routers.scripts.generate_script", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = mock_blocks
        with patch("app.services.grok_api.fetch_grok_context", new_callable=AsyncMock) as mock_grok:
            mock_grok.return_value = "Context about the tweet."

            resp = await client.post(
                f"/api/topics/{topic_id}/script/generate",
                json={"model": "grok-4-1-fast-reasoning", "fetch_grok_context": True},
            )

    assert resp.status_code == 200
    data = resp.json()
    assert data["version"] == 1
    assert data["is_active"] is True
    assert len(data["content"]) == 2


@pytest.mark.asyncio
async def test_get_active_script(client: AsyncClient):
    topic_id, _ = await _create_topic_with_tweets(client)

    # No script yet
    resp = await client.get(f"/api/topics/{topic_id}/script")
    assert resp.status_code == 404

    # Generate one
    mock_blocks = [{"type": "text", "text": "Narrative."}]
    with patch("app.routers.scripts.generate_script", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = mock_blocks
        with patch("app.services.grok_api.fetch_grok_context", new_callable=AsyncMock):
            await client.post(f"/api/topics/{topic_id}/script/generate", json={"model": "grok-3"})

    resp = await client.get(f"/api/topics/{topic_id}/script")
    assert resp.status_code == 200
    assert resp.json()["version"] == 1


@pytest.mark.asyncio
async def test_regenerate_with_feedback(client: AsyncClient):
    topic_id, _ = await _create_topic_with_tweets(client)

    mock_blocks = [{"type": "text", "text": "V1 narrative."}]
    with patch("app.routers.scripts.generate_script", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = mock_blocks
        with patch("app.services.grok_api.fetch_grok_context", new_callable=AsyncMock):
            await client.post(f"/api/topics/{topic_id}/script/generate", json={"model": "grok-3"})

    mock_blocks_v2 = [{"type": "text", "text": "V2 narrative with feedback."}]
    with patch("app.routers.scripts.generate_script", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = mock_blocks_v2
        with patch("app.services.grok_api.fetch_grok_context", new_callable=AsyncMock):
            resp = await client.post(
                f"/api/topics/{topic_id}/script/generate",
                json={"model": "grok-3", "feedback": "make it punchier"},
            )

    assert resp.json()["version"] == 2
    assert resp.json()["feedback"] == "make it punchier"

    # V1 is no longer active
    versions_resp = await client.get(f"/api/topics/{topic_id}/script/versions")
    versions = versions_resp.json()
    assert len(versions) == 2
    assert versions[0]["is_active"] is False
    assert versions[1]["is_active"] is True
```

**Step 2: Run tests to verify they fail**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_scripts_api.py -v`
Expected: FAIL (router doesn't exist)

**Step 3: Write the router**

Create `backend/app/routers/scripts.py`:

```python
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.assignment import TweetAssignment
from app.models.topic import Topic
from app.models.topic_script import TopicScript
from app.models.tweet import Tweet
from app.schemas.topic_script import (
    DayScriptGenerateRequest,
    ScriptGenerateRequest,
    ScriptOut,
    ScriptVersionSummary,
)
from app.services.script_generator import (
    DEFAULT_STYLE_GUIDE,
    ScriptGeneratorError,
    build_prompt,
    generate_script,
)

router = APIRouter(tags=["scripts"])


async def _get_topic_tweets(topic_id: int, db: AsyncSession) -> tuple[Topic, Tweet | None, list[dict]]:
    """Load a topic, its OG tweet, and all assigned tweets with categories."""
    topic = await db.get(Topic, topic_id)
    if not topic:
        raise HTTPException(404, "Topic not found")

    og_tweet = None
    if topic.og_tweet_id:
        og_tweet = await db.get(Tweet, topic.og_tweet_id)

    rows = (await db.execute(
        select(Tweet, TweetAssignment.category)
        .join(TweetAssignment, TweetAssignment.tweet_id == Tweet.id)
        .where(TweetAssignment.topic_id == topic_id)
    )).all()

    tweets = []
    for tweet, category in rows:
        tweets.append({
            "tweet_id": tweet.tweet_id,
            "author_handle": tweet.author_handle,
            "text": tweet.text,
            "url": tweet.url,
            "category": category,
            "grok_context": tweet.grok_context,
        })

    return topic, og_tweet, tweets


async def _fetch_missing_grok_contexts(topic_id: int, db: AsyncSession):
    """Fetch Grok context for all tweets in topic that don't have it cached."""
    from app.services.grok_api import fetch_grok_context, GrokAPIError

    rows = (await db.execute(
        select(Tweet)
        .join(TweetAssignment, TweetAssignment.tweet_id == Tweet.id)
        .where(TweetAssignment.topic_id == topic_id)
        .where(Tweet.grok_context.is_(None))
    )).scalars().all()

    for tweet in rows:
        tweet_url = tweet.url or f"https://x.com/{tweet.author_handle}/status/{tweet.tweet_id}"
        try:
            tweet.grok_context = await fetch_grok_context(tweet_url)
        except GrokAPIError:
            pass  # Skip tweets where Grok fails, continue with rest

    await db.commit()


@router.post("/api/topics/{topic_id}/script/generate", response_model=ScriptOut)
async def generate_topic_script(
    topic_id: int,
    body: ScriptGenerateRequest,
    db: AsyncSession = Depends(get_db),
):
    # Fetch Grok context for tweets if requested
    if body.fetch_grok_context:
        await _fetch_missing_grok_contexts(topic_id, db)

    topic, og_tweet, tweets = await _get_topic_tweets(topic_id, db)

    # Build OG tweet dict
    og_dict = None
    if og_tweet:
        og_dict = {
            "tweet_id": og_tweet.tweet_id,
            "text": og_tweet.text,
            "url": og_tweet.url or f"https://x.com/{og_tweet.author_handle}/status/{og_tweet.tweet_id}",
            "grok_context": og_tweet.grok_context,
        }

    # Load previous active script if regenerating with feedback
    previous_script = None
    if body.feedback:
        prev = (await db.execute(
            select(TopicScript)
            .where(TopicScript.topic_id == topic_id, TopicScript.is_active.is_(True))
        )).scalar_one_or_none()
        if prev:
            previous_script = prev.content

    # Build prompt and generate
    prompt = build_prompt(
        topic_title=topic.title,
        og_tweet=og_dict,
        tweets=tweets,
        style_guide=DEFAULT_STYLE_GUIDE,
        previous_script=previous_script,
        feedback=body.feedback,
    )

    try:
        blocks = await generate_script(model=body.model, prompt=prompt)
    except ScriptGeneratorError as e:
        raise HTTPException(502, str(e))

    # Deactivate previous versions
    prev_scripts = (await db.execute(
        select(TopicScript)
        .where(TopicScript.topic_id == topic_id, TopicScript.is_active.is_(True))
    )).scalars().all()
    for ps in prev_scripts:
        ps.is_active = False

    # Determine next version
    max_version = (await db.execute(
        select(TopicScript.version)
        .where(TopicScript.topic_id == topic_id)
        .order_by(TopicScript.version.desc())
        .limit(1)
    )).scalar_one_or_none() or 0

    script = TopicScript(
        topic_id=topic_id,
        version=max_version + 1,
        model_used=body.model,
        content=blocks,
        feedback=body.feedback,
        is_active=True,
    )
    db.add(script)
    await db.commit()
    await db.refresh(script)
    return script


@router.get("/api/topics/{topic_id}/script", response_model=ScriptOut)
async def get_active_script(
    topic_id: int,
    db: AsyncSession = Depends(get_db),
):
    script = (await db.execute(
        select(TopicScript)
        .where(TopicScript.topic_id == topic_id, TopicScript.is_active.is_(True))
    )).scalar_one_or_none()

    if not script:
        raise HTTPException(404, "No script found for this topic")

    return script


@router.get("/api/topics/{topic_id}/script/versions", response_model=list[ScriptVersionSummary])
async def list_script_versions(
    topic_id: int,
    db: AsyncSession = Depends(get_db),
):
    scripts = (await db.execute(
        select(TopicScript)
        .where(TopicScript.topic_id == topic_id)
        .order_by(TopicScript.version)
    )).scalars().all()
    return scripts


@router.post("/api/dates/{date}/script/generate", response_model=list[ScriptOut])
async def generate_day_scripts(
    date: date,
    body: DayScriptGenerateRequest,
    db: AsyncSession = Depends(get_db),
):
    topics = (await db.execute(
        select(Topic).where(Topic.date == date).order_by(Topic.position)
    )).scalars().all()

    results = []
    for topic in topics:
        req = ScriptGenerateRequest(model=body.model, fetch_grok_context=body.fetch_grok_context)
        script = await generate_topic_script(topic.id, req, db)
        results.append(script)

    return results


@router.get("/api/dates/{date}/script", response_model=list[ScriptOut])
async def get_day_scripts(
    date: date,
    db: AsyncSession = Depends(get_db),
):
    topics = (await db.execute(
        select(Topic).where(Topic.date == date).order_by(Topic.position)
    )).scalars().all()

    scripts = []
    for topic in topics:
        script = (await db.execute(
            select(TopicScript)
            .where(TopicScript.topic_id == topic.id, TopicScript.is_active.is_(True))
        )).scalar_one_or_none()
        if script:
            scripts.append(script)

    return scripts
```

**Step 4: Register the router in main.py**

Add to `backend/app/main.py`:

```python
from app.routers.scripts import router as scripts_router
app.include_router(scripts_router)
```

**Step 5: Run tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_scripts_api.py -v`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/app/routers/scripts.py backend/app/main.py backend/tests/test_scripts_api.py
git commit -m "feat: add script generation API endpoints"
```

---

### Task 6: Frontend API hooks for scripts

**Files:**
- Create: `frontend/src/api/scripts.ts`

**Step 1: Write the API hooks**

Create `frontend/src/api/scripts.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface ScriptBlock {
  type: 'text' | 'tweet'
  text?: string
  tweet_id?: string
}

export interface TopicScript {
  id: number
  topic_id: number
  version: number
  model_used: string
  content: ScriptBlock[]
  feedback: string | null
  is_active: boolean
  created_at: string
}

export interface ScriptVersionSummary {
  id: number
  version: number
  model_used: string
  feedback: string | null
  is_active: boolean
  created_at: string
}

export const AVAILABLE_MODELS = [
  { id: 'grok-4-1-fast-reasoning', label: 'Grok 4.1 (Reasoning)', provider: 'xAI' },
  { id: 'grok-4-1-fast-non-reasoning', label: 'Grok 4.1 (Fast)', provider: 'xAI' },
  { id: 'grok-3', label: 'Grok 3', provider: 'xAI' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'Anthropic' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'Anthropic' },
] as const

export function useTopicScript(topicId: number | undefined) {
  return useQuery<TopicScript>({
    queryKey: ['script', topicId],
    queryFn: async () => {
      const { data } = await api.get(`/topics/${topicId}/script`)
      return data
    },
    enabled: !!topicId,
    retry: false,
  })
}

export function useScriptVersions(topicId: number | undefined) {
  return useQuery<ScriptVersionSummary[]>({
    queryKey: ['script-versions', topicId],
    queryFn: async () => {
      const { data } = await api.get(`/topics/${topicId}/script/versions`)
      return data
    },
    enabled: !!topicId,
  })
}

export function useGenerateScript() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ topicId, model, feedback, fetchGrokContext }: {
      topicId: number
      model: string
      feedback?: string
      fetchGrokContext?: boolean
    }) => {
      const { data } = await api.post(`/topics/${topicId}/script/generate`, {
        model,
        feedback: feedback || null,
        fetch_grok_context: fetchGrokContext ?? true,
      })
      return data as TopicScript
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['script', data.topic_id] })
      qc.invalidateQueries({ queryKey: ['script-versions', data.topic_id] })
      qc.invalidateQueries({ queryKey: ['tweets'] })
    },
  })
}

export function useGenerateDayScripts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ date, model, fetchGrokContext }: {
      date: string
      model: string
      fetchGrokContext?: boolean
    }) => {
      const { data } = await api.post(`/dates/${date}/script/generate`, {
        model,
        fetch_grok_context: fetchGrokContext ?? true,
      })
      return data as TopicScript[]
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['script'] })
      qc.invalidateQueries({ queryKey: ['script-versions'] })
    },
  })
}
```

**Step 2: Commit**

```bash
git add frontend/src/api/scripts.ts
git commit -m "feat: add frontend API hooks for script generation"
```

---

### Task 7: ScriptView component

**Files:**
- Create: `frontend/src/components/ScriptView.tsx`

**Step 1: Write the component**

Create `frontend/src/components/ScriptView.tsx`:

```typescript
import { useState } from 'react'
import { type ScriptBlock, type TopicScript, AVAILABLE_MODELS, useGenerateScript } from '../api/scripts'
import { type Tweet } from '../api/tweets'
import TweetCard from './TweetCard'

interface ScriptViewProps {
  topicId: number
  script: TopicScript | null
  tweets: Tweet[]
  showEngagement: boolean
}

function ScriptTextBlock({ text }: { text: string }) {
  return (
    <div style={{
      padding: '8px 0',
      fontSize: '15px',
      lineHeight: 1.6,
      color: 'var(--text-primary)',
    }}>
      {text}
    </div>
  )
}

function ScriptTweetBlock({ tweetId, tweets, showEngagement }: { tweetId: string; tweets: Tweet[]; showEngagement: boolean }) {
  const tweet = tweets.find(t => t.tweet_id === tweetId)
  if (!tweet) return null

  return (
    <div style={{ margin: '12px 0', maxWidth: 550 }}>
      <TweetCard tweet={tweet} showEngagement={showEngagement} compact />
    </div>
  )
}

export default function ScriptView({ topicId, script, tweets, showEngagement }: ScriptViewProps) {
  const [model, setModel] = useState(AVAILABLE_MODELS[0].id)
  const [feedback, setFeedback] = useState('')
  const generateScript = useGenerateScript()

  const handleGenerate = () => {
    generateScript.mutate({
      topicId,
      model,
      feedback: feedback || undefined,
      fetchGrokContext: true,
    })
    setFeedback('')
  }

  // No script yet — show generate CTA
  if (!script) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: '32px 16px',
        color: 'var(--text-secondary)',
      }}>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          style={{
            background: 'var(--bg-raised)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 13,
          }}
        >
          {AVAILABLE_MODELS.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <button
          onClick={handleGenerate}
          disabled={generateScript.isPending}
          style={{
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 20px',
            fontSize: 14,
            cursor: generateScript.isPending ? 'wait' : 'pointer',
            opacity: generateScript.isPending ? 0.6 : 1,
          }}
        >
          {generateScript.isPending ? 'Generating...' : 'Generate Script'}
        </button>
      </div>
    )
  }

  // Render script blocks
  return (
    <div>
      <div style={{ padding: '8px 16px' }}>
        {script.content.map((block: ScriptBlock, i: number) => {
          if (block.type === 'text' && block.text) {
            return <ScriptTextBlock key={i} text={block.text} />
          }
          if (block.type === 'tweet' && block.tweet_id) {
            return <ScriptTweetBlock key={i} tweetId={block.tweet_id} tweets={tweets} showEngagement={showEngagement} />
          }
          return null
        })}
      </div>

      {/* Bottom bar: version info + feedback + regenerate */}
      <div style={{
        borderTop: '1px solid var(--border)',
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          v{script.version} · {script.model_used} · {new Date(script.created_at).toLocaleString()}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            style={{
              background: 'var(--bg-raised)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 13,
              flexShrink: 0,
            }}
          >
            {AVAILABLE_MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <input
            type="text"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Give feedback..."
            onKeyDown={(e) => { if (e.key === 'Enter') handleGenerate() }}
            style={{
              flex: 1,
              background: 'var(--bg-raised)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 13,
            }}
          />
          <button
            onClick={handleGenerate}
            disabled={generateScript.isPending}
            style={{
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 13,
              cursor: generateScript.isPending ? 'wait' : 'pointer',
              opacity: generateScript.isPending ? 0.6 : 1,
              flexShrink: 0,
            }}
          >
            {generateScript.isPending ? 'Generating...' : 'Regenerate'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/ScriptView.tsx
git commit -m "feat: add ScriptView component for narrative display"
```

---

### Task 8: Integrate ScriptView into TopicSection

**Files:**
- Modify: `frontend/src/components/TopicSection.tsx`

**Step 1: Add script mode toggle to TopicSection**

This task modifies the existing TopicSection to:
1. Add a `viewMode` state: `'edit' | 'script'`
2. Add a toggle button in the topic header
3. When in script mode, render `ScriptView` instead of the categorized tweet list
4. Fetch the active script via `useTopicScript(topicId)`

Key changes:
- Import `useTopicScript` from `../api/scripts`
- Import `ScriptView` from `./ScriptView`
- Add state: `const [viewMode, setViewMode] = useState<'edit' | 'script'>('edit')`
- Add toggle button next to the topic title in the header
- Conditionally render `ScriptView` vs existing tweet list based on `viewMode`
- Script mode toggle only enabled when a script exists OR as a way to trigger generation

**Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add frontend/src/components/TopicSection.tsx
git commit -m "feat: integrate script mode toggle into TopicSection"
```

---

### Task 9: Generate All Scripts button in DayFeedPanel

**Files:**
- Modify: `frontend/src/components/DayFeedPanel.tsx`

**Step 1: Add Generate All Scripts button**

Add to the day header area:
- Import `useGenerateDayScripts` from `../api/scripts`
- Add a "Generate All Scripts" button near the top of the panel
- Show progress state while generating
- On success, invalidate script queries so all TopicSections pick up their new scripts

**Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add frontend/src/components/DayFeedPanel.tsx
git commit -m "feat: add Generate All Scripts button to day view"
```

---

### Task 10: Run full test suite + verify

**Step 1: Run all backend tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -q`
Expected: all pass

**Step 2: Run frontend TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

**Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address test/type issues from script generation feature"
```
