# tpot-digest v2 Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Clean-slate rebuild of tpot-digest as a focused tweet curation tool with manual topic/category organization, replacing all AI clustering, knowledge graph, and pipeline code.

**Architecture:** Chrome extension saves tweets + screenshots to a FastAPI backend. Dashboard organizes tweets into a Date → Topic → Category → Tweets hierarchy. PostgreSQL + pgvector (kept for future search). No AI, no scheduler, no scraping.

**Tech Stack:** Python 3.12 (FastAPI, SQLAlchemy async), React 19 (TypeScript, Vite, TanStack Query), Chrome Extension (Manifest V3, vanilla JS), PostgreSQL 16 + pgvector, Docker Compose + Caddy

**Design Reference:** `docs/plans/2026-02-20-tpot-redesign-design.md`

---

## Phase 1: Backend Foundation (Tasks 1–3)

Wipe existing backend code and rebuild models, config, and DB layer.

---

### Task 1: Clean Slate — Remove Old Backend Code

**Files:**
- Delete: `backend/app/models/account.py`
- Delete: `backend/app/models/article.py`
- Delete: `backend/app/models/topic.py` (will be rewritten)
- Delete: `backend/app/models/tweet.py` (will be rewritten)
- Delete: `backend/app/models/screenshot.py` (screenshots now a column on tweets)
- Delete: `backend/app/models/__init__.py`
- Delete: `backend/app/routers/` (all files — will be rewritten)
- Delete: `backend/app/schemas/` (all files — will be rewritten)
- Delete: `backend/app/pipeline/` (entire directory)
- Delete: `backend/app/scraper/` (entire directory)
- Delete: `backend/app/scheduler.py`
- Delete: `backend/app/storage.py`
- Delete: `backend/tests/` (all test files — will be rewritten)
- Delete: `backend/alembic/versions/` (all migration files)

**Step 1: Remove all old code**

```bash
# Backend app code
rm -f backend/app/models/account.py backend/app/models/article.py backend/app/models/topic.py backend/app/models/tweet.py backend/app/models/screenshot.py backend/app/models/__init__.py
rm -rf backend/app/routers backend/app/schemas backend/app/pipeline backend/app/scraper
rm -f backend/app/scheduler.py backend/app/storage.py

# Tests
rm -rf backend/tests/*

# Old migrations
rm -f backend/alembic/versions/*.py

# Create clean directories
mkdir -p backend/app/routers backend/app/schemas backend/tests
touch backend/app/routers/__init__.py backend/app/schemas/__init__.py backend/app/models/__init__.py backend/tests/__init__.py
```

**Step 2: Verify clean state**

```bash
ls backend/app/
# Should show: __pycache__  config.py  db.py  main.py  models/  routers/  schemas/
```

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor: remove all v1 backend code for clean-slate rebuild"
```

---

### Task 2: New Data Models

**Files:**
- Create: `backend/app/models/tweet.py`
- Create: `backend/app/models/topic.py`
- Create: `backend/app/models/category.py`
- Create: `backend/app/models/assignment.py`
- Modify: `backend/app/models/__init__.py`
- Test: `backend/tests/test_models.py`

**Step 1: Write the model test**

`backend/tests/test_models.py`:
```python
import pytest
import pytest_asyncio
from datetime import date, datetime, timezone
from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles

from app.db import Base
from app.models.tweet import Tweet
from app.models.topic import Topic
from app.models.category import Category
from app.models.assignment import TweetAssignment


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):
    return compiler.visit_JSON(type_, **kw)


TEST_DB_URL = "sqlite+aiosqlite:///:memory:"
engine = create_async_engine(TEST_DB_URL, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)


@pytest_asyncio.fixture(autouse=True)
async def db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as session:
        yield session
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.mark.asyncio
async def test_create_tweet(db):
    tweet = Tweet(
        tweet_id="123456",
        author_handle="karpathy",
        author_display_name="Andrej Karpathy",
        text="Hello world",
        feed_source="for_you",
    )
    db.add(tweet)
    await db.commit()
    await db.refresh(tweet)
    assert tweet.id is not None
    assert tweet.tweet_id == "123456"
    assert tweet.saved_at is not None


@pytest.mark.asyncio
async def test_create_topic(db):
    topic = Topic(title="Claude 4 Launch", date=date(2026, 2, 20), color="#E8A838")
    db.add(topic)
    await db.commit()
    await db.refresh(topic)
    assert topic.id is not None
    assert topic.position == 0


@pytest.mark.asyncio
async def test_create_category(db):
    cat = Category(name="commentary", color="#4ECDC4")
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    assert cat.id is not None


@pytest.mark.asyncio
async def test_assign_tweet_to_topic(db):
    tweet = Tweet(tweet_id="999", author_handle="test", text="test")
    topic = Topic(title="Test Topic", date=date(2026, 2, 20))
    cat = Category(name="reaction", color="#FF0000")
    db.add_all([tweet, topic, cat])
    await db.flush()

    assignment = TweetAssignment(tweet_id=tweet.id, topic_id=topic.id, category_id=cat.id)
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    assert assignment.id is not None


@pytest.mark.asyncio
async def test_tweet_thread_fields(db):
    tweet = Tweet(
        tweet_id="111",
        author_handle="test",
        text="Thread tweet",
        thread_id="100",
        thread_position=2,
        is_reply=True,
        reply_to_tweet_id="100",
        reply_to_handle="author",
    )
    db.add(tweet)
    await db.commit()
    await db.refresh(tweet)
    assert tweet.thread_id == "100"
    assert tweet.thread_position == 2
    assert tweet.is_reply is True
```

**Step 2: Run test to verify it fails**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_models.py -v
```
Expected: FAIL — models don't exist

**Step 3: Create Tweet model**

`backend/app/models/tweet.py`:
```python
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Tweet(Base):
    __tablename__ = "tweets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tweet_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    author_handle: Mapped[str] = mapped_column(String(256))
    author_display_name: Mapped[str | None] = mapped_column(String(512))
    text: Mapped[str] = mapped_column(Text, default="")
    media_urls: Mapped[dict | None] = mapped_column(JSONB)
    engagement: Mapped[dict | None] = mapped_column(JSONB)
    is_quote_tweet: Mapped[bool] = mapped_column(Boolean, default=False)
    is_reply: Mapped[bool] = mapped_column(Boolean, default=False)
    quoted_tweet_id: Mapped[str | None] = mapped_column(String(64))
    reply_to_tweet_id: Mapped[str | None] = mapped_column(String(64))
    reply_to_handle: Mapped[str | None] = mapped_column(String(256))
    thread_id: Mapped[str | None] = mapped_column(String(64), index=True)
    thread_position: Mapped[int | None] = mapped_column(Integer)
    screenshot_path: Mapped[str | None] = mapped_column(String(512))
    feed_source: Mapped[str | None] = mapped_column(String(32))
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

**Step 4: Create Topic model**

`backend/app/models/topic.py`:
```python
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Topic(Base):
    __tablename__ = "topics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(512))
    date: Mapped[date] = mapped_column(Date, index=True)
    color: Mapped[str | None] = mapped_column(String(7))
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

**Step 5: Create Category model**

`backend/app/models/category.py`:
```python
from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True)
    color: Mapped[str | None] = mapped_column(String(7))
    position: Mapped[int] = mapped_column(Integer, default=0)
```

**Step 6: Create TweetAssignment model**

