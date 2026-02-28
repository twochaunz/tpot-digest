# Dashboard Carousel Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the dashboard as a 3-panel horizontal day carousel with embedded tweets (react-tweet), sticky topic headers, prominent tweet counts, and gentle magnetic snap scrolling.

**Architecture:** Extract the per-day feed into a `DayFeedPanel` component, wrap 5 panels in a CSS scroll-snap horizontal carousel (`DayCarousel`), replace custom TweetCard rendering with react-tweet's `<Tweet>` component, and add sticky topic headers with proximity snap scrolling.

**Tech Stack:** react-tweet (embedded tweets), CSS scroll-snap (carousel + topic snap), existing dnd-kit (drag-drop preserved)

---

### Task 1: Install react-tweet

**Files:**
- Modify: `frontend/package.json` (via npm install)

**Step 1: Install dependency**

```bash
cd /Users/wonchankim/Projects/happy-test/frontend && npm install react-tweet
```

**Step 2: Verify TypeScript**

```bash
cd /Users/wonchankim/Projects/happy-test/frontend && npx tsc --noEmit
```
Expected: No errors

**Step 3: Commit**

```bash
cd /Users/wonchankim/Projects/happy-test && git add frontend/package.json frontend/package-lock.json && git commit -m "chore: add react-tweet for embedded tweet rendering"
```

---

### Task 2: Create EmbeddedTweet component

**Files:**
- Create: `frontend/src/components/EmbeddedTweet.tsx`

This component replaces the custom `TweetCard` for non-legacy tweets. It wraps react-tweet's `<Tweet>` with our hover actions (delete, open on X), drag handle compatibility, and a fallback for deleted/unavailable tweets.

**Step 1: Create the component**

Create `frontend/src/components/EmbeddedTweet.tsx`:

```tsx
import { useState } from 'react'
import { Tweet } from 'react-tweet'
import type { Tweet as TweetData } from '../api/tweets'

interface EmbeddedTweetProps {
  tweet: TweetData
  onTweetClick?: (tweet: TweetData) => void
  onContextMenu?: (e: React.MouseEvent, tweet: TweetData) => void
  onDelete?: (id: number) => void
}

function FallbackCard({ tweet }: { tweet: TweetData }) {
  return (
    <div
      style={{
        padding: '14px 16px',
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        {tweet.author_avatar_url ? (
          <img
            src={tweet.author_avatar_url}
            alt={tweet.author_handle}
            style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--bg-elevated)' }} />
        )}
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            {tweet.author_display_name || `@${tweet.author_handle}`}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>@{tweet.author_handle}</div>
        </div>
      </div>
      <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
        {tweet.text}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8 }}>
        Tweet unavailable — showing cached data
      </div>
    </div>
  )
}

export function EmbeddedTweet({ tweet, onTweetClick, onContextMenu, onDelete }: EmbeddedTweetProps) {
  const [hovered, setHovered] = useState(false)
  const [embedError, setEmbedError] = useState(false)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault()
              onContextMenu(e, tweet)
            }
          : undefined
      }
      onClick={() => onTweetClick?.(tweet)}
      style={{
        position: 'relative',
        cursor: onTweetClick ? 'pointer' : 'default',
        maxWidth: 550,
      }}
    >
      {/* Embedded tweet or fallback */}
      {!embedError ? (
        <div data-theme="dark">
          <Tweet
            id={tweet.tweet_id}
            onError={() => setEmbedError(true)}
          />
        </div>
      ) : (
        <FallbackCard tweet={tweet} />
      )}

      {/* Hover actions */}
      {hovered && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            display: 'flex',
            gap: 4,
            zIndex: 2,
          }}
        >
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete(tweet.id)
              }}
              style={{
                width: 28,
                height: 28,
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(0,0,0,0.6)',
                border: 'none',
                color: '#fff',
                fontSize: 14,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Remove tweet"
            >
              &times;
            </button>
          )}
          {tweet.url && (
            <a
              href={tweet.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 28,
                height: 28,
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(0,0,0,0.6)',
                border: 'none',
                color: '#fff',
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textDecoration: 'none',
              }}
              title="Open on X"
            >
              &#8599;
            </a>
          )}
        </div>
      )}
    </div>
  )
}
```

**Step 2: Verify TypeScript**

```bash
cd /Users/wonchankim/Projects/happy-test/frontend && npx tsc --noEmit
```

