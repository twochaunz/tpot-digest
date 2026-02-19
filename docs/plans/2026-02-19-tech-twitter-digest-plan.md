# Tech Twitter Daily Digest — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a feed ingestion, topic clustering, and asset organization tool for daily tech video production.

**Architecture:** Monolithic Python backend (FastAPI + Playwright + APScheduler) with React frontend, PostgreSQL with pgvector, deployed via Docker Compose. Single backend service handles scraping, AI clustering, and API. React handles dashboard views and client-side annotation.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy + Alembic, Playwright, APScheduler, React 18, Konva.js, PostgreSQL 16 + pgvector, Docker Compose

---

## Phase 1: Foundation (Tasks 1-5)

### Task 1: Project Structure & Docker Compose

**Files:**
- Create: `docker-compose.yml`
- Create: `backend/Dockerfile`
- Create: `backend/pyproject.toml`
- Create: `backend/app/__init__.py`
- Create: `backend/app/main.py`
- Create: `frontend/package.json`
- Create: `frontend/Dockerfile`
- Create: `.env.example`

**Step 1: Create docker-compose.yml**

```yaml
services:
  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: tpot_digest
      POSTGRES_USER: ${DB_USER:-tpot}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-tpot_dev}
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql+asyncpg://${DB_USER:-tpot}:${DB_PASSWORD:-tpot_dev}@db:5432/tpot_digest
      DATA_DIR: /app/data
    volumes:
      - ./backend:/app
      - ./data:/app/data
    depends_on:
      - db

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    volumes:
      - ./frontend:/app
      - /app/node_modules
    depends_on:
      - backend

volumes:
  pgdata:
```

**Step 2: Create backend Dockerfile and pyproject.toml**

`backend/Dockerfile`:
```dockerfile
FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends build-essential && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml .
RUN pip install -e ".[dev]"
RUN playwright install chromium && playwright install-deps
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
```

`backend/pyproject.toml`:
```toml
[project]
name = "tpot-digest"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.34",
    "sqlalchemy[asyncio]>=2.0",
    "asyncpg>=0.30",
    "alembic>=1.14",
    "playwright>=1.49",
    "apscheduler>=3.10",
    "pgvector>=0.3",
    "httpx>=0.28",
    "beautifulsoup4>=4.12",
    "pydantic>=2.10",
    "pydantic-settings>=2.7",
    "python-dotenv>=1.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-asyncio>=0.24", "httpx>=0.28"]

[build-system]
requires = ["setuptools>=75"]
build-backend = "setuptools.backends._legacy:_Backend"
```

**Step 3: Create FastAPI skeleton**

`backend/app/main.py`:
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="tpot-digest", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
```

**Step 4: Create React app with Vite**

```bash
cd frontend && npm create vite@latest . -- --template react-ts
npm install
```

**Step 5: Verify stack boots**

```bash
docker compose up --build -d
curl http://localhost:8000/api/health
# Expected: {"status":"ok"}
```

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: project scaffolding with Docker Compose"
```

---

### Task 2: Database Models & Migrations

**Files:**
- Create: `backend/app/config.py`
- Create: `backend/app/db.py`
- Create: `backend/app/models/__init__.py`
- Create: `backend/app/models/account.py`
- Create: `backend/app/models/tweet.py`
- Create: `backend/app/models/topic.py`
- Create: `backend/app/models/screenshot.py`
- Create: `backend/app/models/article.py`
- Create: `backend/alembic.ini`
- Create: `backend/alembic/env.py`
- Test: `backend/tests/test_models.py`

**Step 1: Create config and DB session**

`backend/app/config.py`:
```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://tpot:tpot_dev@localhost:5432/tpot_digest"
    data_dir: str = "./data"

    model_config = {"env_file": ".env"}


settings = Settings()
```

`backend/app/db.py`:
```python
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(settings.database_url)
async_session = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with async_session() as session:
        yield session
```

**Step 2: Create all models**

`backend/app/models/account.py`:
```python
import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AccountSource(str, enum.Enum):
    SEED = "seed"
    AUTO_DISCOVERED = "auto_discovered"
    MANUAL = "manual"


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    handle: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    display_name: Mapped[str | None] = mapped_column(String(255))
    pfp_url: Mapped[str | None] = mapped_column(String(2048))
    source: Mapped[AccountSource] = mapped_column(Enum(AccountSource), default=AccountSource.SEED)
    priority: Mapped[int] = mapped_column(Integer, default=2)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    is_boosted: Mapped[bool] = mapped_column(Boolean, default=False)
    follower_count: Mapped[int | None] = mapped_column(Integer)
    frequency_cap: Mapped[int | None] = mapped_column(Integer)
    added_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
```

