# Dashboard Performance Optimization — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the N+1 query explosion and refetch storms by consolidating to a single day-bundle endpoint with optimistic cache mutations, lazy carousel panels, and component memoization.

**Architecture:** New `GET /api/days/{date}/bundle` returns all topics + tweets for a date in one response. Frontend replaces per-topic `useTweets()` calls with a single `useDayBundle(date)` hook. All mutations update the React Query cache directly (optimistic) instead of invalidating/refetching. Carousel only mounts/fetches the active panel; adjacent panels render from cache.

**Tech Stack:** FastAPI (backend), React Query `setQueryData` / `cancelQueries` (optimistic mutations), React.memo (memoization)

---

### Task 1: Backend — Day Bundle Schema

**Files:**
- Create: `backend/app/schemas/day_bundle.py`

**Step 1: Create the schema file**

```python
from pydantic import BaseModel

from app.schemas.topic import TopicOut
from app.schemas.tweet import TweetOut


class TopicBundle(TopicOut):
    tweets: list[TweetOut] = []


class DayBundle(BaseModel):
    topics: list[TopicBundle] = []
    unsorted: list[TweetOut] = []
```

**Step 2: Commit**

```bash
git add backend/app/schemas/day_bundle.py
git commit -m "feat: add DayBundle schema for consolidated day endpoint"
```

---

### Task 2: Backend — Day Bundle Endpoint

**Files:**
- Modify: `backend/app/routers/topics.py`
- Modify: `backend/app/main.py`

**Step 1: Write the test**

Add to `backend/tests/test_tweets_api.py`:

```python
@pytest.mark.asyncio
async def test_day_bundle(client: AsyncClient):
    # Save 3 tweets
    for i in range(3):
        await client.post("/api/tweets", json={"tweet_id": f"bundle_{i}"})

    # Create a topic for today
    from datetime import date
    today = date.today().isoformat()
    topic_resp = await client.post("/api/topics", json={"title": "Test Topic", "date": today})
    assert topic_resp.status_code == 201
    topic_id = topic_resp.json()["id"]

    # Assign tweet 0 to topic with a category
    tweets = (await client.get("/api/tweets")).json()
    tweet_id = tweets[0]["id"]
    await client.post("/api/tweets/assign", json={
        "tweet_ids": [tweet_id], "topic_id": topic_id, "category": "commentary",
    })

    # Fetch bundle
    resp = await client.get(f"/api/days/{today}/bundle")
    assert resp.status_code == 200
    bundle = resp.json()

    # Should have 1 topic with 1 tweet and 2 unsorted
    assert len(bundle["topics"]) == 1
    assert bundle["topics"][0]["id"] == topic_id
    assert len(bundle["topics"][0]["tweets"]) == 1
    assert bundle["topics"][0]["tweets"][0]["category"] == "commentary"
    assert len(bundle["unsorted"]) == 2
```

**Step 2: Run test to verify it fails**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_tweets_api.py::test_day_bundle -v`
Expected: FAIL (404 — route doesn't exist yet)

**Step 3: Create the day bundle router**

Create `backend/app/routers/days.py`:

```python
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.assignment import TweetAssignment
from app.models.topic import Topic
from app.models.tweet import Tweet
from app.schemas.day_bundle import DayBundle, TopicBundle
from app.schemas.tweet import TweetOut

router = APIRouter(prefix="/api/days", tags=["days"])