**Step 3: Commit**

```bash
cd /Users/wonchankim/Projects/happy-test && git add frontend/src/components/EmbeddedTweet.tsx && git commit -m "feat: add EmbeddedTweet component using react-tweet"
```

---

### Task 3: Update UnsortedSection to use EmbeddedTweet

**Files:**
- Modify: `frontend/src/components/UnsortedSection.tsx`

Replace the `TweetCard` import and usage with `EmbeddedTweet` for non-legacy tweets. Keep the drag handle wrapper.

**Step 1: Update imports and DraggableFeedTweetCard**

In `UnsortedSection.tsx`, change the import from `TweetCard` to `EmbeddedTweet`:

Replace:
```tsx
import { TweetCard } from './TweetCard'
```

With:
```tsx
import { EmbeddedTweet } from './EmbeddedTweet'
```

Then in the `DraggableFeedTweetCard` component, replace the `TweetCard` usage (lines 74-81) with:

```tsx
      <EmbeddedTweet
        tweet={tweet}
        onTweetClick={onTweetClick}
        onContextMenu={onContextMenu}
        onDelete={onDelete}
      />
```

Remove `showEngagement` from the props since react-tweet handles its own engagement display. Remove the `showEngagement` prop from `DraggableFeedTweetCard` interface and `UnsortedSectionProps`.

**Step 2: Verify TypeScript**

```bash
cd /Users/wonchankim/Projects/happy-test/frontend && npx tsc --noEmit
```

**Step 3: Commit**

```bash
cd /Users/wonchankim/Projects/happy-test && git add frontend/src/components/UnsortedSection.tsx && git commit -m "feat: use EmbeddedTweet in UnsortedSection"
```

---

### Task 4: Update TopicSection to use EmbeddedTweet + sticky headers + prominent count

**Files:**
- Modify: `frontend/src/components/TopicSection.tsx`

Three changes:
1. Replace `TweetCard` with `EmbeddedTweet`
2. Make topic headers sticky (position: sticky, top below main header ~65px)
3. Make the tweet count badge more prominent (larger, pill-shaped, topic accent color background)
4. Add `scrollIntoView` when topic is opened

**Step 1: Update the component**

In `TopicSection.tsx`:

a) Change import from `TweetCard` to `EmbeddedTweet`:
```tsx
import { EmbeddedTweet } from './EmbeddedTweet'
```

b) In `DraggableTweetInTopic`, replace `TweetCard` usage (lines 97-103) with:
```tsx
        <EmbeddedTweet
          tweet={tweet}
          onTweetClick={onTweetClick}
          onContextMenu={onContextMenu}
        />
```

Remove `showEngagement` prop from `DraggableTweetInTopic` and its callers.

c) Add a ref to the topic section container. In `TopicSection`, add:
```tsx
const sectionRef = useRef<HTMLDivElement>(null)
```

d) Make the header sticky. Change the header div's style to include:
```tsx
position: 'sticky' as const,
top: 65,
zIndex: 5,
background: 'var(--bg-raised)',
```

e) Replace the count badge (lines 267-275) with a more prominent pill:
```tsx
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: '#fff',
            background: accentColor,
            padding: '2px 10px',
            borderRadius: 12,
            minWidth: 28,
            textAlign: 'center',
          }}
        >
          {totalTweets}
        </span>
```

f) Add scrollIntoView when topic is opened. Change the collapse toggle handler from:
```tsx
onClick={() => setCollapsed((v) => !v)}
```
To:
```tsx
onClick={() => {
  setCollapsed((v) => {
    const next = !v
    if (!next && sectionRef.current) {
      setTimeout(() => {
        sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    }
    return next
  })
}}
```

g) Attach `sectionRef` to the outer container div (the one with `style={{ width: '100%', ... }}`).

h) Remove `showEngagement` from `TopicSectionProps`, `TopicSectionWithDataProps`, and all related prop passing since react-tweet handles its own display.

**Step 2: Verify TypeScript**

```bash
cd /Users/wonchankim/Projects/happy-test/frontend && npx tsc --noEmit
```

**Step 3: Commit**

```bash
cd /Users/wonchankim/Projects/happy-test && git add frontend/src/components/TopicSection.tsx && git commit -m "feat: embedded tweets, sticky topic headers, prominent count badges"
```

---

### Task 5: Create DayFeedPanel component

**Files:**
- Create: `frontend/src/components/DayFeedPanel.tsx`

