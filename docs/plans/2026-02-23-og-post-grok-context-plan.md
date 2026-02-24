# OG Post + Grok Context Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users designate one tweet per topic as the "OG post" (reference tweet), pin it at the top with a visual indicator, and auto-fetch Grok AI context about it via xAI API.

**Architecture:** Add `og_tweet_id` FK to the `topics` table. New `grok_api.py` backend service calls xAI chat completions API. Frontend renders OG tweet at top of topic with gold border, "OG" badge, and Grok context below a divider. Context menu and pin icon allow designation. Extension gets an OG toggle.

**Tech Stack:** Python/FastAPI (backend), httpx (xAI API calls), React/TypeScript (frontend), Chrome Extension MV3

---

### Task 1: Backend — Add `og_tweet_id` column to topics

**Files:**
- Modify: `backend/app/models/topic.py:12-17`
- Create: `backend/alembic/versions/007_add_og_tweet_id.py`

**Step 1: Write the migration**

Create `backend/alembic/versions/007_add_og_tweet_id.py`:

```python
"""add og_tweet_id column to topics

Revision ID: 007_og_tweet_id
Revises: 006_grok_context
Create Date: 2026-02-23
"""
from alembic import op
import sqlalchemy as sa

revision = "007_og_tweet_id"
down_revision = "006_grok_context"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("topics", sa.Column("og_tweet_id", sa.Integer(), sa.ForeignKey("tweets.id", ondelete="SET NULL"), nullable=True))


def downgrade() -> None:
    op.drop_column("topics", "og_tweet_id")
```

**Step 2: Update the Topic model**

In `backend/app/models/topic.py`, add the import and column:

```python
from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, func

class Topic(Base):
    __tablename__ = "topics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(512))
    date: Mapped[date] = mapped_column(Date, index=True)
    color: Mapped[str | None] = mapped_column(String(7))
    position: Mapped[int] = mapped_column(Integer, default=0)
    og_tweet_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("tweets.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

**Step 3: Run tests to make sure nothing breaks**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -q`
Expected: All existing tests pass (SQLite creates tables from model metadata)

**Step 4: Commit**

```bash
git add backend/app/models/topic.py backend/alembic/versions/007_add_og_tweet_id.py
git commit -m "feat: add og_tweet_id column to topics table"
```

---

### Task 2: Backend — Update topic schemas and router for OG

**Files:**
- Modify: `backend/app/schemas/topic.py:12-27`
- Modify: `backend/app/routers/topics.py:56-65`

**Step 1: Write the failing test**

Add to `backend/tests/test_topics_api.py`:

```python
@pytest.mark.asyncio
async def test_set_og_tweet_on_topic(client: AsyncClient):
    # Create a tweet first
    tweet_resp = await client.post("/api/tweets", json={"tweet_id": "111222333"})
    tweet_db_id = tweet_resp.json()["id"]

    # Create a topic
    topic_resp = await client.post("/api/topics", json={"title": "Test OG", "date": "2026-02-23"})
    topic_id = topic_resp.json()["id"]

    # Assign tweet to topic
    await client.post("/api/tweets/assign", json={"tweet_ids": [tweet_db_id], "topic_id": topic_id})

    # Set OG
    resp = await client.patch(f"/api/topics/{topic_id}", json={"og_tweet_id": tweet_db_id})
    assert resp.status_code == 200
    assert resp.json()["og_tweet_id"] == tweet_db_id


@pytest.mark.asyncio
async def test_clear_og_tweet(client: AsyncClient):
    topic_resp = await client.post("/api/topics", json={"title": "Test Clear OG", "date": "2026-02-23"})
    topic_id = topic_resp.json()["id"]

    resp = await client.patch(f"/api/topics/{topic_id}", json={"og_tweet_id": None})
    assert resp.status_code == 200
    assert resp.json()["og_tweet_id"] is None


@pytest.mark.asyncio
async def test_og_tweet_must_be_assigned(client: AsyncClient):
    # Create tweet but don't assign to topic
    tweet_resp = await client.post("/api/tweets", json={"tweet_id": "444555666"})
    tweet_db_id = tweet_resp.json()["id"]

    topic_resp = await client.post("/api/topics", json={"title": "Test Unassigned OG", "date": "2026-02-23"})
    topic_id = topic_resp.json()["id"]

    # Setting OG on unassigned tweet should auto-assign it
    resp = await client.patch(f"/api/topics/{topic_id}", json={"og_tweet_id": tweet_db_id})
    assert resp.status_code == 200
    assert resp.json()["og_tweet_id"] == tweet_db_id
```

