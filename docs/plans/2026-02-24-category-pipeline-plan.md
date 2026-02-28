# Category Pipeline + Context Menu Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace dynamic categories table with hardcoded universal categories, fix the broken category display pipeline, and add "Set Category" submenu to the tweet context menu.

**Architecture:** Migrate `tweet_assignments.category_id` (FK) to `tweet_assignments.category` (string). Remove the `categories` table, model, router, and frontend CRUD. Hardcode 6 universal categories as a frontend constant. Fix `list_tweets` to return category via join. Fix `TopicSection` to group by category. Add category submenu to `ContextMenu`.

**Tech Stack:** Python/FastAPI/SQLAlchemy (backend), React/TypeScript (frontend), Alembic (migrations)

---

### Task 1: Alembic migration — category_id to category string

**Files:**
- Create: `backend/alembic/versions/008_category_string.py`

**Step 1: Create the migration**

```python
"""Replace category_id FK with category string

Revision ID: 008
Revises: 007_add_og_tweet_id
"""
from alembic import op
import sqlalchemy as sa

revision = "008_category_string"
down_revision = "007_add_og_tweet_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add category string column
    op.add_column("tweet_assignments", sa.Column("category", sa.String(64), nullable=True))

    # 2. Copy category names from categories table
    op.execute("""
        UPDATE tweet_assignments
        SET category = (SELECT name FROM categories WHERE categories.id = tweet_assignments.category_id)
        WHERE category_id IS NOT NULL
    """)

    # 3. Drop category_id FK column
    op.drop_constraint("tweet_assignments_category_id_fkey", "tweet_assignments", type_="foreignkey")
    op.drop_column("tweet_assignments", "category_id")

    # 4. Drop categories table
    op.drop_table("categories")


def downgrade() -> None:
    # Recreate categories table
    op.create_table(
        "categories",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), unique=True),
        sa.Column("color", sa.String(7)),
        sa.Column("position", sa.Integer, default=0),
    )
    # Add back category_id column
    op.add_column("tweet_assignments", sa.Column("category_id", sa.Integer, sa.ForeignKey("categories.id", ondelete="SET NULL")))
    # Drop category string column
    op.drop_column("tweet_assignments", "category")
```

**Step 2: Commit**

```bash
git add backend/alembic/versions/008_category_string.py
git commit -m "feat: migration to replace category_id FK with category string"
```

---

### Task 2: Backend model, schema, and router changes

**Files:**
- Delete: `backend/app/models/category.py`
- Delete: `backend/app/routers/categories.py`
- Delete: `backend/app/schemas/category.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/models/assignment.py`
- Modify: `backend/app/schemas/tweet.py`
- Modify: `backend/app/routers/tweets.py`
- Modify: `backend/app/main.py`

**Step 1: Update TweetAssignment model**

In `backend/app/models/assignment.py`, replace `category_id` FK with `category` string:

```python
from sqlalchemy import Integer, String, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TweetAssignment(Base):
    __tablename__ = "tweet_assignments"
    __table_args__ = (UniqueConstraint("tweet_id", "topic_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tweet_id: Mapped[int] = mapped_column(ForeignKey("tweets.id", ondelete="CASCADE"), index=True)
    topic_id: Mapped[int] = mapped_column(ForeignKey("topics.id", ondelete="CASCADE"), index=True)
    category: Mapped[str | None] = mapped_column(String(64))

    def __repr__(self) -> str:
        return f"<TweetAssignment id={self.id} tweet_id={self.tweet_id} topic_id={self.topic_id}>"
```

**Step 2: Update models __init__.py**

Remove Category import:

```python
from app.models.assignment import TweetAssignment
from app.models.topic import Topic
from app.models.tweet import Tweet
from app.models.waitlist import WaitlistEntry

__all__ = ["Tweet", "Topic", "TweetAssignment", "WaitlistEntry"]
```

**Step 3: Delete category model, router, and schema files**

```bash
rm backend/app/models/category.py
rm backend/app/routers/categories.py
rm backend/app/schemas/category.py
```

**Step 4: Update tweet schemas**

In `backend/app/schemas/tweet.py`:
- Change `TweetSave.category_id` to `category: str | None = None`
- Add `category: str | None = None` to `TweetOut`
- Change `TweetAssignRequest.category_id` to `category: str | None = None`

Full file:

```python
from datetime import datetime
from typing import Any

from pydantic import BaseModel


class TweetSave(BaseModel):
    tweet_id: str
    feed_source: str | None = None
    thread_id: str | None = None
    thread_position: int | None = None
    topic_id: int | None = None
    category: str | None = None
    saved_at: datetime | None = None


class TweetOut(BaseModel):
    id: int
    tweet_id: str
    author_handle: str
    author_display_name: str | None
    author_avatar_url: str | None
    author_verified: bool
    text: str
    media_urls: Any | None
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
    url: str | None
    created_at: datetime | None
    memo: str | None
    grok_context: str | None
    saved_at: datetime
    category: str | None = None
    status: str = "saved"

    model_config = {"from_attributes": True}


class TweetUpdate(BaseModel):
    memo: str | None = None
    saved_at: datetime | None = None


class TweetCheckRequest(BaseModel):
    tweet_ids: list[str]


class TweetAssignRequest(BaseModel):
    tweet_ids: list[int]
    topic_id: int
    category: str | None = None


class TweetUnassignRequest(BaseModel):
    tweet_ids: list[int]
    topic_id: int
```

**Step 5: Update tweets router**

In `backend/app/routers/tweets.py`, make these changes:

a) In `save_tweet()`: change `body.category_id` to `body.category`:
```python
    if body.topic_id:
        assignment = TweetAssignment(
            tweet_id=tweet.id, topic_id=body.topic_id, category=body.category
        )
        db.add(assignment)
```

b) In `list_tweets()`: when `topic_id` is provided, join with TweetAssignment to return category. Replace the entire function:

```python
@router.get("", response_model=list[TweetOut])
async def list_tweets(
    date: date | None = Query(None),
    topic_id: int | None = Query(None),
    category: str | None = Query(None),
    unassigned: bool = Query(False),
    q: str | None = Query(None),
    thread_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    if topic_id:
        # Join with TweetAssignment to get category
        stmt = select(Tweet, TweetAssignment.category).join(
            TweetAssignment, TweetAssignment.tweet_id == Tweet.id
        ).where(TweetAssignment.topic_id == topic_id)

        if category:
            stmt = stmt.where(TweetAssignment.category == category)
    else:
        stmt = select(Tweet)

    if date:
        from sqlalchemy import func, text
        local_date = func.date(func.timezone(text("'America/Los_Angeles'"), Tweet.saved_at))
        stmt = stmt.where(local_date == date)

    if unassigned:
        all_assigned = select(TweetAssignment.tweet_id)
        stmt = stmt.where(Tweet.id.not_in(all_assigned))

    if q:
        stmt = stmt.where(Tweet.text.ilike(f"%{q}%"))

    if thread_id:
        stmt = stmt.where(Tweet.thread_id == thread_id).order_by(Tweet.thread_position)
    else:
        stmt = stmt.order_by(Tweet.saved_at.desc())

    result = await db.execute(stmt)

    if topic_id:
        tweets = []
        for row in result.all():
            tweet_obj = row[0]
            cat = row[1]
            tweet_out = TweetOut.model_validate(tweet_obj)
            tweet_out.category = cat
            tweets.append(tweet_out)
        return tweets
    else:
        return result.scalars().all()
```

c) In `assign_tweets()`: change `body.category_id` to `body.category`:
```python
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
            existing.category = body.category
        else:
            db.add(TweetAssignment(
                tweet_id=tid, topic_id=body.topic_id, category=body.category
            ))
    await db.commit()
    return {"assigned": len(body.tweet_ids)}
```

**Step 6: Remove categories router from main.py**

In `backend/app/main.py`, delete these lines:
```python
from app.routers.categories import router as categories_router
app.include_router(categories_router)
```

**Step 7: Run tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -q`
Expected: Some tests will fail (category tests + assignment tests reference old Category model). That's expected — we fix them in Task 3.

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: replace category_id FK with category string, remove categories table"
```

---

### Task 3: Update backend tests

**Files:**
- Delete: `backend/tests/test_categories_api.py`
- Modify: `backend/tests/test_models.py`
- Modify: `backend/tests/test_assignments_api.py`

**Step 1: Delete categories API test file**

```bash
rm backend/tests/test_categories_api.py
```

**Step 2: Update test_models.py**

Remove the Category import and `test_create_category` test. Update `test_assign_tweet_to_topic` to use string category:

```python
import pytest
import pytest_asyncio
from datetime import date
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles

from app.db import Base
from app.models.tweet import Tweet
from app.models.topic import Topic
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
async def test_assign_tweet_to_topic(db):
    tweet = Tweet(tweet_id="999", author_handle="test", text="test")
    topic = Topic(title="Test Topic", date=date(2026, 2, 20))
    db.add_all([tweet, topic])
    await db.flush()

    assignment = TweetAssignment(tweet_id=tweet.id, topic_id=topic.id, category="hot-take")
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    assert assignment.id is not None
    assert assignment.category == "hot-take"


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

**Step 3: Update test_assignments_api.py**

Remove Category imports and usage, use string categories:

```python
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles

from app.db import Base, get_db
from app.main import app
from app.models import Tweet, Topic, TweetAssignment  # noqa: F401


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):
    return compiler.visit_JSON(type_, **kw)


TEST_DB_URL = "sqlite+aiosqlite:///:memory:"
engine = create_async_engine(TEST_DB_URL, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)


async def override_get_db():
    async with async_session() as session:
        yield session


MOCK_X_API_RESULT = {
    "author_handle": "karpathy",
    "author_display_name": "Andrej Karpathy",
    "author_avatar_url": "https://pbs.twimg.com/profile/karpathy_normal.jpg",
    "author_verified": True,
    "text": "Claude 4 is amazing",
    "url": "https://x.com/karpathy/status/123456",
    "media_urls": [],
    "engagement": {"likes": 5000, "retweets": 1200, "replies": 300},
    "is_quote_tweet": False,
    "is_reply": False,
    "quoted_tweet_id": None,
    "reply_to_tweet_id": None,
    "created_at": "2026-02-20T15:30:00.000Z",
}


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    app.dependency_overrides[get_db] = override_get_db
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture(autouse=True)
def mock_fetch_tweet():
    mock = AsyncMock(return_value=MOCK_X_API_RESULT.copy())
    with patch("app.services.x_api.fetch_tweet", mock):
        yield mock


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def _create_tweets(client, count=3):
    ids = []
    for i in range(count):
        resp = await client.post("/api/tweets", json={
            "tweet_id": f"assign_{i}",
        })
        ids.append(resp.json()["id"])
    return ids


@pytest.mark.asyncio
async def test_bulk_assign(client: AsyncClient):
    tweet_ids = await _create_tweets(client, 3)
    topic = (await client.post("/api/topics", json={"title": "Test", "date": "2026-02-20"})).json()

    resp = await client.post("/api/tweets/assign", json={
        "tweet_ids": tweet_ids,
        "topic_id": topic["id"],
        "category": "hot-take",
    })
    assert resp.status_code == 200
    assert resp.json()["assigned"] == 3

    # Verify tweets show up under the topic with category
    filtered = await client.get("/api/tweets", params={"topic_id": topic["id"]})
    assert len(filtered.json()) == 3
    assert filtered.json()[0]["category"] == "hot-take"


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

    # Assign with category
    await client.post("/api/tweets/assign", json={
        "tweet_ids": tweet_ids,
        "topic_id": topic["id"],
        "category": "hot-take",
    })

    # Re-assign with different category
    await client.post("/api/tweets/assign", json={
        "tweet_ids": tweet_ids,
        "topic_id": topic["id"],
        "category": "kek",
    })

    # Should have only 1 assignment (updated, not duplicated)
    filtered = await client.get("/api/tweets", params={"topic_id": topic["id"]})
    assert len(filtered.json()) == 1
    assert filtered.json()[0]["category"] == "kek"
```

**Step 4: Run tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -q`
Expected: All tests pass

**Step 5: Commit**

```bash
git add -A
git commit -m "test: update tests for string-based categories"
```

---

### Task 4: Frontend — categories constant, API updates, TopicSection grouping

**Files:**
- Create: `frontend/src/constants/categories.ts`
- Delete: `frontend/src/api/categories.ts`
- Delete: `frontend/src/components/CategoryManager.tsx`
- Modify: `frontend/src/api/tweets.ts`
- Modify: `frontend/src/components/TopicSection.tsx`
- Modify: `frontend/src/pages/SettingsPage.tsx`

**Step 1: Create hardcoded categories constant**