`backend/app/models/assignment.py`:
```python
from sqlalchemy import ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TweetAssignment(Base):
    __tablename__ = "tweet_assignments"
    __table_args__ = (UniqueConstraint("tweet_id", "topic_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tweet_id: Mapped[int] = mapped_column(ForeignKey("tweets.id", ondelete="CASCADE"), index=True)
    topic_id: Mapped[int] = mapped_column(ForeignKey("topics.id", ondelete="CASCADE"), index=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"))
```

**Step 7: Update models __init__**

`backend/app/models/__init__.py`:
```python
from app.models.assignment import TweetAssignment
from app.models.category import Category
from app.models.topic import Topic
from app.models.tweet import Tweet

__all__ = ["Tweet", "Topic", "Category", "TweetAssignment"]
```

**Step 8: Run tests**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_models.py -v
```
Expected: All PASS

**Step 9: Commit**

```bash
git add backend/app/models/ backend/tests/test_models.py
git commit -m "feat: new data models — tweets, topics, categories, assignments"
```

---

### Task 3: Alembic Migration & Minimal main.py

**Files:**
- Create: `backend/alembic/versions/001_v2_schema.py` (via alembic)
- Modify: `backend/app/main.py`

**Step 1: Simplify main.py**

`backend/app/main.py`:
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="tpot-digest", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
```

**Step 2: Generate Alembic migration**

```bash
cd backend && ../.venv/bin/python -m alembic revision --autogenerate -m "v2 schema: tweets, topics, categories, assignments"
```

Review the generated migration file to ensure it creates the 4 tables with correct columns.

**Step 3: Verify migration applies**

```bash
# Test with a local postgres if available, or just verify the migration file looks correct
cat backend/alembic/versions/*v2_schema*.py
```

**Step 4: Commit**

```bash
git add backend/app/main.py backend/alembic/versions/
git commit -m "feat: v2 Alembic migration and minimal main.py"
```

---

## Phase 2: Backend API (Tasks 4–8)

Build all REST endpoints with TDD.

---

### Task 4: Tweet Schemas & Save Endpoint

**Files:**
- Create: `backend/app/schemas/tweet.py`
- Create: `backend/app/routers/tweets.py`
- Modify: `backend/app/main.py` (register router)
- Test: `backend/tests/test_tweets_api.py`

**Step 1: Write the failing test**

`backend/tests/test_tweets_api.py`:
```python
import pytest
import pytest_asyncio
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


TINY_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4"
    "nGNgYPgPAAEDAQAIicLsAAAABJRU5ErkJggg=="
)


@pytest.mark.asyncio
async def test_save_tweet(client: AsyncClient):
    payload = {
        "tweet_id": "123456",
        "author_handle": "karpathy",
        "author_display_name": "Andrej Karpathy",
        "text": "Claude 4 is amazing",
        "engagement": {"likes": 5000, "retweets": 1200, "replies": 300},
        "screenshot_base64": TINY_PNG,
        "feed_source": "for_you",
    }
    resp = await client.post("/api/tweets", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["tweet_id"] == "123456"
    assert data["author_handle"] == "karpathy"


@pytest.mark.asyncio
async def test_save_duplicate_returns_200(client: AsyncClient):
    payload = {
        "tweet_id": "123456",
        "author_handle": "karpathy",
        "text": "test",
        "screenshot_base64": TINY_PNG,
    }
    resp1 = await client.post("/api/tweets", json=payload)
    assert resp1.status_code == 201

    resp2 = await client.post("/api/tweets", json=payload)
    assert resp2.status_code == 200
    assert resp2.json()["status"] == "duplicate"


@pytest.mark.asyncio
async def test_list_tweets(client: AsyncClient):
    for i in range(3):
        await client.post("/api/tweets", json={
            "tweet_id": str(i),
            "author_handle": "test",
            "text": f"Tweet {i}",
            "screenshot_base64": TINY_PNG,
        })
    resp = await client.get("/api/tweets")
    assert resp.status_code == 200
    assert len(resp.json()) == 3


@pytest.mark.asyncio
async def test_delete_tweet(client: AsyncClient):
    await client.post("/api/tweets", json={
        "tweet_id": "del1",
        "author_handle": "test",
        "text": "Delete me",
        "screenshot_base64": TINY_PNG,
    })
    tweets = (await client.get("/api/tweets")).json()
    tweet_id = tweets[0]["id"]

    resp = await client.delete(f"/api/tweets/{tweet_id}")
    assert resp.status_code == 204

    tweets_after = (await client.get("/api/tweets")).json()
    assert len(tweets_after) == 0
```

**Step 2: Run test to verify it fails**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_tweets_api.py -v
```
Expected: FAIL — no routes

**Step 3: Create schemas**

`backend/app/schemas/tweet.py`:
```python
from datetime import datetime

from pydantic import BaseModel


class TweetSave(BaseModel):
    tweet_id: str
    author_handle: str
    author_display_name: str | None = None
    text: str = ""
    media_urls: list[str] | None = None
    engagement: dict | None = None
    is_quote_tweet: bool = False
    is_reply: bool = False
    quoted_tweet_id: str | None = None
    reply_to_tweet_id: str | None = None
    reply_to_handle: str | None = None
    thread_id: str | None = None
    thread_position: int | None = None
    screenshot_base64: str
    feed_source: str | None = None
    topic_id: int | None = None
    category_id: int | None = None


class TweetOut(BaseModel):
    id: int
    tweet_id: str
    author_handle: str
    author_display_name: str | None
    text: str
    media_urls: dict | None
    engagement: dict | None
    is_quote_tweet: bool
    is_reply: bool
    quoted_tweet_id: str | None
    reply_to_tweet_id: str | None
    reply_to_handle: str | None
    thread_id: str | None
    thread_position: int | None
    screenshot_path: str | None
    feed_source: str | None
    saved_at: datetime
    status: str = "saved"

    model_config = {"from_attributes": True}


class TweetAssignRequest(BaseModel):
    tweet_ids: list[int]
    topic_id: int
    category_id: int | None = None


class TweetUnassignRequest(BaseModel):
    tweet_ids: list[int]
    topic_id: int
```

**Step 4: Create router**

`backend/app/routers/tweets.py`:
```python
import base64
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.models.assignment import TweetAssignment
from app.models.tweet import Tweet
from app.schemas.tweet import TweetAssignRequest, TweetOut, TweetSave, TweetUnassignRequest

router = APIRouter(prefix="/api/tweets", tags=["tweets"])


def _save_screenshot(tweet_id: str, b64: str) -> str:
    today = date.today().strftime("%Y%m%d")
    dir_path = Path(settings.data_dir) / today / "screenshots"
    dir_path.mkdir(parents=True, exist_ok=True)
    file_path = dir_path / f"tweet_{tweet_id}.png"
    file_path.write_bytes(base64.b64decode(b64))
    return str(file_path.relative_to(settings.data_dir))


@router.post("", status_code=201)
async def save_tweet(body: TweetSave, db: AsyncSession = Depends(get_db)):
    existing = (await db.execute(
        select(Tweet).where(Tweet.tweet_id == body.tweet_id)
    )).scalar_one_or_none()
    if existing:
        out = TweetOut.model_validate(existing)
        out.status = "duplicate"
        return JSONResponse(content=out.model_dump(mode="json"), status_code=200)

    screenshot_path = _save_screenshot(body.tweet_id, body.screenshot_base64)

    tweet = Tweet(
        tweet_id=body.tweet_id,
        author_handle=body.author_handle,
        author_display_name=body.author_display_name,
        text=body.text,
        media_urls={"urls": body.media_urls} if body.media_urls else None,
        engagement=body.engagement,
        is_quote_tweet=body.is_quote_tweet,
        is_reply=body.is_reply,
        quoted_tweet_id=body.quoted_tweet_id,
        reply_to_tweet_id=body.reply_to_tweet_id,
        reply_to_handle=body.reply_to_handle,
        thread_id=body.thread_id,
        thread_position=body.thread_position,
        screenshot_path=screenshot_path,
        feed_source=body.feed_source,
    )
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


