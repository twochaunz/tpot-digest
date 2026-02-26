# Dashboard Performance Optimization — Design

## Problem

The dashboard is slow on initial load, date navigation, and tweet reorganization (recategorize, move to topic). With 8 topics per day, the frontend fires ~9 queries per carousel panel. Across 5 panels that's ~45 requests. Mutations trigger `invalidateQueries` causing full refetch cascades.

Target scale: 30-80 tweets/day now, multi-user in future.

## Solution: A+B (Query Consolidation + Rendering Optimization)

### 1. Day Bundle Endpoint

New `GET /api/days/{date}/bundle` returns all data for a day in one response:

```json
{
  "topics": [
    { "id": 1, "title": "AI Drama", "color": "#ff0000", "position": 0, "og_tweet_id": 42,
      "tweets": [{ "id": 42, "text": "...", "category": "commentary", ... }]
    }
  ],
  "unsorted": [{ "id": 50, "text": "...", ... }]
}
```

- Backend: single query with JOINs instead of N+1
- Frontend: `useDayBundle(date)` replaces `useTopics(date)` + all `useTweets({date, topic_id})` calls
- Search filtering happens client-side (trivial for 30-80 tweets)

### 2. Optimistic Mutations (No Refetching)

All mutations update the `['day-bundle', date]` cache directly:

- **Move tweet to topic:** Remove from source, insert into target in cache
- **Set category:** Update category field on tweet in cache
- **Unassign:** Move from topic to unsorted in cache
- **Save tweet (from extension):** POST response contains full tweet, insert into unsorted in cache
- **Rollback on error:** React Query `onMutate`/`onError` reverts cache to previous snapshot

No `invalidateQueries` anywhere. Only real refetch is initial load or error rollback.

### 3. Lazy Carousel Panels

- **Active panel (center):** Fetches day bundle, renders fully
- **Adjacent panels (±1):** Render from cache if available, skeleton otherwise. Fetch on scroll-into-view.
- **Far panels (±2):** Don't mount. Mount when they become adjacent.

Date navigation triggers 1 fetch, not 5.

### 4. Frontend Rendering Optimizations

**Memoization:**
- Wrap `UnsortedSection`, `TopicSectionWithData`, `DraggableFeedTweetCard`, `DraggableTweetInTopic` in `React.memo`
- `useMemo` for derived data (tweetsByCategory grouping, filtered lists)

**Deferred script queries:**
- `useTopicScript(topicId)` only fetches when `enabled: showScript` (user toggled script view)
- Script mutations only invalidate the specific topic's script key

**Client-side search:**
- Day bundle loaded in full, search is `.filter()` on text/author in JS
- Instant as-you-type results, no network call
- Remove `q` parameter from tweet API calls

## What This Does NOT Include (Future: Approach C)

- Backend pagination
- WebSocket push for mutations
- Redis caching layer
- CDN for media proxying

These are for multi-user scale and will be added when there are concurrent users.