**Step 2: Run tests to verify they fail**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_topics_api.py -v -k "og"`
Expected: FAIL — `og_tweet_id` not in schema

**Step 3: Update schemas**

In `backend/app/schemas/topic.py`:

```python
class TopicUpdate(BaseModel):
    title: str | None = None
    color: str | None = None
    position: int | None = None
    og_tweet_id: int | None = None


class TopicOut(BaseModel):
    id: int
    title: str
    date: date
    color: str | None
    position: int
    og_tweet_id: int | None = None
    tweet_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}
```

**Step 4: Update the PATCH endpoint**

In `backend/app/routers/topics.py`, modify `update_topic` to handle OG validation:

```python
from app.models.tweet import Tweet
from app.models.assignment import TweetAssignment

@router.patch("/{topic_id}", response_model=TopicOut)
async def update_topic(topic_id: int, body: TopicUpdate, db: AsyncSession = Depends(get_db)):
    topic = await db.get(Topic, topic_id)
    if not topic:
        raise HTTPException(404, "Topic not found")

    data = body.model_dump(exclude_unset=True)

    # Handle og_tweet_id: validate tweet exists, auto-assign if needed
    if "og_tweet_id" in data and data["og_tweet_id"] is not None:
        tweet_id = data["og_tweet_id"]
        tweet = await db.get(Tweet, tweet_id)
        if not tweet:
            raise HTTPException(404, "Tweet not found")
        # Check if assigned to this topic; if not, auto-assign
        existing = (await db.execute(
            select(TweetAssignment).where(
                TweetAssignment.tweet_id == tweet_id,
                TweetAssignment.topic_id == topic_id,
            )
        )).scalar_one_or_none()
        if not existing:
            db.add(TweetAssignment(tweet_id=tweet_id, topic_id=topic_id))

    for field, value in data.items():
        setattr(topic, field, value)
    await db.commit()
    await db.refresh(topic)
    return topic
```

Add `from sqlalchemy import func, select` if `select` is not already imported (it is — line 4).

**Step 5: Run tests to verify they pass**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_topics_api.py -v`
Expected: All tests pass including the 3 new OG tests

**Step 6: Commit**

```bash
git add backend/app/schemas/topic.py backend/app/routers/topics.py backend/tests/test_topics_api.py
git commit -m "feat: support og_tweet_id in topic update/response"
```

---

### Task 3: Backend — Grok API service

**Files:**
- Create: `backend/app/services/grok_api.py`

**Step 1: Write the failing test**

Create `backend/tests/test_grok_api.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch

from app.services.grok_api import fetch_grok_context, GrokAPIError


@pytest.mark.asyncio
async def test_fetch_grok_context_success():
    mock_response = AsyncMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "choices": [{"message": {"content": "This tweet is about AI progress..."}}]
    }

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=mock_response)

    with patch("app.services.grok_api.httpx.AsyncClient", return_value=mock_client):
        result = await fetch_grok_context("https://x.com/user/status/123")

    assert result == "This tweet is about AI progress..."


@pytest.mark.asyncio
async def test_fetch_grok_context_no_api_key():
    with patch("app.services.grok_api.settings") as mock_settings:
        mock_settings.xai_api_key = ""
        with pytest.raises(GrokAPIError, match="XAI_API_KEY"):
            await fetch_grok_context("https://x.com/user/status/123")
```

**Step 2: Run test to verify it fails**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_grok_api.py -v`
Expected: FAIL — module not found

**Step 3: Create the Grok API service**

Create `backend/app/services/grok_api.py`:

```python
"""xAI Grok API client for fetching tweet context."""

from __future__ import annotations

import httpx

from app.config import settings

XAI_API_BASE = "https://api.x.ai/v1"