@router.get("", response_model=list[TweetOut])
async def list_tweets(
    date: date | None = Query(None),
    topic_id: int | None = Query(None),
    category_id: int | None = Query(None),
    unassigned: bool = Query(False),
    q: str | None = Query(None),
    thread_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Tweet).order_by(Tweet.saved_at.desc())

    if date:
        from sqlalchemy import cast, Date as SQLDate
        stmt = stmt.where(cast(Tweet.saved_at, SQLDate) == date)

    if topic_id:
        assigned_ids = select(TweetAssignment.tweet_id).where(TweetAssignment.topic_id == topic_id)
        if category_id:
            assigned_ids = assigned_ids.where(TweetAssignment.category_id == category_id)
        stmt = stmt.where(Tweet.id.in_(assigned_ids))

    if unassigned:
        all_assigned = select(TweetAssignment.tweet_id)
        stmt = stmt.where(Tweet.id.not_in(all_assigned))

    if q:
        stmt = stmt.where(Tweet.text.ilike(f"%{q}%"))

    if thread_id:
        stmt = stmt.where(Tweet.thread_id == thread_id).order_by(Tweet.thread_position)

    result = await db.execute(stmt)
    return result.scalars().all()


@router.delete("/{tweet_id}", status_code=204)
async def delete_tweet(tweet_id: int, db: AsyncSession = Depends(get_db)):
    tweet = await db.get(Tweet, tweet_id)
    if not tweet:
        raise HTTPException(404, "Tweet not found")
    await db.delete(tweet)
    await db.commit()


@router.post("/assign", status_code=200)
async def assign_tweets(body: TweetAssignRequest, db: AsyncSession = Depends(get_db)):
    for tid in body.tweet_ids:
        existing = (await db.execute(
            select(TweetAssignment).where(
                TweetAssignment.tweet_id == tid,
                TweetAssignment.topic_id == body.topic_id,
            )
        )).scalar_one_or_none()
        if existing:
            existing.category_id = body.category_id
        else:
            db.add(TweetAssignment(
                tweet_id=tid, topic_id=body.topic_id, category_id=body.category_id
            ))
    await db.commit()
    return {"assigned": len(body.tweet_ids)}


@router.post("/unassign", status_code=200)
async def unassign_tweets(body: TweetUnassignRequest, db: AsyncSession = Depends(get_db)):
    for tid in body.tweet_ids:
        existing = (await db.execute(
            select(TweetAssignment).where(
                TweetAssignment.tweet_id == tid,
                TweetAssignment.topic_id == body.topic_id,
            )
        )).scalar_one_or_none()
        if existing:
            await db.delete(existing)
    await db.commit()
    return {"unassigned": len(body.tweet_ids)}
```

**Step 5: Register router in main.py**

Add to `backend/app/main.py`:
```python
from app.routers.tweets import router as tweets_router

# After CORS middleware:
app.include_router(tweets_router)
```

**Step 6: Run tests**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_tweets_api.py -v
```
Expected: All PASS

**Step 7: Commit**

```bash
git add backend/app/schemas/tweet.py backend/app/routers/tweets.py backend/app/main.py backend/tests/test_tweets_api.py
git commit -m "feat: tweets API — save, list, delete, assign, unassign"
```

---

### Task 5: Tweet Filtering & Search Tests

**Files:**
- Test: `backend/tests/test_tweets_api.py` (append)

**Step 1: Add filter and search tests**

Append to `backend/tests/test_tweets_api.py`:
```python
@pytest.mark.asyncio
async def test_list_unassigned_tweets(client: AsyncClient):
    # Save 2 tweets
    for i in range(2):
        await client.post("/api/tweets", json={
            "tweet_id": f"unassigned_{i}",
            "author_handle": "test",
            "text": f"Tweet {i}",
            "screenshot_base64": TINY_PNG,
        })
    resp = await client.get("/api/tweets", params={"unassigned": True})
    assert resp.status_code == 200
    assert len(resp.json()) == 2


@pytest.mark.asyncio
async def test_search_tweets(client: AsyncClient):
    await client.post("/api/tweets", json={
        "tweet_id": "s1",
        "author_handle": "test",
        "text": "Claude 4 is incredible",
        "screenshot_base64": TINY_PNG,
    })
    await client.post("/api/tweets", json={
        "tweet_id": "s2",
        "author_handle": "test",
        "text": "OpenAI raises funding",
        "screenshot_base64": TINY_PNG,
    })
    resp = await client.get("/api/tweets", params={"q": "Claude"})
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert "Claude" in resp.json()[0]["text"]


@pytest.mark.asyncio
async def test_list_thread_tweets(client: AsyncClient):
    for i in range(3):
        await client.post("/api/tweets", json={
            "tweet_id": f"thread_{i}",
            "author_handle": "test",
            "text": f"Thread part {i}",
            "thread_id": "thread_0",
            "thread_position": i,
            "screenshot_base64": TINY_PNG,
        })
    resp = await client.get("/api/tweets", params={"thread_id": "thread_0"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 3
    assert data[0]["thread_position"] == 0
    assert data[2]["thread_position"] == 2
```

**Step 2: Run tests**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_tweets_api.py -v
```
Expected: All PASS (implementation already handles these)

**Step 3: Commit**

```bash
git add backend/tests/test_tweets_api.py
git commit -m "test: tweet filtering, search, and thread listing"
```

---

### Task 6: Topics API

**Files:**
- Create: `backend/app/schemas/topic.py`
- Create: `backend/app/routers/topics.py`
- Modify: `backend/app/main.py` (register router)
- Test: `backend/tests/test_topics_api.py`

**Step 1: Write the failing test**

`backend/tests/test_topics_api.py`:
```python
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles

from app.db import Base, get_db
from app.main import app
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