Extract the per-day feed content (unsorted section + topic sections + create topic form) from `DailyView` into its own component. This component represents one day's feed and will be used inside the carousel.

**Step 1: Create the component**

Create `frontend/src/components/DayFeedPanel.tsx`:

```tsx
import { useCallback, useRef } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
} from '@dnd-kit/core'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import { useTweets, useAssignTweets, useUnassignTweets, useDeleteTweet, usePatchTweet } from '../api/tweets'
import type { Tweet } from '../api/tweets'
import { useTopics, useCreateTopic, useDeleteTopic, useUpdateTopic } from '../api/topics'
import { useUndo } from '../hooks/useUndo'
import { UnsortedSection } from './UnsortedSection'
import { TopicSectionWithData } from './TopicSection'
import { CreateTopicForm } from './CreateTopicForm'
import { DragOverlayCard } from './DragOverlayCard'
import { UndoToast } from './UndoToast'
import { ContextMenu } from './ContextMenu'

interface DayFeedPanelProps {
  date: string
  search: string
  isActive: boolean
  onTweetClick: (tweet: Tweet) => void
  activeDragTweet: Tweet | null
  setActiveDragTweet: (tweet: Tweet | null) => void
}

export function DayFeedPanel({
  date,
  search,
  isActive,
  onTweetClick,
  activeDragTweet,
  setActiveDragTweet,
}: DayFeedPanelProps) {
  const feedRef = useRef<HTMLDivElement>(null)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tweet: Tweet } | null>(null)

  // Data
  const topicsQuery = useTopics(date)
  const unsortedQuery = useTweets({ date, unassigned: true, q: search || undefined })
  const topics = topicsQuery.data ?? []
  const unsortedTweets = unsortedQuery.data ?? []

  // Mutations
  const assignMutation = useAssignTweets()
  const unassignMutation = useUnassignTweets()
  const createTopicMutation = useCreateTopic()
  const deleteTweetMutation = useDeleteTweet()
  const deleteTopicMutation = useDeleteTopic()
  const updateTopicMutation = useUpdateTopic()
  const patchTweetMutation = usePatchTweet()

  // Undo
  const undo = useUndo(date)

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  )

  const handleAssign = useCallback(
    (tweetIds: number[], topicId: number, categoryId?: number) => {
      assignMutation.mutate({ tweet_ids: tweetIds, topic_id: topicId, category_id: categoryId })
      undo.push({
        label: `${tweetIds.length} tweet${tweetIds.length > 1 ? 's' : ''} assigned`,
        undo: () => unassignMutation.mutate({ tweet_ids: tweetIds, topic_id: topicId }),
      })
    },
    [assignMutation, unassignMutation, undo],
  )

  const handleUnassign = useCallback(
    (tweetIds: number[], topicId: number) => {
      unassignMutation.mutate({ tweet_ids: tweetIds, topic_id: topicId })
      undo.push({
        label: `${tweetIds.length} tweet${tweetIds.length > 1 ? 's' : ''} unassigned`,
        undo: () => assignMutation.mutate({ tweet_ids: tweetIds, topic_id: topicId }),
      })
    },
    [unassignMutation, assignMutation, undo],
  )

  const handleCreateTopic = useCallback(
    (title: string, color: string) => {
      createTopicMutation.mutate({ title, date, color })
    },
    [createTopicMutation, date],
  )

  const handleDeleteTweet = useCallback(
    (tweetId: number) => deleteTweetMutation.mutate(tweetId),
    [deleteTweetMutation],
  )

  const handleDeleteTopic = useCallback(
    (topicId: number) => deleteTopicMutation.mutate(topicId),
    [deleteTopicMutation],
  )

  const handleUpdateTopicTitle = useCallback(
    (topicId: number, title: string) => updateTopicMutation.mutate({ id: topicId, title }),
    [updateTopicMutation],
  )

  const handleContextMenu = useCallback((e: React.MouseEvent, tweet: Tweet) => {
    setContextMenu({ x: e.clientX, y: e.clientY, tweet })
  }, [])

  const handleMoveToDate = useCallback(
    (tweetId: number, targetDate: string) => {
      const originalDate = date
      patchTweetMutation.mutate({ id: tweetId, saved_at: `${targetDate}T12:00:00` })
      undo.push({
        label: 'Tweet moved to ' + targetDate,
        undo: () => patchTweetMutation.mutate({ id: tweetId, saved_at: `${originalDate}T12:00:00` }),
      })
    },
    [patchTweetMutation, undo, date],
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const tweet = event.active.data.current?.tweet as Tweet | undefined
    if (tweet) setActiveDragTweet(tweet)
  }, [setActiveDragTweet])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragTweet(null)
      const { active, over } = event
      if (!over) return
      const tweet = active.data.current?.tweet as Tweet | undefined
      const sourceTopicId = active.data.current?.sourceTopicId as number | null
      if (!tweet) return
      const overId = over.id as string

      if (overId === 'droppable-unsorted') {
        if (sourceTopicId === null) return
        handleUnassign([tweet.id], sourceTopicId)
      } else if (overId.startsWith('droppable-topic-')) {
        const targetTopicId = parseInt(overId.replace('droppable-topic-', ''), 10)
        if (sourceTopicId === null) {
          handleAssign([tweet.id], targetTopicId)
        } else if (sourceTopicId === targetTopicId) {
          return
        } else {
          unassignMutation.mutate({ tweet_ids: [tweet.id], topic_id: sourceTopicId })
          assignMutation.mutate({ tweet_ids: [tweet.id], topic_id: targetTopicId })
          undo.push({
            label: 'Tweet reassigned',
            undo: () => {
              unassignMutation.mutate({ tweet_ids: [tweet.id], topic_id: targetTopicId })
              assignMutation.mutate({ tweet_ids: [tweet.id], topic_id: sourceTopicId })
            },
          })
        }
      }
    },
    [handleAssign, handleUnassign, assignMutation, unassignMutation, undo, setActiveDragTweet],
  )

  const isLoading = topicsQuery.isLoading || unsortedQuery.isLoading

  return (
    <div
      ref={feedRef}
      style={{
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '16px 16px 80px',
        scrollSnapType: 'y proximity',
      }}
    >
      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
          <div style={{ fontSize: 14, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                display: 'inline-block',
                width: 14,
                height: 14,
                border: '2px solid var(--border-strong)',
                borderTopColor: 'var(--accent)',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
            Loading...
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {!isLoading && (
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {unsortedTweets.length === 0 && topics.length === 0 && !search && (
            <div style={{ textAlign: 'center', padding: '80px 0 40px' }}>
              <div style={{ fontSize: 36, marginBottom: 16, opacity: 0.3 }}>&#9776;</div>
              <h2 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8 }}>
                No tweets for this day
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-tertiary)', maxWidth: 360, margin: '0 auto' }}>
                Save tweets from Twitter using the Chrome extension, and they will appear here.
              </p>
            </div>
          )}

          <UnsortedSection
            tweets={unsortedTweets}
            onDelete={handleDeleteTweet}
            onTweetClick={onTweetClick}
            onContextMenu={handleContextMenu}
          />

          {topics.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {topics.map((topic) => (
                <TopicSectionWithData
                  key={topic.id}
                  topicId={topic.id}
                  title={topic.title}
                  color={topic.color}
                  date={date}
                  search={search}
                  onDelete={handleDeleteTopic}
                  onUpdateTitle={handleUpdateTopicTitle}
                  onTweetClick={onTweetClick}
                  onContextMenu={handleContextMenu}
                />
              ))}
            </div>
          )}

          {isActive && (
            <div style={{ marginTop: 16, maxWidth: 550 }}>
              <CreateTopicForm
                onSubmit={handleCreateTopic}
                loading={createTopicMutation.isPending}
                topicCount={topics.length}
              />
            </div>
          )}

          <DragOverlay>
            {activeDragTweet ? <DragOverlayCard tweet={activeDragTweet} /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          tweet={contextMenu.tweet}
          onClose={() => setContextMenu(null)}
          onDelete={handleDeleteTweet}
          onMoveToDate={handleMoveToDate}
        />
      )}

      <UndoToast
        action={undo.toast}
        onUndo={undo.undoLast}
        onDismiss={undo.dismissToast}
      />
    </div>
  )
}
```