`backend/app/models/tweet.py`:
```python
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Tweet(Base):
    __tablename__ = "tweets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tweet_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    author_handle: Mapped[str] = mapped_column(String(255), index=True)
    text: Mapped[str] = mapped_column(Text)
    media_urls: Mapped[dict | None] = mapped_column(JSONB)
    article_urls: Mapped[dict | None] = mapped_column(JSONB)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime)
    scraped_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    engagement: Mapped[dict | None] = mapped_column(JSONB)
    engagement_velocity: Mapped[float | None] = mapped_column()
    is_retweet: Mapped[bool] = mapped_column(default=False)
    is_quote_tweet: Mapped[bool] = mapped_column(default=False)
    quoted_tweet_id: Mapped[str | None] = mapped_column(String(64))
    quality_score: Mapped[float | None] = mapped_column()
    feed_source: Mapped[str | None] = mapped_column(String(32))

    account = relationship("Account", lazy="selectin")
    screenshots = relationship("Screenshot", back_populates="tweet", lazy="selectin")


class EngagementSnapshot(Base):
    __tablename__ = "engagement_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tweet_id: Mapped[int] = mapped_column(ForeignKey("tweets.id"), index=True)
    likes: Mapped[int] = mapped_column(BigInteger, default=0)
    retweets: Mapped[int] = mapped_column(BigInteger, default=0)
    replies: Mapped[int] = mapped_column(BigInteger, default=0)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
```

`backend/app/models/topic.py`:
```python
import enum
from datetime import date, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import Date, DateTime, Enum, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class LifecycleStatus(str, enum.Enum):
    EMERGING = "emerging"
    TRENDING = "trending"
    PEAKED = "peaked"
    FADING = "fading"


class Topic(Base):
    __tablename__ = "topics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    title: Mapped[str] = mapped_column(String(512))
    summary: Mapped[str | None] = mapped_column(Text)
    rank: Mapped[int] = mapped_column(Integer, default=0)
    lifecycle_status: Mapped[LifecycleStatus] = mapped_column(
        Enum(LifecycleStatus), default=LifecycleStatus.EMERGING
    )
    sentiment: Mapped[str | None] = mapped_column(String(32))
    tags: Mapped[dict | None] = mapped_column(JSONB)
    embedding: Mapped[list | None] = mapped_column(Vector(1536))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    subtopics = relationship("SubTopic", back_populates="topic", lazy="selectin")


class SubTopic(Base):
    __tablename__ = "subtopics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    topic_id: Mapped[int] = mapped_column(ForeignKey("topics.id"), index=True)
    title: Mapped[str] = mapped_column(String(512))
    summary: Mapped[str | None] = mapped_column(Text)
    sentiment: Mapped[str | None] = mapped_column(String(32))
    rank: Mapped[int] = mapped_column(Integer, default=0)

    topic = relationship("Topic", back_populates="subtopics")
    tweets = relationship("SubTopicTweet", back_populates="subtopic", lazy="selectin")


class SubTopicTweet(Base):
    __tablename__ = "subtopic_tweets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subtopic_id: Mapped[int] = mapped_column(ForeignKey("subtopics.id"), index=True)
    tweet_id: Mapped[int] = mapped_column(ForeignKey("tweets.id"), index=True)
    relevance_score: Mapped[float] = mapped_column(Float, default=0.0)
    stance: Mapped[str | None] = mapped_column(String(64))

    subtopic = relationship("SubTopic", back_populates="tweets")
    tweet = relationship("Tweet")


class TopicEdge(Base):
    __tablename__ = "topic_edges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_topic_id: Mapped[int] = mapped_column(ForeignKey("topics.id"), index=True)
    target_topic_id: Mapped[int] = mapped_column(ForeignKey("topics.id"), index=True)
    relationship_type: Mapped[str] = mapped_column(String(64))
    strength: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
```