@router.get("/{day}/bundle", response_model=DayBundle)
async def get_day_bundle(day: date, db: AsyncSession = Depends(get_db)):
    la = ZoneInfo("America/Los_Angeles")
    day_start = datetime.combine(day, time.min, tzinfo=la).astimezone(timezone.utc)
    day_end = datetime.combine(day, time.max, tzinfo=la).astimezone(timezone.utc)

    # 1. Fetch all topics for this date, ordered by position
    topic_rows = (await db.execute(
        select(Topic).where(Topic.date == day).order_by(Topic.position)
    )).scalars().all()

    # 2. Fetch ALL tweets for this date in one query
    all_tweets = (await db.execute(
        select(Tweet)
        .where(Tweet.saved_at >= day_start, Tweet.saved_at <= day_end)
        .order_by(Tweet.saved_at.desc(), Tweet.id.desc())
    )).scalars().all()

    # 3. Fetch all assignments for these tweets in one query
    tweet_ids = [t.id for t in all_tweets]
    assignments: list[TweetAssignment] = []
    if tweet_ids:
        assignments = (await db.execute(
            select(TweetAssignment).where(TweetAssignment.tweet_id.in_(tweet_ids))
        )).scalars().all()

    # Build lookup: tweet_id -> list of (topic_id, category)
    assign_map: dict[int, list[tuple[int, str | None]]] = {}
    for a in assignments:
        assign_map.setdefault(a.tweet_id, []).append((a.topic_id, a.category))

    # Build set of assigned tweet IDs (to any topic on this date)
    topic_ids = {t.id for t in topic_rows}
    assigned_tweet_ids: set[int] = set()

    # Build topic bundles
    topics: list[TopicBundle] = []
    for topic in topic_rows:
        topic_tweets: list[TweetOut] = []
        for tweet in all_tweets:
            for topic_id, category in assign_map.get(tweet.id, []):
                if topic_id == topic.id:
                    out = TweetOut.model_validate(tweet)
                    out.category = category
                    topic_tweets.append(out)
                    assigned_tweet_ids.add(tweet.id)
                    break
        tb = TopicBundle.model_validate(topic)
        tb.tweet_count = len(topic_tweets)
        tb.tweets = topic_tweets
        topics.append(tb)

    # Unsorted = tweets not assigned to any topic for this date
    unsorted = [
        TweetOut.model_validate(t) for t in all_tweets
        if t.id not in assigned_tweet_ids
    ]

    return DayBundle(topics=topics, unsorted=unsorted)
```

**Step 4: Register the router in main.py**

Add after the topics router import in `backend/app/main.py`:

```python
from app.routers.days import router as days_router
app.include_router(days_router)
```

**Step 5: Run test to verify it passes**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_tweets_api.py::test_day_bundle -v`
Expected: PASS

**Step 6: Run all tests to check for regressions**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -q`
Expected: All pass

**Step 7: Commit**

```bash
git add backend/app/routers/days.py backend/app/schemas/day_bundle.py backend/app/main.py backend/tests/test_tweets_api.py
git commit -m "feat: add GET /api/days/{date}/bundle endpoint"
```

---

### Task 3: Frontend — useDayBundle Hook

**Files:**
- Create: `frontend/src/api/dayBundle.ts`

**Step 1: Create the hook file**

```typescript
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { api } from './client'
import type { Tweet } from './tweets'
import type { Topic } from './topics'

export interface TopicBundle extends Topic {
  tweets: Tweet[]
  tweet_count: number
}

export interface DayBundle {
  topics: TopicBundle[]
  unsorted: Tweet[]
}

export function useDayBundle(date: string) {
  return useQuery<DayBundle>({
    queryKey: ['day-bundle', date],
    queryFn: async () => {
      const { data } = await api.get(`/days/${date}/bundle`)
      return data
    },
  })
}
```

**Step 2: Commit**

```bash
git add frontend/src/api/dayBundle.ts
git commit -m "feat: add useDayBundle hook for consolidated data fetching"
```

---

### Task 4: Frontend — Optimistic Mutation Helpers

**Files:**
- Modify: `frontend/src/api/dayBundle.ts` (append to file created in Task 3)

These mutation hooks update the `['day-bundle', date]` cache directly instead of calling `invalidateQueries`.

**Step 1: Add optimistic assign mutation**

Append to `frontend/src/api/dayBundle.ts`:

```typescript
export function useOptimisticAssign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { tweet_ids: number[]; topic_id: number; category?: string | null }) => {
      const { data } = await api.post('/tweets/assign', body)
      return data
    },
    onMutate: async (body) => {
      // Cancel in-flight queries to avoid overwriting our optimistic update
      await qc.cancelQueries({ queryKey: ['day-bundle'] })

      // Snapshot all day-bundle caches (we may not know which date)
      const prev: [string, DayBundle][] = []
      qc.getQueriesData<DayBundle>({ queryKey: ['day-bundle'] }).forEach(([key, data]) => {
        if (data) prev.push([key[1] as string, data])
      })

      // Optimistically update
      qc.setQueriesData<DayBundle>({ queryKey: ['day-bundle'] }, (old) => {
        if (!old) return old
        const tweetIdSet = new Set(body.tweet_ids)
        // Find tweets being assigned (could be in unsorted or another topic)
        const movingTweets: Tweet[] = []
        // Remove from unsorted
        const newUnsorted = old.unsorted.filter((t) => {
          if (tweetIdSet.has(t.id)) { movingTweets.push(t); return false }
          return true
        })
        // Remove from other topics
        const newTopics = old.topics.map((topic) => {
          const filtered = topic.tweets.filter((t) => {
            if (tweetIdSet.has(t.id)) { movingTweets.push(t); return false }
            return true
          })
          return { ...topic, tweets: filtered, tweet_count: filtered.length }
        })
        // Add to target topic
        const finalTopics = newTopics.map((topic) => {
          if (topic.id !== body.topic_id) return topic
          const tweetsToAdd = movingTweets.map((t) => ({
            ...t,
            category: body.category ?? t.category ?? null,
          }))
          const merged = [...topic.tweets, ...tweetsToAdd]
          return { ...topic, tweets: merged, tweet_count: merged.length }
        })
        return { topics: finalTopics, unsorted: newUnsorted }
      })
      return { prev }
    },
    onError: (_err, _body, context) => {
      // Rollback on error
      if (context?.prev) {
        for (const [date, data] of context.prev) {
          qc.setQueryData(['day-bundle', date], data)
        }
      }
    },
  })
}