@pytest.mark.asyncio
async def test_create_topic(client: AsyncClient):
    resp = await client.post("/api/topics", json={
        "title": "Claude 4 Launch",
        "date": "2026-02-20",
        "color": "#E8A838",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Claude 4 Launch"
    assert data["date"] == "2026-02-20"


@pytest.mark.asyncio
async def test_list_topics_by_date(client: AsyncClient):
    await client.post("/api/topics", json={"title": "Topic A", "date": "2026-02-20"})
    await client.post("/api/topics", json={"title": "Topic B", "date": "2026-02-20"})
    await client.post("/api/topics", json={"title": "Topic C", "date": "2026-02-19"})

    resp = await client.get("/api/topics", params={"date": "2026-02-20"})
    assert resp.status_code == 200
    assert len(resp.json()) == 2


@pytest.mark.asyncio
async def test_update_topic(client: AsyncClient):
    create_resp = await client.post("/api/topics", json={
        "title": "Old Title",
        "date": "2026-02-20",
    })
    topic_id = create_resp.json()["id"]

    resp = await client.patch(f"/api/topics/{topic_id}", json={"title": "New Title"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "New Title"


@pytest.mark.asyncio
async def test_delete_topic(client: AsyncClient):
    create_resp = await client.post("/api/topics", json={
        "title": "Delete Me",
        "date": "2026-02-20",
    })
    topic_id = create_resp.json()["id"]

    resp = await client.delete(f"/api/topics/{topic_id}")
    assert resp.status_code == 204

    list_resp = await client.get("/api/topics", params={"date": "2026-02-20"})
    assert len(list_resp.json()) == 0
```

**Step 2: Run test to verify it fails**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_topics_api.py -v
```
Expected: FAIL — no routes

**Step 3: Create schemas**

`backend/app/schemas/topic.py`:
```python
from datetime import date, datetime

from pydantic import BaseModel


class TopicCreate(BaseModel):
    title: str
    date: date
    color: str | None = None


class TopicUpdate(BaseModel):
    title: str | None = None
    color: str | None = None
    position: int | None = None


class TopicOut(BaseModel):
    id: int
    title: str
    date: date
    color: str | None
    position: int
    created_at: datetime

    model_config = {"from_attributes": True}
```

**Step 4: Create router**

`backend/app/routers/topics.py`:
```python
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.topic import Topic
from app.schemas.topic import TopicCreate, TopicOut, TopicUpdate

router = APIRouter(prefix="/api/topics", tags=["topics"])


@router.post("", response_model=TopicOut, status_code=201)
async def create_topic(body: TopicCreate, db: AsyncSession = Depends(get_db)):
    topic = Topic(title=body.title, date=body.date, color=body.color)
    db.add(topic)
    await db.commit()
    await db.refresh(topic)
    return topic


@router.get("", response_model=list[TopicOut])
async def list_topics(
    date: date = Query(..., description="Filter by date"),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Topic).where(Topic.date == date).order_by(Topic.position)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.patch("/{topic_id}", response_model=TopicOut)
async def update_topic(topic_id: int, body: TopicUpdate, db: AsyncSession = Depends(get_db)):
    topic = await db.get(Topic, topic_id)
    if not topic:
        raise HTTPException(404, "Topic not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(topic, field, value)
    await db.commit()
    await db.refresh(topic)
    return topic


@router.delete("/{topic_id}", status_code=204)
async def delete_topic(topic_id: int, db: AsyncSession = Depends(get_db)):
    topic = await db.get(Topic, topic_id)
    if not topic:
        raise HTTPException(404, "Topic not found")
    await db.delete(topic)
    await db.commit()
```

**Step 5: Register router in main.py**

Add to `backend/app/main.py`:
```python
from app.routers.topics import router as topics_router
app.include_router(topics_router)
```

**Step 6: Run tests**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_topics_api.py -v
```
Expected: All PASS

**Step 7: Commit**

```bash
git add backend/app/schemas/topic.py backend/app/routers/topics.py backend/app/main.py backend/tests/test_topics_api.py
git commit -m "feat: topics API — create, list by date, update, delete"
```

---

### Task 7: Categories API

**Files:**
- Create: `backend/app/schemas/category.py`
- Create: `backend/app/routers/categories.py`
- Modify: `backend/app/main.py` (register router)
- Test: `backend/tests/test_categories_api.py`

**Step 1: Write the failing test**

`backend/tests/test_categories_api.py`:
```python
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles

from app.db import Base, get_db
from app.main import app
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


@pytest.mark.asyncio
async def test_create_category(client: AsyncClient):
    resp = await client.post("/api/categories", json={
        "name": "commentary",
        "color": "#4ECDC4",
    })
    assert resp.status_code == 201
    assert resp.json()["name"] == "commentary"


@pytest.mark.asyncio
async def test_list_categories(client: AsyncClient):
    await client.post("/api/categories", json={"name": "commentary"})
    await client.post("/api/categories", json={"name": "reaction"})
    await client.post("/api/categories", json={"name": "callout"})

    resp = await client.get("/api/categories")
    assert resp.status_code == 200
    assert len(resp.json()) == 3


@pytest.mark.asyncio
async def test_update_category(client: AsyncClient):
    create_resp = await client.post("/api/categories", json={"name": "old_name"})
    cat_id = create_resp.json()["id"]

    resp = await client.patch(f"/api/categories/{cat_id}", json={"name": "new_name"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "new_name"


@pytest.mark.asyncio
async def test_delete_category(client: AsyncClient):
    create_resp = await client.post("/api/categories", json={"name": "delete_me"})
    cat_id = create_resp.json()["id"]

    resp = await client.delete(f"/api/categories/{cat_id}")
    assert resp.status_code == 204

    list_resp = await client.get("/api/categories")
    assert len(list_resp.json()) == 0
```

**Step 2: Run test to verify it fails**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_categories_api.py -v
```

**Step 3: Create schemas**

`backend/app/schemas/category.py`:
```python
from pydantic import BaseModel


class CategoryCreate(BaseModel):
    name: str
    color: str | None = None


class CategoryUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    position: int | None = None


class CategoryOut(BaseModel):
    id: int
    name: str
    color: str | None
    position: int

    model_config = {"from_attributes": True}
```

**Step 4: Create router**

`backend/app/routers/categories.py`:
```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.category import Category
from app.schemas.category import CategoryCreate, CategoryOut, CategoryUpdate

router = APIRouter(prefix="/api/categories", tags=["categories"])


@router.post("", response_model=CategoryOut, status_code=201)
async def create_category(body: CategoryCreate, db: AsyncSession = Depends(get_db)):
    category = Category(name=body.name, color=body.color)
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return category


@router.get("", response_model=list[CategoryOut])
async def list_categories(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Category).order_by(Category.position))
    return result.scalars().all()


@router.patch("/{category_id}", response_model=CategoryOut)
async def update_category(category_id: int, body: CategoryUpdate, db: AsyncSession = Depends(get_db)):
    category = await db.get(Category, category_id)
    if not category:
        raise HTTPException(404, "Category not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(category, field, value)
    await db.commit()
    await db.refresh(category)
    return category


@router.delete("/{category_id}", status_code=204)
async def delete_category(category_id: int, db: AsyncSession = Depends(get_db)):
    category = await db.get(Category, category_id)
    if not category:
        raise HTTPException(404, "Category not found")
    await db.delete(category)
    await db.commit()
```

**Step 5: Register router in main.py**

Add to `backend/app/main.py`:
```python
from app.routers.categories import router as categories_router
app.include_router(categories_router)
```

**Step 6: Run tests**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_categories_api.py -v
```
Expected: All PASS

**Step 7: Commit**

```bash
git add backend/app/schemas/category.py backend/app/routers/categories.py backend/app/main.py backend/tests/test_categories_api.py
git commit -m "feat: categories API — create, list, update, delete"
```

---

### Task 8: Bulk Assign/Unassign Integration Tests

**Files:**
- Test: `backend/tests/test_assignments_api.py`

**Step 1: Write integration tests**

`backend/tests/test_assignments_api.py`:
```python
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles

from app.db import Base, get_db
from app.main import app
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


TINY_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4"
    "nGNgYPgPAAEDAQAIicLsAAAABJRU5ErkJggg=="
)


async def _create_tweets(client, count=3):
    ids = []
    for i in range(count):
        resp = await client.post("/api/tweets", json={
            "tweet_id": f"assign_{i}",
            "author_handle": "test",
            "text": f"Tweet {i}",
            "screenshot_base64": TINY_PNG,
        })
        ids.append(resp.json()["id"])
    return ids


@pytest.mark.asyncio
async def test_bulk_assign(client: AsyncClient):
    tweet_ids = await _create_tweets(client, 3)
    topic = (await client.post("/api/topics", json={"title": "Test", "date": "2026-02-20"})).json()
    cat = (await client.post("/api/categories", json={"name": "commentary"})).json()

    resp = await client.post("/api/tweets/assign", json={
        "tweet_ids": tweet_ids,
        "topic_id": topic["id"],
        "category_id": cat["id"],
    })
    assert resp.status_code == 200
    assert resp.json()["assigned"] == 3

    # Verify tweets show up under the topic
    filtered = await client.get("/api/tweets", params={"topic_id": topic["id"]})
    assert len(filtered.json()) == 3


@pytest.mark.asyncio
async def test_bulk_unassign(client: AsyncClient):
    tweet_ids = await _create_tweets(client, 2)
    topic = (await client.post("/api/topics", json={"title": "Test", "date": "2026-02-20"})).json()

    await client.post("/api/tweets/assign", json={
        "tweet_ids": tweet_ids,
        "topic_id": topic["id"],
    })

    resp = await client.post("/api/tweets/unassign", json={
        "tweet_ids": tweet_ids,
        "topic_id": topic["id"],
    })
    assert resp.status_code == 200

    # Tweets should now be unassigned
    unassigned = await client.get("/api/tweets", params={"unassigned": True})
    assert len(unassigned.json()) == 2


@pytest.mark.asyncio
async def test_assign_updates_category(client: AsyncClient):
    tweet_ids = await _create_tweets(client, 1)
    topic = (await client.post("/api/topics", json={"title": "Test", "date": "2026-02-20"})).json()
    cat1 = (await client.post("/api/categories", json={"name": "commentary"})).json()
    cat2 = (await client.post("/api/categories", json={"name": "reaction"})).json()

    # Assign with category 1
    await client.post("/api/tweets/assign", json={
        "tweet_ids": tweet_ids,
        "topic_id": topic["id"],
        "category_id": cat1["id"],
    })

    # Re-assign with category 2
    await client.post("/api/tweets/assign", json={
        "tweet_ids": tweet_ids,
        "topic_id": topic["id"],
        "category_id": cat2["id"],
    })

    # Should have only 1 assignment (updated, not duplicated)
    filtered = await client.get("/api/tweets", params={"topic_id": topic["id"]})
    assert len(filtered.json()) == 1
```

**Step 2: Run tests**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_assignments_api.py -v
```
Expected: All PASS

**Step 3: Run full test suite**

```bash
backend/.venv/bin/python -m pytest backend/tests/ -v
```
Expected: All PASS

**Step 4: Commit**

```bash
git add backend/tests/test_assignments_api.py
git commit -m "test: bulk assign/unassign integration tests"
```

---

## Phase 3: Chrome Extension (Tasks 9–11)

Rewrite the extension from scratch.

---

### Task 9: Extension — Manifest, Icons, and Content CSS

**Files:**
- Rewrite: `extension/manifest.json`
- Keep: `extension/icons/` (existing placeholders are fine)
- Rewrite: `extension/content.css`

**Step 1: Rewrite manifest.json**

`extension/manifest.json`:
```json
{
  "manifest_version": 3,
  "name": "tpot-digest",
  "version": "2.0.0",
  "description": "Save tweets to your tpot-digest dashboard",
  "permissions": [
    "activeTab",
    "storage",
    "alarms"
  ],
  "host_permissions": [
    "https://twitter.com/*",
    "https://x.com/*",
    "http://*/*",
    "https://*/*"
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

**Step 2: Rewrite content.css**

`extension/content.css`:
```css
article[data-testid="tweet"] {
  position: relative !important;
}

.tpot-save-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: #6366f1;
  color: #fff;
  font-size: 18px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, transform 0.1s ease;
  z-index: 10000;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tpot-save-btn::before {
  content: "+";
  font-size: 20px;
  font-weight: 700;
  line-height: 1;
}

article[data-testid="tweet"]:hover .tpot-save-btn {
  opacity: 1;
}

.tpot-save-btn:hover {
  background: #818cf8;
  transform: scale(1.1);
}

.tpot-save-btn.saved {
  background: #22c55e;
  opacity: 1;
  cursor: default;
}

.tpot-save-btn.saved::before {
  content: "\2713";
  font-size: 16px;
}

.tpot-save-btn.saving {
  opacity: 1;
  cursor: wait;
  pointer-events: none;
}

.tpot-save-btn.saving::before {
  content: "";
  display: block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: tpot-spin 0.6s linear infinite;
}

@keyframes tpot-spin {
  to { transform: rotate(360deg); }
}

.tpot-toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  padding: 12px 20px;
  border-radius: 8px;
  background: #1a1a2e;
  color: #e2e8f0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  z-index: 100000;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  animation: tpot-slide-up 0.3s ease-out;
  max-width: 320px;
}

.tpot-toast.error { border-left: 3px solid #ef4444; }
.tpot-toast.success { border-left: 3px solid #22c55e; }

@keyframes tpot-slide-up {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
```

**Step 3: Commit**

```bash
git add extension/manifest.json extension/content.css
git commit -m "feat: v2 extension manifest and content styles"
```

---

### Task 10: Extension — Content Script

**Files:**
- Rewrite: `extension/content.js`

**Step 1: Rewrite content.js**

`extension/content.js`:
```javascript
(function () {
  "use strict";
  if (window.__tpotDigestV2) return;
  window.__tpotDigestV2 = true;

  // ── Utilities ──────────────────────────────────────────────────────

  function parseCount(text) {
    if (!text) return 0;
    text = text.trim().replace(/,/g, "");
    const upper = text.toUpperCase();
    if (upper.endsWith("K")) return Math.round(parseFloat(text) * 1000);
    if (upper.endsWith("M")) return Math.round(parseFloat(text) * 1000000);
    return parseInt(text, 10) || 0;
  }

  function detectFeedSource() {
    const path = window.location.pathname;
    if (path === "/home" || path === "/") return "for_you";
    if (path.includes("/following")) return "following";
    if (path.includes("/search")) return "search";
    if (path.includes("/status/")) return "thread";
    return "profile";
  }

  // ── Tweet Data Extraction ──────────────────────────────────────────

  function extractTweetData(article) {
    const timeLink = article.querySelector('a[href*="/status/"]');
    const href = timeLink ? timeLink.getAttribute("href") : "";
    const idMatch = href.match(/status\/(\d+)/);
    const tweetId = idMatch ? idMatch[1] : "";

    const handleEl = article.querySelector('div[data-testid="User-Name"] a[href^="/"]');
    const authorHandle = handleEl ? handleEl.getAttribute("href").replace("/", "") : "";

    const nameEl = article.querySelector('div[data-testid="User-Name"] span');
    const authorDisplayName = nameEl ? nameEl.textContent : "";

    const textEl = article.querySelector('div[data-testid="tweetText"]');
    const text = textEl ? textEl.textContent : "";

    const mediaEls = article.querySelectorAll('img[src*="pbs.twimg.com/media"]');
    const mediaUrls = Array.from(mediaEls).map((el) => el.src);

    const likesEl = article.querySelector('button[data-testid="like"] span');
    const retweetsEl = article.querySelector('button[data-testid="retweet"] span');
    const repliesEl = article.querySelector('button[data-testid="reply"] span');

    const rtIndicator = article.querySelector('span[data-testid="socialContext"]');
    const isQuoteTweet = !!article.querySelector('div[role="link"][tabindex="0"]');
    const isReply = !!article.querySelector('div[data-testid="tweet"] a[href*="/status/"]');

    // Thread detection: check if viewing a thread page
    const threadMatch = window.location.pathname.match(/\/status\/(\d+)/);
    const threadId = threadMatch && detectFeedSource() === "thread" ? threadMatch[1] : null;

    return {
      tweet_id: tweetId,
      author_handle: authorHandle,
      author_display_name: authorDisplayName,
      text: text,
      media_urls: mediaUrls.length > 0 ? mediaUrls : null,
      engagement: {
        likes: parseCount(likesEl ? likesEl.textContent : "0"),
        retweets: parseCount(retweetsEl ? retweetsEl.textContent : "0"),
        replies: parseCount(repliesEl ? repliesEl.textContent : "0"),
      },
      is_quote_tweet: isQuoteTweet,
      is_reply: false,
      thread_id: threadId,
      feed_source: detectFeedSource(),
    };
  }

  // ── Toast ──────────────────────────────────────────────────────────

  function showToast(message, isError) {
    const existing = document.querySelector(".tpot-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "tpot-toast " + (isError ? "error" : "success");
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3000);
  }

  // ── Save Handler ───────────────────────────────────────────────────

  async function handleSave(button, article) {
    if (button.classList.contains("saved") || button.classList.contains("saving")) return;
    button.classList.add("saving");

    try {
      const tweetData = extractTweetData(article);
      if (!tweetData.tweet_id) throw new Error("Could not extract tweet ID");

      // Request screenshot from service worker
      const rect = article.getBoundingClientRect();
      const screenshotResp = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: "CAPTURE_SCREENSHOT",
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          dpr: window.devicePixelRatio || 1,
        }, (resp) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(resp);
        });
      });

      const screenshot = screenshotResp && screenshotResp.screenshot
        ? screenshotResp.screenshot
        : "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

      // Save tweet via service worker
      const saveResp = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: "SAVE_TWEET",
          tweet: { ...tweetData, screenshot_base64: screenshot },
        }, (resp) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(resp);
        });
      });

      if (saveResp && saveResp.error) throw new Error(saveResp.error);

      button.classList.remove("saving");
      button.classList.add("saved");

      const status = saveResp && saveResp.status === "duplicate" ? "already saved" : "saved";
      showToast("Tweet " + status + " — @" + tweetData.author_handle, false);
    } catch (err) {
      button.classList.remove("saving");
      showToast("Save failed: " + err.message, true);
    }
  }

  // ── Button Injection ───────────────────────────────────────────────

  function injectSaveButton(article) {
    if (article.querySelector(".tpot-save-btn")) return;

    const btn = document.createElement("button");
    btn.className = "tpot-save-btn";
    btn.title = "Save to tpot-digest";

    // Block ALL events from reaching Twitter's navigation handlers
    const block = (e) => { e.stopPropagation(); e.stopImmediatePropagation(); };
    ["pointerdown", "pointerup", "mousedown", "mouseup"].forEach((type) => {
      btn.addEventListener(type, block, true);
    });

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      handleSave(btn, article);
    });

    article.appendChild(btn);
  }

  // ── Observer ───────────────────────────────────────────────────────

  function scan() {
    document.querySelectorAll('article[data-testid="tweet"]').forEach(injectSaveButton);
  }

  new MutationObserver(() => scan()).observe(document.body, { childList: true, subtree: true });
  scan();
})();
```

**Step 2: Commit**

```bash
git add extension/content.js
git commit -m "feat: v2 content script with proper event blocking"
```

---

### Task 11: Extension — Service Worker & Popup

**Files:**
- Rewrite: `extension/background.js`
- Rewrite: `extension/popup.html`
- Rewrite: `extension/popup.js`
- Rewrite: `extension/popup.css`

**Step 1: Rewrite background.js**

`extension/background.js`:
```javascript
const DEFAULT_CONFIG = { backendUrl: "http://localhost:8000", authUser: "", authPass: "" };