```typescript
// frontend/src/constants/categories.ts
export interface CategoryDef {
  key: string
  label: string
  color: string
}

export const CATEGORIES: CategoryDef[] = [
  { key: 'context', label: 'Context', color: '#60A5FA' },
  { key: 'hot-take', label: 'Hot Take', color: '#F87171' },
  { key: 'signal-boost', label: 'Signal Boost', color: '#34D399' },
  { key: 'kek', label: 'Kek', color: '#C084FC' },
  { key: 'pushback', label: 'Pushback', color: '#FB923C' },
]

export const CATEGORY_MAP = new Map(CATEGORIES.map(c => [c.key, c]))

/** Lookup a category by key. Returns label and color, falling back to gray for legacy/unknown keys. */
export function getCategoryDef(key: string): { label: string; color: string } {
  const found = CATEGORY_MAP.get(key)
  if (found) return found
  // Legacy category — show the raw name with gray color
  return { label: key, color: '#9CA3AF' }
}
```

Note: OG Post is NOT in this list — it's handled separately via the existing star/pin system on topics.

**Step 2: Add `category` to Tweet interface**

In `frontend/src/api/tweets.ts`, add to the `Tweet` interface:

```typescript
  saved_at: string
  category?: string | null  // <-- add this line (before the closing brace)
```

**Step 3: Update `useAssignTweets` to use string category**

In `frontend/src/api/tweets.ts`, change the mutation type:

```typescript
export function useAssignTweets() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { tweet_ids: number[]; topic_id: number; category?: string | null }) => {
      const { data } = await api.post('/tweets/assign', body)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tweets'] }),
  })
}
```

**Step 4: Fix TopicSectionWithData to group by category**

In `frontend/src/components/TopicSection.tsx`, replace the `tweetsByCategory` useMemo in `TopicSectionWithData` (lines 67-73):

```typescript
import { getCategoryDef } from '../constants/categories'
// (add this import at top of file, remove the Category type import if present)
```

Replace the `tweetsByCategory` computation:

```typescript
  const tweetsByCategory = useMemo(() => {
    const byCat = new Map<string | null, { category: { name: string; color: string } | null; tweets: Tweet[] }>()
    for (const tweet of remainingTweets) {
      const catKey = tweet.category ?? null
      if (!byCat.has(catKey)) {
        byCat.set(catKey, {
          category: catKey ? { name: getCategoryDef(catKey).label, color: getCategoryDef(catKey).color } : null,
          tweets: [],
        })
      }
      byCat.get(catKey)!.tweets.push(tweet)
    }
    return byCat
  }, [remainingTweets])
```

Also update the `TopicSectionProps` type — change `tweetsByCategory` from `Map<number | null, ...>` to `Map<string | null, ...>`:

```typescript
interface TopicSectionProps {
  topicId: number
  title: string
  color: string | null
  tweetsByCategory: Map<string | null, { category: { name: string; color: string } | null; tweets: Tweet[] }>
  ogTweet: Tweet | null
  ogTweetId: number | null
  // ... rest unchanged
}
```

In the `TopicSection` render, fix the `.entries()` map key type from `catId` to `catKey`:

```typescript
{Array.from(tweetsByCategory.entries()).map(([catKey, group]) => (
  <div key={catKey ?? 'uncategorized'} style={{ marginBottom: 8 }}>
```

**Step 5: Delete old category files**

```bash
rm frontend/src/api/categories.ts
rm frontend/src/components/CategoryManager.tsx
```

**Step 6: Update SettingsPage — remove CategoryManager**

In `frontend/src/pages/SettingsPage.tsx`, remove the `CategoryManager` import and its usage in the JSX. Remove:
```typescript
import { CategoryManager } from '../components/CategoryManager'
```
And remove `<CategoryManager />` from the JSX.