export function useOptimisticUnassign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { tweet_ids: number[]; topic_id: number }) => {
      const { data } = await api.post('/tweets/unassign', body)
      return data
    },
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: ['day-bundle'] })
      const prev: [string, DayBundle][] = []
      qc.getQueriesData<DayBundle>({ queryKey: ['day-bundle'] }).forEach(([key, data]) => {
        if (data) prev.push([key[1] as string, data])
      })

      qc.setQueriesData<DayBundle>({ queryKey: ['day-bundle'] }, (old) => {
        if (!old) return old
        const tweetIdSet = new Set(body.tweet_ids)
        const movingTweets: Tweet[] = []
        const newTopics = old.topics.map((topic) => {
          if (topic.id !== body.topic_id) return topic
          const filtered = topic.tweets.filter((t) => {
            if (tweetIdSet.has(t.id)) {
              movingTweets.push({ ...t, category: undefined })
              return false
            }
            return true
          })
          return { ...topic, tweets: filtered, tweet_count: filtered.length }
        })
        return { topics: newTopics, unsorted: [...movingTweets, ...old.unsorted] }
      })
      return { prev }
    },
    onError: (_err, _body, context) => {
      if (context?.prev) {
        for (const [date, data] of context.prev) {
          qc.setQueryData(['day-bundle', date], data)
        }
      }
    },
  })
}

export function useOptimisticDeleteTweet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/tweets/${id}`)
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['day-bundle'] })
      const prev: [string, DayBundle][] = []
      qc.getQueriesData<DayBundle>({ queryKey: ['day-bundle'] }).forEach(([key, data]) => {
        if (data) prev.push([key[1] as string, data])
      })
      qc.setQueriesData<DayBundle>({ queryKey: ['day-bundle'] }, (old) => {
        if (!old) return old
        return {
          topics: old.topics.map((t) => {
            const filtered = t.tweets.filter((tw) => tw.id !== id)
            return { ...t, tweets: filtered, tweet_count: filtered.length }
          }),
          unsorted: old.unsorted.filter((tw) => tw.id !== id),
        }
      })
      return { prev }
    },
    onError: (_err, _id, context) => {
      if (context?.prev) {
        for (const [date, data] of context.prev) {
          qc.setQueryData(['day-bundle', date], data)
        }
      }
    },
  })
}

export function useOptimisticPatchTweet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: number; memo?: string | null; saved_at?: string }) => {
      const { data } = await api.patch(`/tweets/${id}`, body)
      return data
    },
    onSuccess: () => {
      // Patch can change saved_at (move to different date), so refetch all bundles
      qc.invalidateQueries({ queryKey: ['day-bundle'] })
    },
  })
}
```

**Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add frontend/src/api/dayBundle.ts
git commit -m "feat: add optimistic mutation hooks for day bundle"
```

---

### Task 5: Frontend — Rewire DayFeedPanel to Use Day Bundle

**Files:**
- Modify: `frontend/src/components/DayFeedPanel.tsx`
- Modify: `frontend/src/components/TopicSection.tsx`

This is the core wiring change. DayFeedPanel switches from `useTopics` + `useTweets` to `useDayBundle`, and passes tweet data down to TopicSection instead of TopicSection fetching its own data.

**Step 1: Update TopicSection to accept tweets as props instead of fetching**

In `frontend/src/components/TopicSection.tsx`, replace `TopicSectionWithData` (lines 104-166) with a version that receives tweets as props:

```typescript
export function TopicSectionWithData({
  topicId,
  title,
  color,
  date,
  search,
  ogTweetId,
  onDelete,
  onUpdateTitle,
  onSetOg,
  onContextMenu,
  tweets: propTweets,
}: TopicSectionWithDataProps & { tweets?: Tweet[] }) {
  // If tweets are passed as props (from day bundle), use them. Otherwise fetch (legacy).
  const tweetsQuery = useTweets({ date, topic_id: topicId, q: search || undefined })
  const tweets = propTweets ?? tweetsQuery.data ?? []
  const { data: activeScript } = useTopicScript(topicId)
  const { showEngagement } = useEngagementToggle()
```

This is backward-compatible: existing callers without `tweets` prop still work via the query.

**Step 2: Update DayFeedPanel to use useDayBundle**

Replace the data fetching and mutation sections in `frontend/src/components/DayFeedPanel.tsx`:

- Replace `useTopics(date)` + `useTweets({ date, unassigned: true, q: search })` with `useDayBundle(date)`
- Replace `useAssignTweets()` / `useUnassignTweets()` / `useDeleteTweet()` / `usePatchTweet()` with optimistic versions from `dayBundle.ts`
- Derive `topics` and `unsortedTweets` from the bundle, filtering by search client-side
- Pass `tweets` prop to `TopicSectionWithData`

Key changes in DayFeedPanel:

```typescript
import { useDayBundle, useOptimisticAssign, useOptimisticUnassign, useOptimisticDeleteTweet, useOptimisticPatchTweet } from '../api/dayBundle'

// Replace old queries:
const bundleQuery = useDayBundle(date)
const bundle = bundleQuery.data

// Derive topics and unsorted from bundle, with client-side search
const topics = bundle?.topics ?? []
const unsortedTweets = useMemo(() => {
  const list = bundle?.unsorted ?? []
  if (!search) return list
  const q = search.toLowerCase()
  return list.filter((t) =>
    t.text.toLowerCase().includes(q) ||
    t.author_handle.toLowerCase().includes(q) ||
    (t.author_display_name?.toLowerCase().includes(q) ?? false)
  )
}, [bundle?.unsorted, search])

// Replace old mutations:
const assignMutation = useOptimisticAssign()
const unassignMutation = useOptimisticUnassign()
const deleteTweetMutation = useOptimisticDeleteTweet()
const patchTweetMutation = useOptimisticPatchTweet()

// Remove useCreateTopic invalidation — it should invalidate day-bundle instead
// (handled in next step)
```

Update TopicSectionWithData rendering to pass tweets and filter by search:

```tsx
{topics.map((topic) => {
  const filteredTweets = search
    ? topic.tweets.filter((t) =>
        t.text.toLowerCase().includes(search.toLowerCase()) ||
        t.author_handle.toLowerCase().includes(search.toLowerCase()) ||
        (t.author_display_name?.toLowerCase().includes(search.toLowerCase()) ?? false)
      )
    : topic.tweets
  return (
    <TopicSectionWithData
      key={topic.id}
      topicId={topic.id}
      title={topic.title}
      color={topic.color}
      date={date}
      search=""  // empty — search already applied client-side
      ogTweetId={topic.og_tweet_id}
      tweets={filteredTweets}
      onDelete={handleDeleteTopic}
      onUpdateTitle={handleUpdateTopicTitle}
      onSetOg={handleSetOg}
      onContextMenu={handleContextMenu}
    />
  )
})}
```

Update `isLoading` to use bundle query:

```typescript
const isLoading = bundleQuery.isLoading
```

**Step 3: Update topic/tweet mutation hooks to invalidate day-bundle**

Update `frontend/src/api/topics.ts` — change all `invalidateQueries` calls from `['topics']` and `['tweets']` to `['day-bundle']`:

```typescript
// useCreateTopic onSuccess:
onSuccess: () => qc.invalidateQueries({ queryKey: ['day-bundle'] }),

// useUpdateTopic onSuccess:
onSuccess: () => qc.invalidateQueries({ queryKey: ['day-bundle'] }),

// useDeleteTopic onSuccess:
onSuccess: () => qc.invalidateQueries({ queryKey: ['day-bundle'] }),
```

Update `frontend/src/api/scripts.ts` — change tweet invalidation to day-bundle:

```typescript
// useGenerateScript onSuccess (line 77-81):
onSuccess: (data) => {
  qc.invalidateQueries({ queryKey: ['script', data.topic_id] })
  qc.invalidateQueries({ queryKey: ['script-versions', data.topic_id] })
  // No longer invalidate tweets — grok_context update needs bundle refetch
  qc.invalidateQueries({ queryKey: ['day-bundle'] })
},
```

Also update `useFetchGrokContext` in `frontend/src/api/tweets.ts` to invalidate day-bundle:

```typescript
onSuccess: () => qc.invalidateQueries({ queryKey: ['day-bundle'] }),
```

**Step 4: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 5: Run backend tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -q`
Expected: All pass

**Step 6: Commit**

```bash
git add frontend/src/components/DayFeedPanel.tsx frontend/src/components/TopicSection.tsx frontend/src/api/topics.ts frontend/src/api/scripts.ts frontend/src/api/tweets.ts
git commit -m "feat: rewire DayFeedPanel to use day bundle with optimistic mutations"
```

---

### Task 6: Frontend — Lazy Carousel Panels

**Files:**
- Modify: `frontend/src/components/DayCarousel.tsx`

**Step 1: Only mount the active panel and adjacent panels with cache**

Replace the panel rendering in `DayCarousel.tsx` (lines 135-179). The key change: far panels (index 0, 4) don't mount DayFeedPanel at all. Adjacent panels (index 1, 3) only mount if we have cached data for them (they rendered previously as the active panel).

```typescript
{days.map((dayDate, i) => {
  const config = panelConfig[i]
  const isCenter = i === 2
  const isAdjacent = i === 1 || i === 3

  return (
    <div
      key={dayDate}
      style={{
        flex: `0 0 ${config.widthPct}%`,
        scrollSnapAlign: 'center',
        transform: `scale(${config.scale})`,
        opacity: config.opacity,
        transition: 'transform 0.3s ease, opacity 0.3s ease',
        transformOrigin: isCenter ? 'center top' : 'center center',
        position: 'relative',
        height: '100%',
        display: isCenter ? undefined : 'flex',
        alignItems: isCenter ? undefined : 'center',
      }}
    >
      {/* Click overlay for side panels */}
      {!isCenter && (
        <div
          onClick={() => onDateChange(dayDate)}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 3,
            cursor: 'pointer',
          }}
        />
      )}

      <div style={{ pointerEvents: isCenter ? 'auto' : 'none', height: '100%' }}>
        {(isCenter || isAdjacent) ? (
          <DayFeedPanel
            date={dayDate}
            search={isCenter ? search : ''}
            isActive={isCenter}
            activeDragTweet={isCenter ? activeDragTweet : null}
            setActiveDragTweet={setActiveDragTweet}
          />
        ) : (
          /* Far panels: empty placeholder */
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>{dayDate}</span>
          </div>
        )}
      </div>
    </div>
  )
})}
```

This reduces mounted panels from 5 to 3, and only the center panel's query is active (adjacent panels use stale cache from when they were active).

**Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add frontend/src/components/DayCarousel.tsx
git commit -m "perf: lazy carousel — only mount active and adjacent panels"
```

---

### Task 7: Frontend — Component Memoization

**Files:**
- Modify: `frontend/src/components/UnsortedSection.tsx`
- Modify: `frontend/src/components/TopicSection.tsx`

**Step 1: Memoize UnsortedSection**

Wrap the `UnsortedSection` export with `React.memo`:

```typescript
import { memo } from 'react'
// ... existing code ...
export const UnsortedSection = memo(function UnsortedSection({ ... }) {
  // ... existing implementation ...
})
```

Also wrap `DraggableFeedTweetCard` with `memo`:

```typescript
const DraggableFeedTweetCard = memo(function DraggableFeedTweetCard({ ... }) {
  // ... existing implementation ...
})
```

**Step 2: Memoize TopicSection internals**

Wrap `DraggableTweetInTopic` (around line 169 of TopicSection.tsx) with `React.memo`:

```typescript
import { memo } from 'react'
// ...
const DraggableTweetInTopic = memo(function DraggableTweetInTopic({ ... }) {
  // ... existing implementation ...
})
```

**Step 3: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/components/UnsortedSection.tsx frontend/src/components/TopicSection.tsx
git commit -m "perf: memoize UnsortedSection, DraggableFeedTweetCard, DraggableTweetInTopic"
```

---

### Task 8: Frontend — Deferred Script Queries

**Files:**
- Modify: `frontend/src/components/TopicSection.tsx`

**Step 1: Only fetch script when script view is toggled on**

In `TopicSectionWithData`, the `useTopicScript(topicId)` call at line 118 currently runs unconditionally. Change it to only run when the user has toggled script view for that topic.

The `showScript` state lives in the presentational `TopicSection` component. To avoid a major refactor, hoist the `showScript` state into `TopicSectionWithData` and pass it down:

```typescript
export function TopicSectionWithData({ ... }) {
  const [showScript, setShowScript] = useState(false)
  // Only fetch script when user opens script view
  const { data: activeScript } = useTopicScript(showScript ? topicId : undefined)
  // ...
  return (
    <TopicSection
      // ... existing props ...
      showScript={showScript}
      onToggleScript={() => setShowScript((v) => !v)}
    />
  )
}
```

Update the `TopicSection` presentational component to accept `showScript` and `onToggleScript` as props instead of managing its own state.

**Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add frontend/src/components/TopicSection.tsx
git commit -m "perf: defer script queries until user toggles script view"
```

---

### Task 9: Cleanup — Remove Unused Old Hooks

**Files:**
- Modify: `frontend/src/api/tweets.ts`
- Modify: `frontend/src/components/DayFeedPanel.tsx`

**Step 1: Verify no remaining callers of old mutation hooks**

Search for `useAssignTweets`, `useUnassignTweets`, `useDeleteTweet`, `usePatchTweet` across the frontend. If DayFeedPanel was the only caller, these are now dead code.

Keep `useTweets` — it's still used by `TopicSectionWithData` as a fallback (the `?? tweetsQuery.data` path) and possibly by thread views. Also keep `useFetchGrokContext` — it's used by TweetCard.

Remove: `useAssignTweets`, `useUnassignTweets`, `useDeleteTweet`, `usePatchTweet` from `tweets.ts` **only if** no other file imports them.

**Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (confirms nothing else imports the removed hooks)

**Step 3: Commit**

```bash
git add frontend/src/api/tweets.ts
git commit -m "chore: remove unused tweet mutation hooks replaced by optimistic day-bundle hooks"
```

---

### Task 10: Integration Test & Deploy

**Step 1: Run all backend tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -q`
Expected: All pass

**Step 2: Run frontend TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 3: Manual smoke test**

Start dev environment: `docker compose up`

Test each interaction:
- [ ] Initial page load — single network request per day (check Network tab for `/api/days/{date}/bundle`)
- [ ] Navigate between dates — only 1 new bundle request (not N+1)
- [ ] Assign tweet to topic — instant UI update, no refetch in Network tab
- [ ] Unassign tweet — instant move to unsorted, no refetch
- [ ] Set category — instant update, no refetch
- [ ] Move to topic (context menu) — instant, no refetch
- [ ] Delete tweet — instant removal, no refetch
- [ ] Search — instant client-side filtering, no network request
- [ ] Create topic — bundle refetch (expected for structural change)
- [ ] Undo works after assign/unassign/move

**Step 4: Commit any fixes**

**Step 5: Deploy**

```bash
ssh -i ~/wk_clawd root@46.225.9.10 "cd ~/tpot-digest && git pull origin master && docker compose -f docker-compose.prod.yml up --build -d"
```