async function getConfig() {
  return chrome.storage.sync.get(DEFAULT_CONFIG);
}

function todayKey() {
  const d = new Date();
  return "count_" + d.toISOString().slice(0, 10);
}

async function incrementCount() {
  const key = todayKey();
  const stored = await chrome.storage.local.get({ [key]: 0 });
  const count = stored[key] + 1;
  await chrome.storage.local.set({ [key]: count });
  chrome.action.setBadgeText({ text: String(count) });
  chrome.action.setBadgeBackgroundColor({ color: "#6366f1" });
  return count;
}

async function getCount() {
  const key = todayKey();
  const stored = await chrome.storage.local.get({ [key]: 0 });
  return stored[key];
}

async function handleScreenshot(message, sender) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" });
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob);

    const dpr = message.dpr || 1;
    const sx = Math.round(message.rect.x * dpr);
    const sy = Math.round(message.rect.y * dpr);
    const sw = Math.round(message.rect.width * dpr);
    const sh = Math.round(message.rect.height * dpr);

    const canvas = new OffscreenCanvas(sw, sh);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    bitmap.close();

    const pngBlob = await canvas.convertToBlob({ type: "image/png" });
    const buffer = await pngBlob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);

    return { screenshot: btoa(binary) };
  } catch (err) {
    return { error: err.message };
  }
}