`backend/app/models/screenshot.py`:
```python
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Screenshot(Base):
    __tablename__ = "screenshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tweet_id: Mapped[int | None] = mapped_column(ForeignKey("tweets.id"))
    article_id: Mapped[int | None] = mapped_column(ForeignKey("articles.id"))
    file_path: Mapped[str] = mapped_column(String(1024))
    annotated_file_path: Mapped[str | None] = mapped_column(String(1024))
    annotations_json: Mapped[dict | None] = mapped_column(JSONB)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    captured_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    tweet = relationship("Tweet", back_populates="screenshots")
```

`backend/app/models/article.py`:
```python
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Article(Base):
    __tablename__ = "articles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tweet_id: Mapped[int | None] = mapped_column(ForeignKey("tweets.id"), index=True)
    url: Mapped[str] = mapped_column(String(2048))
    archive_url: Mapped[str | None] = mapped_column(String(2048))
    title: Mapped[str | None] = mapped_column(String(1024))
    author: Mapped[str | None] = mapped_column(String(512))
    publication: Mapped[str | None] = mapped_column(String(512))
    full_text: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text)
    extracted_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
```

`backend/app/models/__init__.py`:
```python
from app.models.account import Account, AccountSource
from app.models.article import Article
from app.models.screenshot import Screenshot
from app.models.topic import LifecycleStatus, SubTopic, SubTopicTweet, Topic, TopicEdge
from app.models.tweet import EngagementSnapshot, Tweet

__all__ = [
    "Account", "AccountSource",
    "Tweet", "EngagementSnapshot",
    "Topic", "SubTopic", "SubTopicTweet", "TopicEdge", "LifecycleStatus",
    "Screenshot",
    "Article",
]
```

**Step 3: Set up Alembic**

```bash
cd backend && alembic init alembic
```

Edit `backend/alembic/env.py` to import models and use async engine. Edit `backend/alembic.ini` to use env var for sqlalchemy.url.

```bash
alembic revision --autogenerate -m "initial models"
alembic upgrade head
```

**Step 4: Write model smoke test**

`backend/tests/test_models.py`:
```python
from app.models import Account, AccountSource, Topic, LifecycleStatus


def test_account_defaults():
    account = Account(handle="testuser")
    assert account.handle == "testuser"
    assert account.priority == 2
    assert account.is_active is True


def test_topic_defaults():
    topic = Topic(title="Test Topic")
    assert topic.lifecycle_status == LifecycleStatus.EMERGING
    assert topic.rank == 0
```

**Step 5: Run tests**

```bash
cd backend && pytest tests/test_models.py -v
```

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: database models and migrations"
```

---

### Task 3: Account CRUD API

**Files:**
- Create: `backend/app/routers/__init__.py`
- Create: `backend/app/routers/accounts.py`
- Create: `backend/app/schemas/__init__.py`
- Create: `backend/app/schemas/account.py`
- Modify: `backend/app/main.py` (register router)
- Test: `backend/tests/test_accounts_api.py`

**Step 1: Write failing test**

`backend/tests/test_accounts_api.py`:
```python
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_create_account(client):
    resp = await client.post("/api/accounts", json={"handle": "karpathy"})
    assert resp.status_code == 201
    assert resp.json()["handle"] == "karpathy"


@pytest.mark.asyncio
async def test_list_accounts(client):
    resp = await client.get("/api/accounts")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
```

**Step 2: Run test to verify it fails**

```bash
pytest backend/tests/test_accounts_api.py -v
# Expected: FAIL - no route
```

**Step 3: Implement schemas and router**

`backend/app/schemas/account.py`:
```python
from pydantic import BaseModel


class AccountCreate(BaseModel):
    handle: str
    display_name: str | None = None
    source: str = "seed"
    priority: int = 2


class AccountUpdate(BaseModel):
    display_name: str | None = None
    priority: int | None = None
    is_active: bool | None = None
    is_blocked: bool | None = None
    is_boosted: bool | None = None
    frequency_cap: int | None = None


class AccountOut(BaseModel):
    id: int
    handle: str
    display_name: str | None
    source: str
    priority: int
    is_active: bool
    is_blocked: bool
    is_boosted: bool
    follower_count: int | None

    model_config = {"from_attributes": True}
```

`backend/app/routers/accounts.py`:
```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.account import Account, AccountSource
from app.schemas.account import AccountCreate, AccountOut, AccountUpdate

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


@router.get("", response_model=list[AccountOut])
async def list_accounts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Account).order_by(Account.priority))
    return result.scalars().all()