Note: You'll need to add `import { useState } from 'react'` at the top since `contextMenu` uses `useState`.

**Step 2: Verify TypeScript**

```bash
cd /Users/wonchankim/Projects/happy-test/frontend && npx tsc --noEmit
```

**Step 3: Commit**

```bash
cd /Users/wonchankim/Projects/happy-test && git add frontend/src/components/DayFeedPanel.tsx && git commit -m "feat: extract DayFeedPanel component from DailyView"
```

---

### Task 6: Create DayCarousel component + rewrite DailyView

**Files:**
- Create: `frontend/src/components/DayCarousel.tsx`
- Modify: `frontend/src/pages/DailyView.tsx` (full rewrite)

The carousel loads 5 day panels (current ± 2), shows 3 at once with CSS scroll-snap. Center panel is full-size, side panels are scaled down and dimmed.

**Step 1: Create DayCarousel component**

Create `frontend/src/components/DayCarousel.tsx`:

```tsx
import { useRef, useEffect, useCallback, useState } from 'react'
import { DayFeedPanel } from './DayFeedPanel'
import type { Tweet } from '../api/tweets'

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + days)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function formatShortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface DayCarouselProps {
  date: string
  onDateChange: (date: string) => void
  search: string
  onTweetClick: (tweet: Tweet) => void
}

export function DayCarousel({ date, onDateChange, search, onTweetClick }: DayCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeDragTweet, setActiveDragTweet] = useState<Tweet | null>(null)
  const isScrolling = useRef(false)

  // Generate 5 days: current ± 2
  const days = [-2, -1, 0, 1, 2].map((offset) => shiftDate(date, offset))

  // Scroll to center panel on mount and when date changes
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const centerPanel = el.children[2] as HTMLElement
    if (centerPanel) {
      isScrolling.current = true
      el.scrollTo({ left: centerPanel.offsetLeft - (el.clientWidth - centerPanel.clientWidth) / 2, behavior: 'instant' })
      setTimeout(() => { isScrolling.current = false }, 100)
    }
  }, [date])

  // Detect scroll-snap settle to update date
  const handleScroll = useCallback(() => {
    if (isScrolling.current) return
    const el = scrollRef.current
    if (!el) return

    // Debounce: detect which panel is centered
    clearTimeout((el as any)._scrollTimer)
    ;(el as any)._scrollTimer = setTimeout(() => {
      const centerX = el.scrollLeft + el.clientWidth / 2
      let closestIdx = 2
      let closestDist = Infinity
      for (let i = 0; i < el.children.length; i++) {
        const child = el.children[i] as HTMLElement
        const childCenter = child.offsetLeft + child.clientWidth / 2
        const dist = Math.abs(centerX - childCenter)
        if (dist < closestDist) {
          closestDist = dist
          closestIdx = i
        }
      }
      if (closestIdx !== 2) {
        onDateChange(days[closestIdx])
      }
    }, 150)
  }, [days, onDateChange])

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onDateChange(shiftDate(date, -1))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onDateChange(shiftDate(date, 1))
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [date, onDateChange])

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      style={{
        display: 'flex',
        overflowX: 'auto',
        scrollSnapType: 'x mandatory',
        height: 'calc(100vh - 65px)',
        scrollbarWidth: 'none',
      }}
    >
      <style>{`
        .day-carousel::-webkit-scrollbar { display: none; }
      `}</style>
      {days.map((d, i) => {
        const isCenter = i === 2
        const isAdjacent = i === 1 || i === 3
        return (
          <div
            key={d}
            style={{
              flexShrink: 0,
              width: isCenter ? '60%' : '20%',
              scrollSnapAlign: 'center',
              transform: isCenter ? 'scale(1)' : isAdjacent ? 'scale(0.88)' : 'scale(0.82)',
              opacity: isCenter ? 1 : isAdjacent ? 0.5 : 0.3,
              transition: 'transform 0.3s ease, opacity 0.3s ease',
              borderLeft: isCenter ? 'none' : '1px solid var(--border)',
              borderRight: isCenter ? 'none' : '1px solid var(--border)',
              position: 'relative',
            }}
          >
            {/* Date label for side panels */}
            {!isCenter && (
              <div
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 3,
                  background: 'var(--bg-base)',
                  borderBottom: '1px solid var(--border)',
                  padding: '8px 12px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-tertiary)',
                  textAlign: 'center',
                }}
              >
                {formatShortDate(d)}
              </div>
            )}
            <DayFeedPanel
              date={d}
              search={isCenter ? search : ''}
              isActive={isCenter}
              onTweetClick={onTweetClick}
              activeDragTweet={isCenter ? activeDragTweet : null}
              setActiveDragTweet={setActiveDragTweet}
            />
          </div>
        )
      })}
    </div>
  )
}
```