async function handleSaveTweet(message) {
  const config = await getConfig();
  const url = config.backendUrl.replace(/\/+$/, "") + "/api/tweets";
  const headers = { "Content-Type": "application/json" };
  if (config.authUser && config.authPass) {
    headers["Authorization"] = "Basic " + btoa(config.authUser + ":" + config.authPass);
  }
  try {
    const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(message.tweet) });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error("HTTP " + resp.status + ": " + text.slice(0, 200));
    }
    const data = await resp.json();
    await incrementCount();
    return data;
  } catch (err) {
    await queueRetry(message.tweet);
    return { error: err.message, queued: true };
  }
}

async function handleGetStatus() {
  const config = await getConfig();
  const count = await getCount();
  try {
    const resp = await fetch(config.backendUrl.replace(/\/+$/, "") + "/api/health", {
      signal: AbortSignal.timeout(5000),
    });
    return { connected: resp.ok, dailyCount: count, backendUrl: config.backendUrl };
  } catch {
    return { connected: false, dailyCount: count, backendUrl: config.backendUrl };
  }
}

async function queueRetry(tweet) {
  const stored = await chrome.storage.local.get({ retryQueue: [] });
  const queue = stored.retryQueue;
  queue.push({ tweet, queuedAt: Date.now() });
  const oneHourAgo = Date.now() - 3600000;
  await chrome.storage.local.set({ retryQueue: queue.filter((i) => i.queuedAt > oneHourAgo) });
}

async function processRetryQueue() {
  const stored = await chrome.storage.local.get({ retryQueue: [] });
  if (stored.retryQueue.length === 0) return;
  const remaining = [];
  for (const item of stored.retryQueue) {
    if (Date.now() - item.queuedAt > 3600000) continue;
    const resp = await handleSaveTweet({ tweet: item.tweet });
    if (resp.error && !resp.queued) remaining.push(item);
  }
  await chrome.storage.local.set({ retryQueue: remaining });
}

chrome.alarms.create("retryQueue", { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "retryQueue") processRetryQueue();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CAPTURE_SCREENSHOT") { handleScreenshot(message, sender).then(sendResponse); return true; }
  if (message.type === "SAVE_TWEET") { handleSaveTweet(message).then(sendResponse); return true; }
  if (message.type === "GET_STATUS") { handleGetStatus().then(sendResponse); return true; }
});