**Step 7: Verify TypeScript**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: hardcoded categories, fix category display pipeline, remove CRUD"
```

---

### Task 5: Context menu — "Set Category" submenu

**Files:**
- Modify: `frontend/src/components/ContextMenu.tsx`
- Modify: `frontend/src/components/DayFeedPanel.tsx`

**Step 1: Add onSetCategory prop to ContextMenu**

In `ContextMenu.tsx`, add to `ContextMenuProps`:

```typescript
interface ContextMenuProps {
  x: number
  y: number
  tweet: Tweet
  topicId?: number
  onClose: () => void
  onDelete: (tweetId: number) => void
  onMoveToDate: (tweetId: number, date: string) => void
  onSetOg?: (topicId: number, tweetId: number | null) => void
  ogTweetId?: number | null
  onSetCategory?: (tweetId: number, topicId: number, category: string | null) => void
}
```

**Step 2: Add category submenu to ContextMenu**

Add imports at top:

```typescript
import { CATEGORIES, getCategoryDef } from '../constants/categories'
```

Inside the `ContextMenu` component, add state:

```typescript
const [showCategories, setShowCategories] = useState(false)
```

Add the category menu item and submenu after the OG Post button, before the divider. Only show when tweet is in a topic (`topicId` is defined):

```tsx
{/* Set Category */}
{onSetCategory && topicId && (
  <div style={{ position: 'relative' }}>
    <button
      onClick={(e) => { e.stopPropagation(); setShowCategories((v) => !v) }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
      style={{ ...itemStyle, justifyContent: 'space-between' }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>&#9776;</span>
        {tweet.category ? getCategoryDef(tweet.category).label : 'Set Category'}
      </span>
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>&#9654;</span>
    </button>

    {showCategories && (
      <div
        style={{
          position: 'absolute',
          left: '100%',
          top: 0,
          zIndex: 101,
          background: 'var(--bg-raised)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
          padding: 4,
          minWidth: 160,
        }}
      >
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => {
              onSetCategory(tweet.id, topicId, cat.key)
              onClose()
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
            style={{
              ...itemStyle,
              fontWeight: tweet.category === cat.key ? 600 : 400,
            }}
          >
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: cat.color,
              flexShrink: 0,
            }} />
            {cat.label}
          </button>
        ))}

        {/* Remove category option */}
        {tweet.category && (
          <>
            <div style={{ height: 1, background: 'var(--border)', margin: '4px 8px' }} />
            <button
              onClick={() => {
                onSetCategory(tweet.id, topicId, null)
                onClose()
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
              style={{ ...itemStyle, color: 'var(--text-tertiary)' }}
            >
              <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>&#10005;</span>
              Remove Category
            </button>
          </>
        )}
      </div>
    )}
  </div>
)}
```

**Step 3: Wire up onSetCategory in DayFeedPanel**

In `frontend/src/components/DayFeedPanel.tsx`, add a `handleSetCategory` callback:

```typescript
const handleSetCategory = useCallback(
  (tweetId: number, topicId: number, category: string | null) => {
    assignMutation.mutate({ tweet_ids: [tweetId], topic_id: topicId, category })
  },
  [assignMutation],
)
```

Pass it to `ContextMenu`:

```tsx
<ContextMenu
  x={contextMenu.x}
  y={contextMenu.y}
  tweet={contextMenu.tweet}
  topicId={contextMenu.topicId}
  onClose={() => setContextMenu(null)}
  onDelete={handleDeleteTweet}
  onMoveToDate={handleMoveToDate}
  onSetOg={contextMenu.topicId ? handleSetOg : undefined}
  ogTweetId={contextMenu.ogTweetId ?? null}
  onSetCategory={contextMenu.topicId ? handleSetCategory : undefined}
/>
```

**Step 4: Verify TypeScript**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Set Category submenu to tweet context menu"
```

---

### Task 6: Extension updates

**Files:**
- Modify: `extension/background.js`
- Modify: `extension/content.js`

**Step 1: Update background.js**

- Remove `handleGetCategories()` and `handleCreateCategory()` functions
- Update `handleAssignTweet()` to send `category` string instead of `category_id`
- Remove the message handlers for `GET_CATEGORIES` and `CREATE_CATEGORY`

In the assign handler, change `category_id` to `category`:
```javascript
body: JSON.stringify({ tweet_ids: msg.assignment.tweet_ids, topic_id: msg.assignment.topic_id, category: msg.assignment.category || null })
```

**Step 2: Update content.js**

- Replace the dynamic category fetch + combobox with a static dropdown of hardcoded categories
- The hardcoded list matches the frontend: Context, Hot Take, Signal Boost, Kek, Pushback
- Send `category` string in the ASSIGN_TWEET message instead of `category_id`

Replace the category combobox section with a simple `<select>`:
```javascript
const CATEGORIES = [
  { key: '', label: 'No category' },
  { key: 'context', label: 'Context' },
  { key: 'hot-take', label: 'Hot Take' },
  { key: 'signal-boost', label: 'Signal Boost' },
  { key: 'kek', label: 'Kek' },
  { key: 'pushback', label: 'Pushback' },
];
```

In the assign message:
```javascript
assignment: { tweet_ids: [tweetDbId], topic_id: Number(topicId), category: selectedCategory || null }
```

**Step 3: Commit**

```bash
git add extension/background.js extension/content.js
git commit -m "feat: update extension to use hardcoded string categories"
```