**Step 2: Rewrite DailyView**

Replace the entire contents of `frontend/src/pages/DailyView.tsx` with:

```tsx
import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Tweet } from '../api/tweets'
import { useEngagementToggle } from '../hooks/useEngagementToggle'
import { DatePicker } from '../components/DatePicker'
import { DayCarousel } from '../components/DayCarousel'
import { TweetDetailModal } from '../components/TweetDetailModal'

function todayStr(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function DailyView() {
  const navigate = useNavigate()
  const [date, setDate] = useState(todayStr)
  const [search, setSearch] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [detailTweet, setDetailTweet] = useState<Tweet | null>(null)
  const { showEngagement, toggle: toggleEngagement } = useEngagementToggle()

  const handleTweetClick = useCallback((tweet: Tweet) => {
    setDetailTweet(tweet)
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      {/* Header — centered date */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          background: 'var(--bg-base)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            maxWidth: 1400,
            margin: '0 auto',
            padding: '12px 24px',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {/* Left: search */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="Search tweets..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                style={{
                  width: searchFocused || search ? 240 : 180,
                  background: 'var(--bg-raised)',
                  border: `1px solid ${searchFocused ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '7px 12px 7px 32px',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  outline: 'none',
                  transition: 'all 0.2s ease',
                  fontFamily: 'var(--font-body)',
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-tertiary)',
                  fontSize: 14,
                  pointerEvents: 'none',
                }}
              >
                &#8981;
              </span>
            </div>
          </div>

          {/* Center: date picker */}
          <DatePicker value={date} onChange={setDate} />

          {/* Right: engagement toggle + settings */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
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

            <button
              onClick={() => navigate('/app/settings')}
              style={{
                background: 'none',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                width: 34,
                height: 34,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                fontSize: 16,
                transition: 'all 0.15s ease',
              }}
              aria-label="Settings"
            >
              &#9881;
            </button>
          </div>
        </div>
      </header>

      {/* Carousel */}
      <DayCarousel
        date={date}
        onDateChange={setDate}
        search={search}
        onTweetClick={handleTweetClick}
      />

      {/* Tweet detail modal */}
      {detailTweet && (
        <TweetDetailModal
          tweet={detailTweet}
          onClose={() => setDetailTweet(null)}
          showEngagement={showEngagement}
        />
      )}
    </div>
  )
}
```

**Step 3: Verify TypeScript**

```bash
cd /Users/wonchankim/Projects/happy-test/frontend && npx tsc --noEmit
```

**Step 4: Commit**

```bash
cd /Users/wonchankim/Projects/happy-test && git add frontend/src/components/DayCarousel.tsx frontend/src/pages/DailyView.tsx && git commit -m "feat: 3-panel day carousel with centered date header"
```

---

### Task 7: Add carousel scrollbar hiding CSS

**Files:**
- Modify: `frontend/src/styles/design-system.css`

**Step 1: Add class for the carousel**

At the end of `design-system.css`, add:

```css
/* Hide scrollbar on carousel */
.day-carousel {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.day-carousel::-webkit-scrollbar {
  display: none;
}
```

**Step 2: Update DayCarousel to use the class**

In `DayCarousel.tsx`, add `className="day-carousel"` to the scroll container div and remove the inline `<style>` tag and `scrollbarWidth: 'none'`.

**Step 3: Verify TypeScript**

```bash
cd /Users/wonchankim/Projects/happy-test/frontend && npx tsc --noEmit
```

**Step 4: Commit**

```bash
cd /Users/wonchankim/Projects/happy-test && git add frontend/src/styles/design-system.css frontend/src/components/DayCarousel.tsx && git commit -m "style: hide carousel scrollbar with CSS class"
```

---

### Task 8: Final verification and cleanup

**Step 1: Run backend tests**

```bash
backend/.venv/bin/python -m pytest backend/tests/ -q
```
Expected: All pass (backend unchanged in this plan)

**Step 2: Run frontend TypeScript check**

```bash
cd /Users/wonchankim/Projects/happy-test/frontend && npx tsc --noEmit
```
Expected: No errors

**Step 3: Check for unused imports in modified files**

Review `DailyView.tsx` to ensure old imports (UnsortedSection, TopicSection, CreateTopicForm, DndContext, etc.) are removed since they're now in DayFeedPanel.

**Step 4: Verify git status is clean**

```bash
git status
```