getCount().then((c) => { if (c > 0) { chrome.action.setBadgeText({ text: String(c) }); chrome.action.setBadgeBackgroundColor({ color: "#6366f1" }); } });
```

**Step 2: Rewrite popup.html**

`extension/popup.html`:
```html
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><link rel="stylesheet" href="popup.css"></head>
<body>
  <div class="popup">
    <div class="header"><div class="logo">t</div><span class="title">tpot-digest</span></div>
    <div class="status"><span class="dot" id="dot"></span><span id="statusText">Checking...</span></div>
    <div class="count"><span id="count">0</span><span class="label">saved today</span></div>
    <hr>
    <div class="settings">
      <label>Backend URL</label>
      <input type="url" id="backendUrl" placeholder="http://localhost:8000">
      <label>Username</label>
      <input type="text" id="authUser" placeholder="(optional)">
      <label>Password</label>
      <input type="password" id="authPass" placeholder="(optional)">
      <button id="saveBtn">Save Settings</button>
      <div id="feedback"></div>
    </div>
  </div>
  <script src="popup.js"></script>
</body></html>
```

**Step 3: Rewrite popup.css**

`extension/popup.css`:
```css
*{margin:0;padding:0;box-sizing:border-box}
body{width:280px;background:#0f0f23;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px}
.popup{padding:16px}
.header{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.logo{width:28px;height:28px;background:#6366f1;border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;color:#fff}
.title{font-size:15px;font-weight:600}
.status{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#1a1a2e;border-radius:6px;margin-bottom:16px;font-size:12px;color:#94a3b8}
.dot{width:8px;height:8px;border-radius:50%;background:#475569}
.dot.ok{background:#22c55e}
.dot.fail{background:#ef4444}
.count{text-align:center;padding:12px 0}
.count span:first-child{display:block;font-size:32px;font-weight:700;color:#6366f1;line-height:1}
.count .label{font-size:12px;color:#94a3b8}
hr{border:none;height:1px;background:#1e293b;margin:12px 0}
.settings{display:flex;flex-direction:column;gap:8px}
label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em}
input{width:100%;padding:8px 10px;background:#1a1a2e;border:1px solid #1e293b;border-radius:4px;color:#e2e8f0;font-size:13px;outline:none}
input:focus{border-color:#6366f1}
input::placeholder{color:#475569}
button{margin-top:4px;padding:8px;background:#6366f1;color:#fff;border:none;border-radius:6px;font-weight:600;font-size:13px;cursor:pointer}
button:hover{background:#818cf8}
#feedback{font-size:12px;text-align:center;min-height:16px}
```

**Step 4: Rewrite popup.js**

`extension/popup.js`:
```javascript
document.addEventListener("DOMContentLoaded", () => {
  const backendUrl = document.getElementById("backendUrl");
  const authUser = document.getElementById("authUser");
  const authPass = document.getElementById("authPass");
  const dot = document.getElementById("dot");
  const statusText = document.getElementById("statusText");
  const countEl = document.getElementById("count");
  const feedback = document.getElementById("feedback");

  chrome.storage.sync.get({ backendUrl: "http://localhost:8000", authUser: "", authPass: "" }, (cfg) => {
    backendUrl.value = cfg.backendUrl;
    authUser.value = cfg.authUser;
    authPass.value = cfg.authPass;
  });

  chrome.runtime.sendMessage({ type: "GET_STATUS" }, (resp) => {
    if (resp && resp.connected) {
      dot.className = "dot ok";
      statusText.textContent = "Connected";
    } else {
      dot.className = "dot fail";
      statusText.textContent = "Cannot reach backend";
    }
    countEl.textContent = (resp && resp.dailyCount) || 0;
  });

  document.getElementById("saveBtn").addEventListener("click", () => {
    chrome.storage.sync.set({
      backendUrl: backendUrl.value.trim() || "http://localhost:8000",
      authUser: authUser.value.trim(),
      authPass: authPass.value,
    }, () => {
      feedback.textContent = "Saved!";
      feedback.style.color = "#22c55e";
      setTimeout(() => { feedback.textContent = ""; }, 1500);
    });
  });
});
```

**Step 5: Commit**

```bash
git add extension/background.js extension/popup.html extension/popup.js extension/popup.css
git commit -m "feat: v2 service worker and popup"
```

---

## Phase 4: Frontend (Tasks 12–16)

Rewrite the React dashboard from scratch.

---

### Task 12: Clean Frontend & New Design System

**Files:**
- Delete: all files in `frontend/src/` except `main.tsx` and `vite-env.d.ts`
- Create: `frontend/src/styles/design-system.css`
- Rewrite: `frontend/src/App.tsx`
- Rewrite: `frontend/src/api/client.ts`

**Step 1: Remove old frontend code**

```bash
rm -rf frontend/src/api frontend/src/components frontend/src/pages frontend/src/hooks frontend/src/styles
rm -f frontend/src/App.tsx
mkdir -p frontend/src/api frontend/src/components frontend/src/pages frontend/src/styles
```

**Step 2: Create design system CSS**

`frontend/src/styles/design-system.css`:
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --bg-base: #0f0f23;
  --bg-raised: #1a1a2e;
  --bg-elevated: #16213e;
  --bg-hover: #1e293b;

  --border: #1e293b;
  --border-strong: #334155;

  --text-primary: #e2e8f0;
  --text-secondary: #94a3b8;
  --text-tertiary: #64748b;

  --accent: #6366f1;
  --accent-hover: #818cf8;
  --accent-muted: rgba(99, 102, 241, 0.12);

  --success: #22c55e;
  --error: #ef4444;
  --warning: #f59e0b;

  --font-body: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;

  --shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
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
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
```

**Step 3: Create API client**

`frontend/src/api/client.ts`:
```typescript
import axios from 'axios'

const baseURL = import.meta.env.VITE_API_URL || '/api'

export const api = axios.create({ baseURL, timeout: 30000 })
```

**Step 4: Create App.tsx shell**

`frontend/src/App.tsx`:
```typescript
import './styles/design-system.css'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DailyView } from './pages/DailyView'
import { SettingsPage } from './pages/SettingsPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10000,
      retry: 1,
    },
  },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<DailyView />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
```

**Step 5: Create placeholder pages**

`frontend/src/pages/DailyView.tsx`:
```typescript
export function DailyView() {
  return <div style={{ padding: '24px' }}><h1>Daily View</h1><p>Coming soon</p></div>
}
```

`frontend/src/pages/SettingsPage.tsx`:
```typescript
export function SettingsPage() {
  return <div style={{ padding: '24px' }}><h1>Settings</h1><p>Coming soon</p></div>
}
```

**Step 6: Verify it compiles**

```bash
cd frontend && npx tsc --noEmit
```

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: v2 frontend shell with dark focused design system"
```

---

### Task 13: Frontend API Hooks

**Files:**
- Create: `frontend/src/api/tweets.ts`
- Create: `frontend/src/api/topics.ts`
- Create: `frontend/src/api/categories.ts`

**Step 1: Create all API hooks**

`frontend/src/api/tweets.ts`:
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface Tweet {
  id: number
  tweet_id: string
  author_handle: string
  author_display_name: string | null
  text: string
  media_urls: { urls: string[] } | null
  engagement: { likes: number; retweets: number; replies: number } | null
  is_quote_tweet: boolean
  is_reply: boolean
  thread_id: string | null
  thread_position: number | null
  screenshot_path: string | null
  feed_source: string | null
  saved_at: string
}

export function useTweets(params: {
  date?: string
  topic_id?: number
  category_id?: number
  unassigned?: boolean
  q?: string
  thread_id?: string
}) {
  return useQuery<Tweet[]>({
    queryKey: ['tweets', params],
    queryFn: async () => {
      const { data } = await api.get('/tweets', { params })
      return data
    },
  })
}

export function useAssignTweets() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { tweet_ids: number[]; topic_id: number; category_id?: number }) => {
      const { data } = await api.post('/tweets/assign', body)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tweets'] }),
  })
}

export function useUnassignTweets() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { tweet_ids: number[]; topic_id: number }) => {
      const { data } = await api.post('/tweets/unassign', body)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tweets'] }),
  })
}

export function useDeleteTweet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/tweets/${id}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tweets'] }),
  })
}
```

`frontend/src/api/topics.ts`:
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface Topic {
  id: number
  title: string
  date: string
  color: string | null
  position: number
  created_at: string
}

export function useTopics(date: string) {
  return useQuery<Topic[]>({
    queryKey: ['topics', date],
    queryFn: async () => {
      const { data } = await api.get('/topics', { params: { date } })
      return data
    },
  })
}

export function useCreateTopic() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { title: string; date: string; color?: string }) => {
      const { data } = await api.post('/topics', body)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['topics'] }),
  })
}

export function useUpdateTopic() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: number; title?: string; color?: string; position?: number }) => {
      const { data } = await api.patch(`/topics/${id}`, body)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['topics'] }),
  })
}

export function useDeleteTopic() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/topics/${id}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['topics'] }),
  })
}
```

`frontend/src/api/categories.ts`:
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface Category {
  id: number
  name: string
  color: string | null
  position: number
}

export function useCategories() {
  return useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data } = await api.get('/categories')
      return data
    },
  })
}

export function useCreateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { name: string; color?: string }) => {
      const { data } = await api.post('/categories', body)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  })
}

export function useDeleteCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/categories/${id}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  })
}
```