class GrokAPIError(Exception):
    """Raised when the Grok API returns an error or is misconfigured."""
    pass


async def fetch_grok_context(tweet_url: str) -> str:
    """Call Grok API to get context about a tweet.

    Args:
        tweet_url: Full URL to the tweet (e.g. https://x.com/user/status/123)

    Returns:
        The Grok response text.
    """
    if not settings.xai_api_key:
        raise GrokAPIError("XAI_API_KEY is not configured")

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{XAI_API_BASE}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.xai_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "grok-3",
                "messages": [
                    {
                        "role": "user",
                        "content": f"I want you to give me context about this tweet: {tweet_url}",
                    }
                ],
            },
        )

    if resp.status_code != 200:
        raise GrokAPIError(f"Grok API returned {resp.status_code}: {resp.text}")

    data = resp.json()
    choices = data.get("choices", [])
    if not choices:
        raise GrokAPIError("Grok API returned no choices")

    return choices[0]["message"]["content"]
```

**Step 4: Run tests to verify they pass**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_grok_api.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/services/grok_api.py backend/tests/test_grok_api.py
git commit -m "feat: add Grok API service for tweet context"
```

---

### Task 4: Backend — Grok context endpoint

**Files:**
- Modify: `backend/app/routers/tweets.py`

**Step 1: Write the failing test**

Add to `backend/tests/test_tweets.py` (or a new `backend/tests/test_grok_endpoint.py` — check which file exists and has the right fixtures):

```python
@pytest.mark.asyncio
async def test_fetch_grok_context_endpoint(client: AsyncClient):
    # Save a tweet first
    tweet_resp = await client.post("/api/tweets", json={"tweet_id": "999888777"})
    tweet_id = tweet_resp.json()["id"]

    with patch("app.routers.tweets.fetch_grok_context", new_callable=AsyncMock) as mock_grok:
        mock_grok.return_value = "This is context about the tweet."
        resp = await client.post(f"/api/tweets/{tweet_id}/grok-context")
        assert resp.status_code == 200
        assert resp.json()["grok_context"] == "This is context about the tweet."

    # Verify it was persisted
    get_resp = await client.get("/api/tweets", params={"date": tweet_resp.json()["saved_at"][:10]})
    # Find our tweet
    matching = [t for t in get_resp.json() if t["id"] == tweet_id]
    assert len(matching) == 1
    assert matching[0]["grok_context"] == "This is context about the tweet."
```

Note: Add `from unittest.mock import AsyncMock, patch` to the test file imports.

**Step 2: Run test to verify it fails**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_tweets.py -v -k "grok"`
Expected: FAIL — endpoint doesn't exist

**Step 3: Add the endpoint**

In `backend/app/routers/tweets.py`, add:

```python
from app.services.grok_api import fetch_grok_context, GrokAPIError

@router.post("/{tweet_id}/grok-context")
async def get_grok_context(tweet_id: int, db: AsyncSession = Depends(get_db)):
    tweet = await db.get(Tweet, tweet_id)
    if not tweet:
        raise HTTPException(404, "Tweet not found")
    if not tweet.url:
        raise HTTPException(400, "Tweet has no URL")
    try:
        context = await fetch_grok_context(tweet.url)
    except GrokAPIError as e:
        raise HTTPException(502, str(e))
    tweet.grok_context = context
    await db.commit()
    await db.refresh(tweet)
    return {"grok_context": tweet.grok_context}
```

**Important:** This endpoint must be defined BEFORE the `/{tweet_id}` PATCH route to avoid route conflicts. Place it after the `/assign` and `/unassign` endpoints but before the PATCH `/{tweet_id}` endpoint. Check exact ordering in the file.

**Step 4: Run tests to verify they pass**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -q`
Expected: All pass

**Step 5: Commit**

```bash
git add backend/app/routers/tweets.py backend/tests/test_tweets.py
git commit -m "feat: add POST /api/tweets/{id}/grok-context endpoint"
```

---

### Task 5: Backend — Auto-fetch Grok context on OG designation

**Files:**
- Modify: `backend/app/routers/topics.py:56-65`

**Step 1: Write the failing test**