@router.post("", response_model=AccountOut, status_code=201)
async def create_account(body: AccountCreate, db: AsyncSession = Depends(get_db)):
    account = Account(
        handle=body.handle,
        display_name=body.display_name,
        source=AccountSource(body.source),
        priority=body.priority,
    )
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return account


@router.patch("/{account_id}", response_model=AccountOut)
async def update_account(account_id: int, body: AccountUpdate, db: AsyncSession = Depends(get_db)):
    account = await db.get(Account, account_id)
    if not account:
        raise HTTPException(404, "Account not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(account, field, value)
    await db.commit()
    await db.refresh(account)
    return account


@router.delete("/{account_id}", status_code=204)
async def delete_account(account_id: int, db: AsyncSession = Depends(get_db)):
    account = await db.get(Account, account_id)
    if not account:
        raise HTTPException(404, "Account not found")
    await db.delete(account)
    await db.commit()
```

Register in `backend/app/main.py`:
```python
from app.routers.accounts import router as accounts_router
app.include_router(accounts_router)
```

**Step 4: Run tests**

```bash
pytest backend/tests/test_accounts_api.py -v
# Expected: PASS
```

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: account CRUD API"
```

---

### Task 4: Tweet Storage API

**Files:**
- Create: `backend/app/routers/tweets.py`
- Create: `backend/app/schemas/tweet.py`
- Modify: `backend/app/main.py` (register router)
- Test: `backend/tests/test_tweets_api.py`

**Step 1: Write failing test**

`backend/tests/test_tweets_api.py`:
```python
@pytest.mark.asyncio
async def test_create_tweet(client):
    resp = await client.post("/api/tweets", json={
        "tweet_id": "123456",
        "author_handle": "karpathy",
        "text": "GPT-5 just dropped",
    })
    assert resp.status_code == 201
    assert resp.json()["tweet_id"] == "123456"


@pytest.mark.asyncio
async def test_manual_url_input(client):
    resp = await client.post("/api/tweets/from-url", json={
        "url": "https://x.com/karpathy/status/123456"
    })
    assert resp.status_code == 201
```

**Step 2: Run test to verify it fails**

**Step 3: Implement tweet schemas, router with manual URL endpoint**

Follow same pattern as accounts. The `from-url` endpoint extracts the tweet ID from the URL and queues a scrape + screenshot job.

**Step 4: Run tests, verify pass**

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: tweet storage API with manual URL input"
```

---

### Task 5: Topic & SubTopic CRUD API

**Files:**
- Create: `backend/app/routers/topics.py`
- Create: `backend/app/schemas/topic.py`
- Modify: `backend/app/main.py` (register router)
- Test: `backend/tests/test_topics_api.py`

Same CRUD pattern. Endpoints:
- `GET /api/topics?date=2026-02-19` — list topics for a date
- `GET /api/topics/:id` — topic detail with subtopics and tweets
- `POST /api/topics` — create topic
- `PATCH /api/topics/:id` — update topic (status, rank, etc.)
- `POST /api/topics/:id/subtopics` — create subtopic
- `POST /api/subtopics/:id/tweets` — link tweet to subtopic

**Commit:** `git commit -m "feat: topic and subtopic CRUD API"`

---

## Phase 2: Feed Ingestion (Tasks 6-9)

### Task 6: Playwright Twitter Auth Session

**Files:**
- Create: `backend/app/scraper/__init__.py`
- Create: `backend/app/scraper/browser.py`
- Create: `backend/app/scraper/auth.py`
- Test: `backend/tests/test_browser.py`

**Step 1: Write failing test**

```python
@pytest.mark.asyncio
async def test_browser_context_creates():
    from app.scraper.browser import get_browser_context
    ctx = await get_browser_context()
    assert ctx is not None
    await ctx.close()
```

**Step 2: Implement browser manager**

`backend/app/scraper/browser.py`:
```python
from pathlib import Path
from playwright.async_api import async_playwright, BrowserContext

STORAGE_PATH = Path("browser_state/twitter_session.json")


async def get_browser_context() -> BrowserContext:
    pw = await async_playwright().start()
    browser = await pw.chromium.launch(headless=True)
    if STORAGE_PATH.exists():
        context = await browser.new_context(
            storage_state=str(STORAGE_PATH),
            device_scale_factor=2,
            viewport={"width": 1280, "height": 900},
        )
    else:
        context = await browser.new_context(
            device_scale_factor=2,
            viewport={"width": 1280, "height": 900},
        )
    return context


async def save_session(context: BrowserContext):
    STORAGE_PATH.parent.mkdir(exist_ok=True)
    await context.storage_state(path=str(STORAGE_PATH))
```

**Step 3: Create auth helper** — endpoint that opens a headed browser for manual login, then saves the session.

`backend/app/scraper/auth.py`:
```python
from playwright.async_api import async_playwright
from app.scraper.browser import STORAGE_PATH


async def interactive_login():
    """Opens a headed browser for manual Twitter login. Saves session after."""
    pw = await async_playwright().start()
    browser = await pw.chromium.launch(headless=False)
    context = await browser.new_context()
    page = await context.new_page()
    await page.goto("https://x.com/login")
    input("Press Enter after logging in...")
    STORAGE_PATH.parent.mkdir(exist_ok=True)
    await context.storage_state(path=str(STORAGE_PATH))
    await browser.close()
```

**Step 4: Run tests, commit**

```bash
git commit -m "feat: Playwright browser session management"
```

---

### Task 7: Feed Scraper — For You & Following

**Files:**
- Create: `backend/app/scraper/feed.py`
- Create: `backend/app/scraper/parser.py`
- Test: `backend/tests/test_feed_parser.py`

**Step 1: Write failing test for tweet parser**

```python
def test_parse_tweet_element():
    from app.scraper.parser import parse_tweet_html
    raw = {
        "author_handle": "karpathy",
        "text": "GPT-5 is amazing",
        "tweet_id": "123",
        "likes": 5000,
        "retweets": 1200,
        "replies": 300,
    }
    result = parse_tweet_html(raw)
    assert result["author_handle"] == "karpathy"
    assert result["engagement"]["likes"] == 5000
```

**Step 2: Implement feed scraper**

`backend/app/scraper/feed.py` — scrolls For You feed, extracts tweet elements from DOM, passes to parser. Returns list of raw tweet dicts.

Key behaviors:
- Scroll N pages (configurable)
- Extract: author handle, tweet text, tweet ID (from URL), media URLs, engagement counts, whether it's a retweet/quote tweet
- Detect article URLs in tweet cards
- Return raw dicts for the quality pipeline

`backend/app/scraper/parser.py` — normalizes raw DOM data into structured tweet dicts.

**Step 3: Run tests, commit**

```bash
git commit -m "feat: feed scraper for For You and Following feeds"
```

---

### Task 8: Quality Filtering Pipeline

**Files:**
- Create: `backend/app/pipeline/__init__.py`
- Create: `backend/app/pipeline/quality.py`
- Test: `backend/tests/test_quality_filter.py`

**Step 1: Write failing tests**

```python
def test_network_proximity_boosts_score():
    from app.pipeline.quality import compute_quality_score
    seed_handles = {"karpathy", "sama", "elonmusk"}
    tweet = {"author_handle": "random_user", "mutual_follows": 3}
    score = compute_quality_score(tweet, seed_handles)
    assert score > 0.5


def test_blocked_account_gets_zero():
    from app.pipeline.quality import compute_quality_score
    tweet = {"author_handle": "spammer"}
    score = compute_quality_score(tweet, set(), blocked={"spammer"})
    assert score == 0.0


def test_slop_detection_dilutes_score():
    from app.pipeline.quality import compute_quality_score
    tweet = {"author_handle": "prolific_poster", "author_tweet_count_24h": 40}
    score = compute_quality_score(tweet, set())
    assert score < 0.3
```

**Step 2: Implement quality pipeline**

`backend/app/pipeline/quality.py`:
- `compute_quality_score(tweet, seed_handles, blocked, boosted, threshold)` — returns 0.0-1.0
- Network proximity: mutual follows with seed list → higher weight
- Blocked accounts → 0.0
- Boosted accounts → 1.0 (bypass)
- Slop detection: >20 tweets/24h → diluted score
- Diversity cap check happens at the topic level, not individual tweet level

**Step 3: Run tests, commit**

```bash
git commit -m "feat: quality filtering pipeline"
```

---

### Task 9: Scheduled Scraper Job

**Files:**
- Create: `backend/app/scheduler.py`
- Modify: `backend/app/main.py` (start scheduler on startup)
- Test: `backend/tests/test_scheduler.py`

**Step 1: Implement scheduler**

`backend/app/scheduler.py`:
```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.scraper.feed import scrape_feed
from app.pipeline.quality import filter_tweets

scheduler = AsyncIOScheduler()


async def scrape_job():
    """Runs on schedule: scrape feed, filter, store."""
    raw_tweets = await scrape_feed("for_you")
    raw_tweets += await scrape_feed("following")
    filtered = await filter_tweets(raw_tweets)
    # Store to DB, trigger topic clustering, take screenshots
    ...


def start_scheduler():
    scheduler.add_job(scrape_job, "interval", hours=2)
    scheduler.start()
```

Register in `main.py` via lifespan event.

**Step 2: Commit**

```bash
git commit -m "feat: scheduled feed scraping with APScheduler"
```

---

## Phase 3: Intelligence Layer (Tasks 10-12)

### Task 10: AI Topic Clustering — Pass 1 (Topics)

**Files:**
- Create: `backend/app/pipeline/clustering.py`
- Create: `backend/app/pipeline/llm.py`
- Test: `backend/tests/test_clustering.py`

**Step 1: Write failing test**

```python
@pytest.mark.asyncio
async def test_cluster_tweets_into_topics():
    from app.pipeline.clustering import cluster_into_topics
    tweets = [
        {"text": "Claude 4 just launched! Amazing benchmarks"},
        {"text": "Anthropic releases Claude 4 today"},
        {"text": "OpenAI announces new funding round"},
        {"text": "Series B for OpenAI at $300B valuation"},
    ]
    topics = await cluster_into_topics(tweets)
    assert len(topics) == 2
    assert any("Claude" in t["title"] for t in topics)
    assert any("OpenAI" in t["title"] or "funding" in t["title"] for t in topics)
```

**Step 2: Implement LLM client and clustering**

`backend/app/pipeline/llm.py` — thin wrapper around Anthropic/OpenAI API for structured output. Takes a list of tweet texts, returns topic clusters.

`backend/app/pipeline/clustering.py`:
- `cluster_into_topics(tweets)` — Pass 1: group tweets into topics using LLM
- Uses engagement velocity + network convergence signals as weighting input to the LLM prompt
- Returns list of topic dicts with title, summary, assigned tweet IDs

**Step 3: Run tests, commit**

```bash
git commit -m "feat: AI topic clustering pass 1"
```

---

### Task 11: AI Sub-Topic Identification — Pass 2

**Files:**
- Modify: `backend/app/pipeline/clustering.py`
- Test: `backend/tests/test_subtopic_clustering.py`

**Step 1: Write failing test**

```python
@pytest.mark.asyncio
async def test_identify_subtopics():
    from app.pipeline.clustering import identify_subtopics
    topic_tweets = [
        {"text": "Claude 4 benchmarks are incredible!"},
        {"text": "So excited about Claude 4 launch"},
        {"text": "Wait, these benchmarks look manipulated"},
        {"text": "The benchmark methodology is flawed"},
    ]
    subtopics = await identify_subtopics("Claude 4 Launch", topic_tweets)
    assert len(subtopics) >= 2
```

**Step 2: Implement sub-topic clustering**

- `identify_subtopics(topic_title, tweets)` — Pass 2: within a topic, find narrative threads
- LLM identifies distinct angles/takes and groups tweets accordingly
- Returns subtopics with title, summary, sentiment, stance per tweet

**Step 3: Run tests, commit**

```bash
git commit -m "feat: AI sub-topic identification pass 2"
```

---

### Task 12: Topic Lifecycle & Engagement Refresh

**Files:**
- Create: `backend/app/pipeline/lifecycle.py`
- Modify: `backend/app/scheduler.py` (add refresh job)
- Test: `backend/tests/test_lifecycle.py`

**Step 1: Write failing test**

```python
def test_lifecycle_transition():
    from app.pipeline.lifecycle import compute_lifecycle_status
    # High velocity = trending
    assert compute_lifecycle_status(velocity=500, prev_status="emerging") == "trending"
    # Declining velocity = peaked
    assert compute_lifecycle_status(velocity=-50, prev_status="trending") == "peaked"
```

**Step 2: Implement lifecycle manager**

- `compute_lifecycle_status(velocity, prev_status)` — state machine for topic lifecycle
- `refresh_engagement(tweet_ids)` — re-scrape engagement numbers for active tweets
- `bridge_cross_day_topics()` — check EMERGING/TRENDING topics from yesterday, link to today if re-surging

**Step 3: Run tests, commit**

```bash
git commit -m "feat: topic lifecycle management and engagement refresh"
```

---

## Phase 4: Asset Capture (Tasks 13-15)

### Task 13: Tweet Screenshot Engine

**Files:**
- Create: `backend/app/scraper/screenshot.py`
- Test: `backend/tests/test_screenshot.py`

Implements clean tweet capture: load tweet URL, CSS-inject to hide engagement bar and replies, crop to PFP + handle + text + media, save at 2x DPR as PNG.

**Commit:** `git commit -m "feat: clean tweet screenshot engine"`

---

### Task 14: Filesystem Organization

**Files:**
- Create: `backend/app/storage.py`
- Test: `backend/tests/test_storage.py`

Implements the `data/YYYYMMDD/01-topic/01-subtopic/tweets/` folder structure. Creates directories, writes metadata.json files, manages numbered prefixes for ranking.

**Commit:** `git commit -m "feat: filesystem organization with date/topic/subtopic structure"`

---

### Task 15: Article Extraction

**Files:**
- Create: `backend/app/scraper/article.py`
- Test: `backend/tests/test_article.py`

Detects URLs in tweets, fetches articles (httpx + BeautifulSoup), falls back to Archive.ph for paywalled content, extracts title/author/full text, generates AI summary. Stores in subtopic article folder.

**Commit:** `git commit -m "feat: article extraction with Archive.ph fallback"`

---

## Phase 5: Dashboard Frontend (Tasks 16-22)

### Task 16: React App Shell & Routing

**Files:**
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/pages/TodaysFeed.tsx`
- Create: `frontend/src/pages/TopicDetail.tsx`
- Create: `frontend/src/pages/GraphExplorer.tsx`
- Create: `frontend/src/pages/AssetManager.tsx`
- Create: `frontend/src/pages/Settings.tsx`
- Install: `react-router-dom`, `@tanstack/react-query`, `axios`

Set up routing for all 5 dashboard views. TanStack Query for data fetching. Basic nav sidebar.

**Commit:** `git commit -m "feat: React app shell with routing"`

---

### Task 17: Today's Feed View

**Files:**
- Create: `frontend/src/components/TopicCard.tsx`
- Create: `frontend/src/components/LifecycleBadge.tsx`
- Modify: `frontend/src/pages/TodaysFeed.tsx`

Displays today's topics ranked by momentum. Each topic card shows title, lifecycle status badge, sub-topic count, tweet count. Expandable to show sub-topics. Auto-refreshes.

**Commit:** `git commit -m "feat: Today's Feed dashboard view"`

---

### Task 18: Topic Detail View

**Files:**
- Create: `frontend/src/components/SubTopicPanel.tsx`
- Create: `frontend/src/components/TweetCard.tsx`
- Modify: `frontend/src/pages/TopicDetail.tsx`

Shows all subtopics with tweet clusters. Each tweet shows screenshot thumbnail. Click opens annotation editor (Task 20). Shows sentiment breakdown. Links to articles.

**Commit:** `git commit -m "feat: Topic Detail view with subtopics"`

---

### Task 19: Article Viewer

**Files:**
- Create: `frontend/src/components/ArticleViewer.tsx`
- Create: `frontend/src/components/ArticleSplitView.tsx`

Split view: tweet screenshot on left, clean article reader on right. Segment selection for extraction. Screenshot capture button for article sections.

**Commit:** `git commit -m "feat: embedded article viewer with split view"`

---

### Task 20: Annotation Toolkit

**Files:**
- Create: `frontend/src/components/AnnotationEditor.tsx`
- Create: `frontend/src/components/tools/HighlightTool.tsx`
- Create: `frontend/src/components/tools/BoxTool.tsx`
- Create: `frontend/src/components/tools/FreehandTool.tsx`
- Create: `frontend/src/components/tools/ColorPicker.tsx`
- Install: `konva`, `react-konva`

Canvas-based editor with Konva.js. Tools: text highlight (colored overlay), box/rectangle (with optional dim outside), freehand draw, color picker, undo/redo. Exports original + annotated PNG + annotations JSON.

**Commit:** `git commit -m "feat: annotation toolkit with highlight, box, and freehand tools"`

---

### Task 21: Settings View

**Files:**
- Create: `frontend/src/components/AccountManager.tsx`
- Create: `frontend/src/components/FilterControls.tsx`
- Modify: `frontend/src/pages/Settings.tsx`

Manage seed accounts (add/remove/tag/prioritize). Review auto-discovered suggestions. Tune quality filters (blocklist, boost list, relevance threshold slider, frequency caps). Scrape schedule config. Manual tweet URL input.

**Commit:** `git commit -m "feat: Settings view with account and filter management"`

---

### Task 22: Asset Manager & Bulk Download

**Files:**
- Create: `frontend/src/components/FolderBrowser.tsx`
- Create: `frontend/src/components/AssetGrid.tsx`
- Modify: `frontend/src/pages/AssetManager.tsx`
- Create: `backend/app/routers/assets.py`

Browse YYYYMMDD folder structure. Asset grid with original + annotated side by side. Multi-select with checkboxes. Bulk download as zip (backend generates zip on the fly).

**Commit:** `git commit -m "feat: asset manager with bulk download"`

---

## Phase 6: Knowledge Graph (Tasks 23-25)

### Task 23: Topic Embedding & Edge Formation

**Files:**
- Create: `backend/app/pipeline/graph.py`
- Test: `backend/tests/test_graph.py`

Generate topic embeddings (OpenAI/Anthropic embeddings API), store in pgvector. Compute edges: semantic similarity (cosine distance), entity overlap (NER on topic summaries), narrative continuation detection. Run after each clustering pass.

**Commit:** `git commit -m "feat: topic knowledge graph edge formation"`

---

### Task 24: Graph Query API

**Files:**
- Create: `backend/app/routers/graph.py`
- Test: `backend/tests/test_graph_api.py`

Endpoints:
- `GET /api/graph?date_from=&date_to=&tags=&entity=` — return nodes and edges for visualization
- `GET /api/graph/search?q=anthropic` — semantic search across all topics
- `POST /api/graph/link` — manually link two topics

**Commit:** `git commit -m "feat: knowledge graph query API"`

---

### Task 25: Graph Explorer Frontend

**Files:**
- Modify: `frontend/src/pages/GraphExplorer.tsx`
- Install: `react-force-graph-2d` or `@visx/network`

Interactive graph visualization. Filter by date range, tags, entities, sentiment. Click node to navigate to topic detail. Zoom, pan, search.

**Commit:** `git commit -m "feat: Graph Explorer interactive visualization"`

---

## Phase 7: Integration & Polish (Tasks 26-28)

### Task 26: End-to-End Pipeline Integration

**Files:**
- Modify: `backend/app/scheduler.py`

Wire everything together: scrape → filter → cluster → sub-cluster → screenshot → store → filesystem → graph edges. Verify full pipeline runs end-to-end on schedule.

**Commit:** `git commit -m "feat: end-to-end pipeline integration"`

---

### Task 27: Content Relevance Classifier

**Files:**
- Create: `backend/app/pipeline/relevance.py`
- Test: `backend/tests/test_relevance.py`

Lightweight LLM call to classify tweets as tech-relevant or noise. Integrates into quality pipeline. Configurable threshold via dashboard settings.

**Commit:** `git commit -m "feat: LLM-based content relevance classifier"`

---

### Task 28: Auto-Discovery of New Accounts

**Files:**
- Create: `backend/app/pipeline/discovery.py`
- Test: `backend/tests/test_discovery.py`

Track who seed accounts engage with most frequently. Compute engagement graph. Surface top candidates as suggestions in dashboard. User approves/rejects.

**Commit:** `git commit -m "feat: auto-discovery of high-signal accounts"`

---

## Dependency Order

```
Phase 1: [Task 1] → [Task 2] → [Tasks 3,4,5 parallel]
Phase 2: [Task 6] → [Task 7] → [Task 8] → [Task 9]
Phase 3: [Tasks 10,11 sequential] → [Task 12]
Phase 4: [Task 13] → [Task 14] → [Task 15]
Phase 5: [Task 16] → [Tasks 17-22 mostly parallel]
Phase 6: [Task 23] → [Task 24] → [Task 25]
Phase 7: [Task 26] → [Tasks 27,28 parallel]
```

Phases 1-4 (backend) can overlap with Phase 5 (frontend) once Task 5 is done and API contracts are established.