**Step 2: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add frontend/src/api/
git commit -m "feat: v2 frontend API hooks — tweets, topics, categories"
```

---

### Task 14: Daily View Page — Full Implementation

**Files:**
- Rewrite: `frontend/src/pages/DailyView.tsx`
- Create: `frontend/src/components/DatePicker.tsx`
- Create: `frontend/src/components/TweetCard.tsx`
- Create: `frontend/src/components/TopicSection.tsx`
- Create: `frontend/src/components/UnsortedSection.tsx`
- Create: `frontend/src/components/AssignDropdown.tsx`
- Create: `frontend/src/components/CreateTopicForm.tsx`

This is the largest task. Implement the full daily view with all components.

Use the `frontend-design` skill for this task to ensure high-quality UI implementation matching the "dark, focused, smooth" design direction.

Refer to the dashboard layout in the design doc (`docs/plans/2026-02-20-tpot-redesign-design.md` — Dashboard section) for the component structure and layout.

**Step 1: Build all components and wire into DailyView**

Follow the design doc layout:
- DatePicker: left/right arrows to navigate dates
- UnsortedSection: tweets with no topic assignment, with checkboxes and "Assign to..." dropdown
- TopicSection: collapsible section per topic showing categories and tweets
- TweetCard: screenshot thumbnail + author + text excerpt + checkbox
- AssignDropdown: picks topic + category for bulk assignment
- CreateTopicForm: inline form to create new topics

**Step 2: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add frontend/src/
git commit -m "feat: v2 daily view with topic sections, unsorted inbox, bulk assign"
```

---

### Task 15: Settings Page & Category Management

**Files:**
- Rewrite: `frontend/src/pages/SettingsPage.tsx`
- Create: `frontend/src/components/CategoryManager.tsx`

**Step 1: Build settings page with category CRUD**

CategoryManager should:
- List all categories with name, color dot, and delete button
- Inline form to create new categories
- Display backend URL info for extension configuration

**Step 2: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add frontend/src/pages/SettingsPage.tsx frontend/src/components/CategoryManager.tsx
git commit -m "feat: settings page with category management"
```

---

### Task 16: Tweet Detail Modal with Crop Tool

**Files:**
- Create: `frontend/src/components/TweetDetailModal.tsx`
- Create: `frontend/src/components/CropTool.tsx`

**Step 1: Build detail modal**

TweetDetailModal: overlay with full-size screenshot, tweet metadata, thread view if applicable.

CropTool: simple crop interface using native Canvas API (no Konva dependency). Select region, crop, download as PNG.

**Step 2: Remove Konva dependencies**

```bash
cd frontend && npm uninstall konva react-konva
```

**Step 3: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add frontend/src/components/TweetDetailModal.tsx frontend/src/components/CropTool.tsx frontend/package.json frontend/package-lock.json
git commit -m "feat: tweet detail modal with crop tool, remove Konva"
```

---

## Phase 5: Cleanup & Deployment (Tasks 17–18)

---

### Task 17: Update CLAUDE.md

**Files:**
- Rewrite: `CLAUDE.md`

**Step 1: Rewrite CLAUDE.md**

Update to reflect the v2 architecture:
- Simplified tech stack (no Playwright, no APScheduler, no Konva)
- New database schema (4 tables, not 9)
- New API endpoints
- Updated commands section
- Updated file structure

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for v2 architecture"
```

---

### Task 18: Docker Compose Updates & Cleanup

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker-compose.prod.yml`
- Modify: `backend/Dockerfile` (remove any Playwright remnants)
- Modify: `backend/pyproject.toml` (remove unused dependencies)

**Step 1: Clean up backend dependencies**

In `backend/pyproject.toml`, remove dependencies no longer needed:
- `beautifulsoup4` (was for article extraction)
- Any Playwright remnants

**Step 2: Verify Docker build**

```bash
docker compose build
```

**Step 3: Run full test suite**

```bash
backend/.venv/bin/python -m pytest backend/tests/ -v
cd frontend && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add docker-compose.yml docker-compose.prod.yml backend/Dockerfile backend/pyproject.toml
git commit -m "chore: clean up Docker and dependencies for v2"
```

---

## Dependency Order

```
Phase 1: Task 1 → Task 2 → Task 3
Phase 2: Task 4 → Task 5 → Task 6 → Task 7 → Task 8
Phase 3: Task 9 → Task 10 → Task 11
Phase 4: Task 12 → Task 13 → Task 14 → Task 15 → Task 16
Phase 5: Task 17, Task 18 (parallel)
```

Phase 2 depends on Phase 1. Phase 3 is independent of Phase 2 (extension talks to API that doesn't exist yet, but the code is self-contained). Phase 4 depends on Phase 2 (API hooks call the backend). Phase 5 depends on everything.

---

## Integration Testing Checklist

After all tasks:

1. `backend/.venv/bin/python -m pytest backend/tests/ -v` — all pass
2. `cd frontend && npx tsc --noEmit` — no errors
3. `docker compose up` — all services start
4. Load extension in Chrome → configure backend URL → save a tweet → toast confirms
5. Dashboard shows tweet in "Unsorted" section
6. Create a topic → assign tweet → tweet moves to topic section
7. Create categories → reassign tweet with category → shows under correct category
8. Click tweet → detail modal with screenshot → crop tool works
9. Settings page → create/delete categories
10. Extension badge shows save count