Add to `backend/tests/test_topics_api.py`:

```python
from unittest.mock import AsyncMock, patch

@pytest.mark.asyncio
async def test_setting_og_triggers_grok_fetch(client: AsyncClient):
    # Create a tweet with a URL
    tweet_resp = await client.post("/api/tweets", json={"tweet_id": "777888999"})
    tweet_db_id = tweet_resp.json()["id"]

    # Manually set a URL on the tweet (since X API is mocked/unavailable in tests)
    await client.patch(f"/api/tweets/{tweet_db_id}", json={"url": "https://x.com/user/status/777888999"})

    topic_resp = await client.post("/api/topics", json={"title": "Grok Test", "date": "2026-02-23"})
    topic_id = topic_resp.json()["id"]

    await client.post("/api/tweets/assign", json={"tweet_ids": [tweet_db_id], "topic_id": topic_id})

    with patch("app.routers.topics.fetch_grok_context", new_callable=AsyncMock) as mock_grok:
        mock_grok.return_value = "Auto-fetched context"
        resp = await client.patch(f"/api/topics/{topic_id}", json={"og_tweet_id": tweet_db_id})
        assert resp.status_code == 200
        mock_grok.assert_called_once()
```

**Step 2: Run test to verify it fails**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_topics_api.py -v -k "grok"`
Expected: FAIL — Grok not called

**Step 3: Add auto-fetch to update_topic**

In `backend/app/routers/topics.py`, update the PATCH handler. After the auto-assign block and before `await db.commit()`, add:

```python
from app.services.grok_api import fetch_grok_context, GrokAPIError

# Inside update_topic, after setting og_tweet_id:
    if "og_tweet_id" in data and data["og_tweet_id"] is not None:
        tweet_id = data["og_tweet_id"]
        tweet = await db.get(Tweet, tweet_id)
        if not tweet:
            raise HTTPException(404, "Tweet not found")
        # Auto-assign if needed
        existing = (await db.execute(
            select(TweetAssignment).where(
                TweetAssignment.tweet_id == tweet_id,
                TweetAssignment.topic_id == topic_id,
            )
        )).scalar_one_or_none()
        if not existing:
            db.add(TweetAssignment(tweet_id=tweet_id, topic_id=topic_id))
        # Auto-fetch Grok context if empty
        if not tweet.grok_context and tweet.url:
            try:
                tweet.grok_context = await fetch_grok_context(tweet.url)
            except GrokAPIError:
                pass  # Non-blocking: OG is set even if Grok fails
```

**Step 4: Run tests to verify they pass**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_topics_api.py -v`
Expected: All pass

**Step 5: Commit**

```bash
git add backend/app/routers/topics.py backend/tests/test_topics_api.py
git commit -m "feat: auto-fetch Grok context when setting OG tweet"
```

---

### Task 6: Frontend — Update Topic type and API hooks

**Files:**
- Modify: `frontend/src/api/topics.ts:4-11`
- Modify: `frontend/src/api/tweets.ts` (add Grok hook)

**Step 1: Update Topic interface**

In `frontend/src/api/topics.ts`, add `og_tweet_id` to the `Topic` interface:

```typescript
export interface Topic {
    id: number
    title: string
    date: string
    color: string | null
    position: number
    og_tweet_id: number | null
    created_at: string
}
```

**Step 2: Update useUpdateTopic mutation type**

In `frontend/src/api/topics.ts`, update the mutation type:

```typescript
export function useUpdateTopic() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: async ({ id, ...body }: { id: number; title?: string; color?: string; position?: number; og_tweet_id?: number | null }) => {
            const { data } = await api.patch(`/topics/${id}`, body)
            return data
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['topics'] })
            qc.invalidateQueries({ queryKey: ['tweets'] })
        },
    })
}
```

Note: Also invalidate `['tweets']` because setting OG may auto-assign a tweet.

**Step 3: Add Grok context hook**

In `frontend/src/api/tweets.ts`, add:

```typescript
export function useFetchGrokContext() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: async (tweetId: number) => {
            const { data } = await api.post(`/tweets/${tweetId}/grok-context`)
            return data as { grok_context: string }
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['tweets'] }),
    })
}
```

**Step 4: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add frontend/src/api/topics.ts frontend/src/api/tweets.ts
git commit -m "feat: add og_tweet_id to Topic type, add Grok context hook"
```

---

### Task 7: Frontend — OG tweet rendering in TopicSection

**Files:**
- Modify: `frontend/src/components/TopicSection.tsx`

This is the core UI change. The OG tweet renders at the top of the topic body, styled distinctly with a gold border, "OG" badge, and Grok context below a divider inside the card.

**Step 1: Update TopicSectionWithData to pass OG info**

In `frontend/src/components/TopicSection.tsx`, update the props interface and data wrapper:

```typescript
interface TopicSectionWithDataProps {
  topicId: number
  title: string
  color: string | null
  date: string
  search: string
  ogTweetId: number | null  // NEW
  onDelete: (topicId: number) => void
  onUpdateTitle: (topicId: number, title: string) => void
  onSetOg: (topicId: number, tweetId: number | null) => void  // NEW
  onTweetClick?: (tweet: Tweet) => void
  onContextMenu?: (e: React.MouseEvent, tweet: Tweet) => void
}
```

Update the component body. Find the OG tweet from the fetched tweets array:

```typescript
export function TopicSectionWithData({
  topicId, title, color, date, search, ogTweetId,
  onDelete, onUpdateTitle, onSetOg, onTweetClick, onContextMenu,
}: TopicSectionWithDataProps) {
  const tweetsQuery = useTweets({ date, topic_id: topicId, q: search || undefined })
  const tweets = tweetsQuery.data ?? []

  // Separate OG tweet from the rest
  const ogTweet = ogTweetId ? tweets.find(t => t.id === ogTweetId) ?? null : null
  const remainingTweets = ogTweetId ? tweets.filter(t => t.id !== ogTweetId) : tweets

  const tweetsByCategory = useMemo(() => {
    const byCat = new Map<number | null, { category: Category | null; tweets: Tweet[] }>()
    if (remainingTweets.length > 0) {
      byCat.set(null, { category: null, tweets: remainingTweets })
    }
    return byCat
  }, [remainingTweets])

  return (
    <TopicSection
      topicId={topicId}
      title={title}
      color={color}
      tweetsByCategory={tweetsByCategory}
      ogTweet={ogTweet}
      onDelete={onDelete}
      onUpdateTitle={onUpdateTitle}
      onSetOg={onSetOg}
      onTweetClick={onTweetClick}
      onContextMenu={onContextMenu}
    />
  )
}
```

**Step 2: Update TopicSection to render OG tweet**

Add `ogTweet` and `onSetOg` to the `TopicSectionProps` interface. In the collapsible body, before the category groups, render the OG tweet card:

```tsx
{/* OG Tweet - pinned at top */}
{ogTweet && (
  <div style={{
    borderLeft: '3px solid #F59E0B',
    borderRadius: 'var(--radius-lg)',
    marginBottom: 12,
    position: 'relative',
  }}>
    {/* OG Badge */}
    <div style={{
      position: 'absolute',
      top: 8,
      right: 8,
      background: '#F59E0B',
      color: '#000',
      fontSize: 10,
      fontWeight: 700,
      padding: '2px 6px',
      borderRadius: 4,
      zIndex: 2,
      letterSpacing: '0.05em',
    }}>
      OG
    </div>

    {/* Tweet card */}
    <div
      onClick={() => onTweetClick?.(ogTweet)}
      onContextMenu={(e) => onContextMenu?.(e, ogTweet)}
      style={{ cursor: 'pointer' }}
    >
      <EmbeddedTweet tweet={ogTweet} />
    </div>

    {/* Grok Context section */}
    {ogTweet.grok_context && (
      <>
        <div style={{ height: 1, background: 'var(--border)', margin: '0 12px' }} />
        <div style={{
          padding: '10px 14px',
          fontSize: 13,
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
          background: 'var(--bg-subtle, rgba(0,0,0,0.1))',
          borderBottomLeftRadius: 'var(--radius-lg)',
          borderBottomRightRadius: 'var(--radius-lg)',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 6,
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            Grok Context
            <GrokRefreshButton tweetId={ogTweet.id} />
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{ogTweet.grok_context}</div>
        </div>
      </>
    )}

    {/* No context yet — show fetch button */}
    {!ogTweet.grok_context && (
      <>
        <div style={{ height: 1, background: 'var(--border)', margin: '0 12px' }} />
        <div style={{
          padding: '10px 14px',
          fontSize: 13,
          color: 'var(--text-tertiary)',
          background: 'var(--bg-subtle, rgba(0,0,0,0.1))',
          borderBottomLeftRadius: 'var(--radius-lg)',
          borderBottomRightRadius: 'var(--radius-lg)',
        }}>
          <GrokRefreshButton tweetId={ogTweet.id} label="Fetch Grok Context" />
        </div>
      </>
    )}
  </div>
)}
```

**Step 3: Create GrokRefreshButton component**

Add at the top of `TopicSection.tsx` (or as a separate small component):

```tsx
import { useFetchGrokContext } from '../api/tweets'

function GrokRefreshButton({ tweetId, label }: { tweetId: number; label?: string }) {
  const fetchGrok = useFetchGrokContext()

  return (
    <button
      onClick={(e) => { e.stopPropagation(); fetchGrok.mutate(tweetId) }}
      disabled={fetchGrok.isPending}
      style={{
        background: 'none',
        border: 'none',
        color: 'var(--text-tertiary)',
        cursor: fetchGrok.isPending ? 'wait' : 'pointer',
        fontSize: 12,
        padding: '2px 4px',
        opacity: fetchGrok.isPending ? 0.5 : 0.7,
      }}
      title="Refresh Grok context"
    >
      {fetchGrok.isPending ? 'Fetching...' : label ?? '↻'}
    </button>
  )
}
```

**Step 4: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: Errors about missing props in DayFeedPanel (expected — we'll fix that next)

**Step 5: Commit**

```bash
git add frontend/src/components/TopicSection.tsx
git commit -m "feat: render OG tweet with badge and Grok context in topic section"
```

---

### Task 8: Frontend — Wire OG into DayFeedPanel

**Files:**
- Modify: `frontend/src/components/DayFeedPanel.tsx:286-298`

**Step 1: Pass `ogTweetId` and `onSetOg` to TopicSectionWithData**

In `DayFeedPanel.tsx`, update the topic rendering. Topics already come from `useTopics(date)` which now includes `og_tweet_id`.

Add the `onSetOg` handler:

```typescript
const handleSetOg = useCallback(
  (topicId: number, tweetId: number | null) => {
    updateTopicMutation.mutate({ id: topicId, og_tweet_id: tweetId })
  },
  [updateTopicMutation],
)
```

Update the TopicSectionWithData render:

```tsx
<TopicSectionWithData
  key={topic.id}
  topicId={topic.id}
  title={topic.title}
  color={topic.color}
  date={date}
  search={search}
  ogTweetId={topic.og_tweet_id}
  onDelete={handleDeleteTopic}
  onUpdateTitle={handleUpdateTopicTitle}
  onSetOg={handleSetOg}
  onTweetClick={onTweetClick}
  onContextMenu={handleContextMenu}
/>
```

**Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/components/DayFeedPanel.tsx
git commit -m "feat: wire OG tweet support into DayFeedPanel"
```

---

### Task 9: Frontend — OG designation via context menu

**Files:**
- Modify: `frontend/src/components/ContextMenu.tsx`
- Modify: `frontend/src/components/DayFeedPanel.tsx`

**Step 1: Add topic context to context menu state**

The context menu currently doesn't know which topic a tweet belongs to. We need to thread this through.

In `DayFeedPanel.tsx`, change the context menu state type:

```typescript
const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tweet: Tweet; topicId?: number } | null>(null)
```

Update `handleContextMenu` to accept an optional `topicId`:

```typescript
const handleContextMenu = useCallback((e: React.MouseEvent, tweet: Tweet, topicId?: number) => {
  setContextMenu({ x: e.clientX, y: e.clientY, tweet, topicId })
}, [])
```

Pass `topicId` to ContextMenu:

```tsx
{contextMenu && (
  <ContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    tweet={contextMenu.tweet}
    topicId={contextMenu.topicId}
    onClose={() => setContextMenu(null)}
    onDelete={handleDeleteTweet}
    onMoveToDate={handleMoveToDate}
    onSetOg={contextMenu.topicId ? handleSetOg : undefined}
  />
)}
```

**Step 2: Update ContextMenu to show "Set as OG Post" option**

In `ContextMenu.tsx`, add new props:

```typescript
interface ContextMenuProps {
  x: number
  y: number
  tweet: Tweet
  topicId?: number
  onClose: () => void
  onDelete: (tweetId: number) => void
  onMoveToDate: (tweetId: number, date: string) => void
  onSetOg?: (topicId: number, tweetId: number) => void  // NEW
}
```

Add the menu item after "Move to date..." and before the divider:

```tsx
{/* Set as OG Post */}
{onSetOg && topicId && (
  <button
    onClick={() => { onSetOg(topicId, tweet.id); onClose() }}
    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
    style={{ ...itemStyle, color: '#F59E0B' }}
  >
    <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>&#11088;</span>
    Set as OG Post
  </button>
)}
```

**Step 3: Thread topicId through TopicSection's onContextMenu**

In `TopicSection.tsx`, the `onContextMenu` callback needs to include the `topicId`. Update the prop type:

```typescript
onContextMenu?: (e: React.MouseEvent, tweet: Tweet, topicId?: number) => void
```

In the TopicSectionWithData, pass `topicId`:

```typescript
onContextMenu={(e, tweet) => onContextMenu?.(e, tweet, topicId)}
```

**Step 4: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add frontend/src/components/ContextMenu.tsx frontend/src/components/DayFeedPanel.tsx frontend/src/components/TopicSection.tsx
git commit -m "feat: add 'Set as OG Post' option to context menu"
```

---

### Task 10: Frontend — OG pin icon on tweet cards in topics

**Files:**
- Modify: `frontend/src/components/TopicSection.tsx`

**Step 1: Add a pin/star icon to each tweet in a topic**

In the `DraggableTweetInTopic` component (or the rendering loop inside TopicSection's body), add a small star icon button that appears on hover. When clicked, it sets that tweet as the OG for the topic.

Add to the tweet card wrapper in the topic's tweet rendering:

```tsx
{/* OG toggle icon - only show within topic sections */}
<button
  onClick={(e) => {
    e.stopPropagation()
    onSetOg(topicId, tweet.id === ogTweetId ? null : tweet.id)
  }}
  title={tweet.id === ogTweetId ? 'Remove OG' : 'Set as OG Post'}
  style={{
    position: 'absolute',
    top: 6,
    left: 6,
    background: tweet.id === ogTweetId ? '#F59E0B' : 'rgba(0,0,0,0.5)',
    border: 'none',
    borderRadius: '50%',
    width: 24,
    height: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: 12,
    color: tweet.id === ogTweetId ? '#000' : '#888',
    opacity: tweet.id === ogTweetId ? 1 : 0,
    transition: 'opacity 0.15s',
    zIndex: 2,
  }}
  className="og-toggle-btn"
>
  ★
</button>
```

Add CSS to show on hover of the parent wrapper. Use a `style` tag or inline approach — add to the wrapper div:

```css
.topic-tweet-wrapper:hover .og-toggle-btn {
  opacity: 1 !important;
}
```

Since this project uses inline styles, the hover reveal can be done by wrapping the tweet in a div with an `onMouseEnter`/`onMouseLeave` state, or by injecting a `<style>` tag. Use whichever approach is already used for similar hover reveals (check the grip handle pattern in DraggableTweetInTopic).

**Step 2: Thread `onSetOg`, `ogTweetId`, and `topicId` through DraggableTweetInTopic**

These props need to be passed down from TopicSection to each tweet card.

**Step 3: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/src/components/TopicSection.tsx
git commit -m "feat: add OG star toggle icon on tweet cards in topics"
```

---

### Task 11: Extension — OG toggle in action card

**Files:**
- Modify: `extension/content.js:337-345` (between category and memo sections)
- Modify: `extension/background.js` (add SET_OG message handler)

**Step 1: Add OG checkbox to the action card**

In `extension/content.js`, after the category combobox block (after `card.appendChild(catContainer);` at line 336) and before the memo label (line 338), add:

```javascript
// OG Post toggle
const ogRow = document.createElement("div");
ogRow.style.cssText = "display:flex;align-items:center;gap:8px;margin:4px 0;";

const ogCheckbox = document.createElement("input");
ogCheckbox.type = "checkbox";
ogCheckbox.id = "tpot-og-toggle";
ogCheckbox.style.cssText = "width:16px;height:16px;accent-color:#F59E0B;cursor:pointer;";

const ogLabel = document.createElement("label");
ogLabel.htmlFor = "tpot-og-toggle";
ogLabel.textContent = "Set as OG Post";
ogLabel.style.cssText = "font-size:12px;color:#F59E0B;cursor:pointer;font-weight:600;";

ogRow.appendChild(ogCheckbox);
ogRow.appendChild(ogLabel);
card.appendChild(ogRow);

const ogWarning = document.createElement("div");
ogWarning.style.cssText = "font-size:11px;color:#a0a0c0;margin-bottom:4px;display:none;";
card.appendChild(ogWarning);
```

**Step 2: Check for existing OG when topic is selected**

When a topic is selected in the dropdown, check if it already has an OG. Add to the topic selection handler:

```javascript
// After topic is selected, check for existing OG
if (selectedTopic.og_tweet_id) {
  ogWarning.textContent = "⚠ This topic already has an OG post. Checking this will replace it.";
  ogWarning.style.display = "";
} else {
  ogWarning.style.display = "none";
}
```

This requires the topics list from the API to include `og_tweet_id` (it will after Task 2).

**Step 3: Set OG after assignment**

In the assign button click handler (after the assign API call succeeds around line 439), add:

```javascript
// Set as OG if checked
if (ogCheckbox.checked && topicId) {
  await sendMessage({
    type: "SET_OG",
    topicId: Number(topicId),
    tweetDbId: tweetDbId,
  });
}
```

**Step 4: Add SET_OG handler to background.js**

In `extension/background.js`, add a new message handler:

```javascript
async function handleSetOg(message) {
  const config = await getConfig();
  const url = config.backendUrl.replace(/\/+$/, "") + "/api/topics/" + message.topicId;
  const headers = { "Content-Type": "application/json", ...authHeaders(config) };
  try {
    const resp = await fetch(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ og_tweet_id: message.tweetDbId }),
    });
    if (!resp.ok) return { error: "HTTP " + resp.status };
    return await resp.json();
  } catch (err) {
    return { error: err.message };
  }
}
```

Register it in the message listener switch/case (check how existing handlers are registered in `background.js`).

**Step 5: Commit**

```bash
git add extension/content.js extension/background.js
git commit -m "feat: add OG toggle to Chrome extension action card"
```

---

### Task 12: Database migration — run and verify

**Step 1: Run migration locally**

```bash
cd backend && .venv/bin/python -m alembic upgrade head
```

Expected: Migration `007_og_tweet_id` applied

**Step 2: Run full test suite**

```bash
backend/.venv/bin/python -m pytest backend/tests/ -q
```

Expected: All tests pass

**Step 3: Run frontend typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: No errors

**Step 4: Manual smoke test**

```bash
docker compose up
```

- Open dashboard, create a topic, assign some tweets
- Right-click a tweet → "Set as OG Post"
- Verify OG badge and gold border appear
- Verify Grok context section shows (or "Fetch" button if API key not set)
- Click refresh icon on Grok context
- Try setting a different tweet as OG — previous one should move back to normal feed

---

### Environment Variable Reference

Add `GROK_API_KEY` to `docker-compose.yml` and `docker-compose.prod.yml`:

```yaml
backend:
  environment:
    - GROK_API_KEY=${GROK_API_KEY:-}
```

Also update the CLAUDE.md environment variable table to include `GROK_API_KEY` (it references `XAI_API_KEY` but the config uses `xai_api_key`). Check the config — it already has `xai_api_key` in `config.py:8`. Use that same name, not a new one. The service should use `settings.xai_api_key`.
