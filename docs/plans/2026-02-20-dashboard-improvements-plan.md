# Dashboard Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the dashboard with calendar date picker, Kanban topic layout, undo system, feed-style unsorted inbox, inline category management, and tweet outlinks.

**Architecture:** All changes are frontend-only (React/TypeScript). The backend already exposes all needed APIs (`useDeleteTweet`, `useDeleteTopic`, `useDeleteCategory`, `useCreateCategory`) and includes `url` in `TweetOut`. We add new components (CalendarPopup, UndoToast, TopicColumn), refactor existing ones (DatePicker, UnsortedSection, TweetCard, AssignDropdown, DailyView), and create one new hook (useUndo).

**Tech Stack:** React 19, TypeScript, TanStack React Query, inline CSS (matching existing codebase patterns -- no CSS modules, no Tailwind)

---

### Task 1: Add `url` field to frontend Tweet interface

**Files:**
- Modify: `frontend/src/api/tweets.ts:4-19`

**Step 1: Add url to Tweet interface**

In `frontend/src/api/tweets.ts`, add `url: string | null` after `feed_source`:

```typescript
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
  url: string | null
  saved_at: string
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors (url is nullable, no consumers reference it yet)

**Step 3: Commit**

```bash
git add frontend/src/api/tweets.ts
git commit -m "feat: add url field to frontend Tweet interface"
```

---

### Task 2: Add tweet outlink icon to TweetCard

**Files:**
- Modify: `frontend/src/components/TweetCard.tsx:122-148`

**Step 1: Add outlink icon next to author handle**

In `TweetCard.tsx`, replace the info section (lines 122-148) with a version that includes an outlink icon. The `@handle` and outlink icon should be in a flex row. The outlink icon is a small SVG (external link arrow) that opens `tweet.url` in a new tab. Only show the icon if `tweet.url` is truthy.

```tsx
{/* Info */}
<div style={{ padding: '8px 10px' }}>
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      marginBottom: 2,
    }}
  >
    <span
      style={{
        fontSize: 12,
        fontWeight: 500,
        color: 'var(--text-primary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flex: 1,
      }}
    >
      @{tweet.author_handle}
    </span>
    {tweet.url && (
      <a
        href={tweet.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        style={{
          color: 'var(--text-tertiary)',
          fontSize: 11,
          lineHeight: 1,
          flexShrink: 0,
          textDecoration: 'none',
        }}
        title="Open on X"
      >
        &#8599;
      </a>
    )}
  </div>
  <div
    style={{
      fontSize: 11,
      color: 'var(--text-tertiary)',
      lineHeight: 1.4,
      display: '-webkit-box',
      WebkitLineClamp: 2,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden',
    }}
  >
    {truncate(tweet.text, 80)}
  </div>
</div>
```

**Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/components/TweetCard.tsx
git commit -m "feat: add outlink icon to tweet cards"
```

---

### Task 3: Calendar popup for DatePicker

**Files:**
- Modify: `frontend/src/components/DatePicker.tsx` (full rewrite)

**Step 1: Add calendar popup to DatePicker**

Rewrite `DatePicker.tsx` to include a calendar popup. Keep the existing prev/next arrow buttons and date text. Make the date text clickable -- clicking toggles a calendar dropdown positioned below the date text.

The calendar popup:
- Shows a month grid (7 columns for Sun-Mon-...-Sat, ~6 rows of day numbers)
- Header with left/right arrows for prev/next month and "Month Year" text in center
- Today's date highlighted with subtle background
- Selected date highlighted with accent color
- Click a day: calls `onChange(dayString)`, closes popup
- Click outside: closes popup
- Uses `useRef` + `useEffect` for outside-click detection (same pattern as `AssignDropdown.tsx:19-29`)

Helper functions `formatDisplay` and `shiftDate` remain unchanged.

New helper:
```typescript
function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function firstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay()
}
```

Calendar component renders inline inside `DatePicker`. Not a separate component file since it's only used here.

The calendar dropdown should have:
- `position: absolute`, `top: '100%'`, `left: '50%'`, `transform: 'translateX(-50%)'`, `marginTop: 8`
- `background: 'var(--bg-raised)'`, `border: '1px solid var(--border-strong)'`
- `borderRadius: 'var(--radius-lg)'`, `boxShadow: 'var(--shadow)'`
- `padding: 16`, `zIndex: 50`, `minWidth: 280`
- Day cells: 36x36px, centered text, `borderRadius: '50%'`

State additions to DatePicker:
```typescript
const [calendarOpen, setCalendarOpen] = useState(false)
const [viewYear, setViewYear] = useState(() => parseInt(value.split('-')[0]))
const [viewMonth, setViewMonth] = useState(() => parseInt(value.split('-')[1]) - 1)
const calRef = useRef<HTMLDivElement>(null)
```

Reset `viewYear`/`viewMonth` when calendar opens (based on current `value`).

**Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/components/DatePicker.tsx
git commit -m "feat: add calendar popup to date picker"
```

---

### Task 4: Create useUndo hook

**Files:**
- Create: `frontend/src/hooks/useUndo.ts`

**Step 1: Create the undo hook**

```typescript
import { useState, useCallback, useEffect, useRef } from 'react'

export interface UndoAction {
  label: string
  undo: () => void | Promise<void>
}

const MAX_STACK = 10
const TOAST_DURATION = 5000

export function useUndo(clearKey?: string) {
  const [stack, setStack] = useState<UndoAction[]>([])
  const [toast, setToast] = useState<UndoAction | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  // Clear stack when clearKey changes (e.g. date changes)
  useEffect(() => {
    setStack([])
    setToast(null)
  }, [clearKey])

  const push = useCallback((action: UndoAction) => {
    setStack((prev) => [...prev.slice(-(MAX_STACK - 1)), action])
    setToast(action)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setToast(null), TOAST_DURATION)
  }, [])

  const undoLast = useCallback(async () => {
    setStack((prev) => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      last.undo()
      return prev.slice(0, -1)
    })
    setToast(null)
  }, [])

  const dismissToast = useCallback(() => {
    setToast(null)
    clearTimeout(timerRef.current)
  }, [])

  // Cmd+Z listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        // Don't capture if user is typing in an input
        const tag = (e.target as HTMLElement).tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        e.preventDefault()
        undoLast()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [undoLast])

  return { push, undoLast, dismissToast, toast, stackSize: stack.length }
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/hooks/useUndo.ts
git commit -m "feat: add useUndo hook with toast and Cmd+Z support"
```

---

### Task 5: Create UndoToast component

**Files:**
- Create: `frontend/src/components/UndoToast.tsx`

**Step 1: Create the toast component**

```tsx
import type { UndoAction } from '../hooks/useUndo'

interface UndoToastProps {
  action: UndoAction | null
  onUndo: () => void
  onDismiss: () => void
}

export function UndoToast({ action, onUndo, onDismiss }: UndoToastProps) {
  if (!action) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-lg)',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: 'var(--shadow)',
        zIndex: 100,
        fontFamily: 'var(--font-body)',
      }}
    >
      <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
        {action.label}
      </span>
      <button
        onClick={onUndo}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--accent)',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          padding: '2px 6px',
          fontFamily: 'var(--font-body)',
        }}
      >
        Undo
      </button>
      <button
        onClick={onDismiss}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-tertiary)',
          fontSize: 14,
          cursor: 'pointer',
          padding: '2px 4px',
          lineHeight: 1,
        }}
      >
        &times;
      </button>
    </div>
  )
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/components/UndoToast.tsx
git commit -m "feat: add UndoToast component"
```

---

### Task 6: Redesign UnsortedSection as feed-style inbox with delete

**Files:**
- Modify: `frontend/src/components/UnsortedSection.tsx` (significant rewrite)

**Step 1: Rewrite UnsortedSection**

New props interface adds `onDelete` callback:

```typescript
interface UnsortedSectionProps {
  tweets: Tweet[]
  topics: Topic[]
  categories: Category[]
  onAssign: (tweetIds: number[], topicId: number, categoryId?: number) => void
  onDelete: (tweetId: number) => void
  onTweetClick?: (tweet: Tweet) => void
}
```

Layout changes:
- Container: fixed max-height of `400px` with `overflowY: 'auto'` for the tweet list area
- Tweet cards become wider, feed-style rows instead of small thumbnails:
  - Each card: full-width row, `display: 'flex'`, `gap: 12`, `padding: '10px 12px'`
  - Left: screenshot thumbnail `48px x 48px`, rounded, `objectFit: 'cover'`
  - Center: `flex: 1` column with `@handle` + outlink icon row, then tweet text (2-line clamp)
  - Right side: checkbox for selection
  - On hover: show delete (X) button in far right
- Bulk action bar stays below the scroll area (not inside it)
- Add a "Delete selected" button next to the assign dropdown when items are selected

The delete button on each card:
```tsx
{hovered && (
  <button
    onClick={(e) => {
      e.stopPropagation()
      onDelete(tweet.id)
    }}
    style={{
      background: 'none',
      border: 'none',
      color: 'var(--text-tertiary)',
      fontSize: 16,
      cursor: 'pointer',
      padding: '2px 4px',
      lineHeight: 1,
      flexShrink: 0,
    }}
    title="Remove tweet"
  >
    &times;
  </button>
)}
```

Each feed card needs its own hover state. Extract a `FeedTweetCard` component inside the same file to manage per-card hover state:

```typescript
function FeedTweetCard({
  tweet,
  selected,
  onToggle,
  onDelete,
  onTweetClick,
}: {
  tweet: Tweet
  selected: boolean
  onToggle: (id: number) => void
  onDelete: (id: number) => void
  onTweetClick?: (tweet: Tweet) => void
}) {
  const [hovered, setHovered] = useState(false)
  // ... render feed-style card
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: Error in DailyView.tsx because UnsortedSection now requires `onDelete` prop. That's expected and will be fixed in Task 10.

**Step 3: Commit**

```bash
git add frontend/src/components/UnsortedSection.tsx
git commit -m "feat: redesign unsorted section as feed-style inbox with delete"
```

---

### Task 7: Rewrite TopicSection as Kanban column (TopicColumn)

**Files:**
- Modify: `frontend/src/components/TopicSection.tsx` (significant rewrite)

**Step 1: Rewrite TopicSection as a vertical column**

The `TopicSectionWithData` wrapper stays. The presentational component becomes a column layout.

Add `onDelete` prop to both interfaces:

```typescript
interface TopicSectionWithDataProps {
  topicId: number
  title: string
  color: string | null
  date: string
  search: string
  onUnassign: (tweetIds: number[], topicId: number) => void
  onDelete: (topicId: number) => void
  onTweetClick?: (tweet: Tweet) => void
}
```

Column layout:
- Width: `280px`, `flexShrink: 0`
- `background: 'var(--bg-raised)'`, full-height via `display: 'flex'`, `flexDirection: 'column'`
- `border: '1px solid var(--border)'`, `borderRadius: 'var(--radius-lg)'`
- Header: horizontal flex, color dot + title (flex: 1) + tweet count + trash icon
- Body: `flex: 1`, `overflowY: 'auto'`, `padding: '8px 12px'`, tweets stacked vertically with `gap: 8`
- Tweet cards inside: use existing `TweetCard` but at full column width (`width: '100%'` instead of 164px). Pass a new `fullWidth` prop or just set `width: 'auto'` on the cards inside the column.

Trash icon on header (only shows on header hover):
```tsx
<button
  onClick={(e) => {
    e.stopPropagation()
    if (window.confirm(`Delete topic "${title}"? Tweets will be unassigned.`)) {
      onDelete(topicId)
    }
  }}
  style={{
    background: 'none',
    border: 'none',
    color: 'var(--text-tertiary)',
    fontSize: 14,
    cursor: 'pointer',
    padding: '2px 4px',
    opacity: headerHovered ? 1 : 0,
    transition: 'opacity 0.15s ease',
  }}
  title="Delete topic"
>
  &#128465;
</button>
```

The unassign bar stays at the bottom of the column.

**Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: Error in DailyView.tsx because TopicSectionWithData now requires `onDelete`. Fixed in Task 10.

**Step 3: Commit**

```bash
git add frontend/src/components/TopicSection.tsx
git commit -m "feat: rewrite topic sections as kanban columns with delete"
```

---

### Task 8: Auto-rotating colors for CreateTopicForm

**Files:**
- Modify: `frontend/src/components/CreateTopicForm.tsx:1-34`

**Step 1: Accept topicCount prop for auto-color**

Add `topicCount` prop to determine auto-assigned color:

```typescript
interface CreateTopicFormProps {
  onSubmit: (title: string, color: string) => void
  loading?: boolean
  topicCount: number
}
```

Change the default color initialization:
```typescript
const [color, setColor] = useState(PRESET_COLORS[topicCount % PRESET_COLORS.length])
```

Also update the reset in `handleSubmit` to use the next color:
```typescript
const handleSubmit = () => {
  const trimmed = title.trim()
  if (!trimmed) return
  onSubmit(trimmed, color)
  setTitle('')
  // Next topic will get the next color in the palette
  setColor(PRESET_COLORS[(topicCount + 1) % PRESET_COLORS.length])
  setExpanded(false)
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: Error in DailyView.tsx (missing topicCount prop). Fixed in Task 10.

**Step 3: Commit**

```bash
git add frontend/src/components/CreateTopicForm.tsx
git commit -m "feat: auto-rotate topic colors based on existing count"
```

---

### Task 9: Inline category management in AssignDropdown

**Files:**
- Modify: `frontend/src/components/AssignDropdown.tsx`

**Step 1: Add category create/delete to AssignDropdown**

Add new props:
```typescript
interface AssignDropdownProps {
  topics: Topic[]
  categories: Category[]
  onAssign: (topicId: number, categoryId?: number) => void
  onCreateCategory?: (name: string, color: string) => void
  onDeleteCategory?: (id: number) => void
  disabled?: boolean
}
```

In the category list (step 2 of the dropdown), add:

1. **Delete icon on each category item**: Modify `DropdownItem` to accept an optional `onDelete` prop. When provided, show a small "x" button on hover at the right side of the item.

2. **"+ Add Category" row at bottom**: When clicked, replaces itself with an inline form:
   - Text input for name (auto-focused)
   - Row of small color dots (use same 8-color palette as CreateTopicForm)
   - Enter to create, Escape to cancel
   - After creating, the new category appears in the list

State additions:
```typescript
const [addingCategory, setAddingCategory] = useState(false)
const [newCatName, setNewCatName] = useState('')
const [newCatColor, setNewCatColor] = useState('#6366f1')
```

The inline form:
```tsx
{addingCategory ? (
  <div style={{ padding: '8px 12px' }}>
    <input
      type="text"
      placeholder="Category name..."
      value={newCatName}
      onChange={(e) => setNewCatName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && newCatName.trim()) {
          onCreateCategory?.(newCatName.trim(), newCatColor)
          setNewCatName('')
          setAddingCategory(false)
        }
        if (e.key === 'Escape') {
          setAddingCategory(false)
          setNewCatName('')
        }
      }}
      autoFocus
      style={{
        width: '100%',
        background: 'var(--bg-base)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        padding: '5px 8px',
        color: 'var(--text-primary)',
        fontSize: 12,
        outline: 'none',
        fontFamily: 'var(--font-body)',
        marginBottom: 6,
      }}
    />
    <div style={{ display: 'flex', gap: 4 }}>
      {['#6366f1','#ec4899','#f59e0b','#22c55e','#3b82f6','#ef4444','#06b6d4','#8b5cf6'].map(c => (
        <button
          key={c}
          onClick={() => setNewCatColor(c)}
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: c,
            border: newCatColor === c ? '2px solid var(--text-primary)' : '2px solid transparent',
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
    </div>
  </div>
) : (
  <DropdownItem
    label="+ Add Category"
    onClick={() => setAddingCategory(true)}
  />
)}
```

Update `DropdownItem` to accept `onDelete`:
```typescript
function DropdownItem({
  label,
  color,
  onClick,
  onDelete,
}: {
  label: string
  color?: string | null
  onClick: () => void
  onDelete?: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '8px 12px',
        background: hovered ? 'var(--bg-hover)' : 'transparent',
        border: 'none',
        color: 'var(--text-primary)',
        fontSize: 13,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.1s ease',
        fontFamily: 'var(--font-body)',
      }}
    >
      {color && (
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: color,
            flexShrink: 0,
          }}
        />
      )}
      <span style={{ flex: 1 }}>{label}</span>
      {onDelete && hovered && (
        <span
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          style={{
            color: 'var(--text-tertiary)',
            fontSize: 14,
            cursor: 'pointer',
            lineHeight: 1,
          }}
          title="Delete category"
        >
          &times;
        </span>
      )}
    </button>
  )
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors (new props are optional)

**Step 3: Commit**

```bash
git add frontend/src/components/AssignDropdown.tsx
git commit -m "feat: inline category add/delete in assign dropdown"
```

---

### Task 10: Rewrite DailyView with Kanban layout and undo integration

**Files:**
- Modify: `frontend/src/pages/DailyView.tsx` (significant rewrite)

**Step 1: Wire everything together in DailyView**

This is the integration task. Changes:

1. **Import new hooks and components:**
```typescript
import { useUndo } from '../hooks/useUndo'
import { UndoToast } from '../components/UndoToast'
import { useDeleteTweet } from '../api/tweets'
import { useDeleteTopic } from '../api/topics'
import { useCreateCategory, useDeleteCategory } from '../api/categories'
```

2. **Add undo hook:**
```typescript
const undo = useUndo(date) // clears stack on date change
```

3. **Add mutations:**
```typescript
const deleteTweetMutation = useDeleteTweet()
const deleteTopicMutation = useDeleteTopic()
const createCategoryMutation = useCreateCategory()
const deleteCategoryMutation = useDeleteCategory()
```

4. **Delete tweet handler (with undo):**
```typescript
const handleDeleteTweet = useCallback(
  (tweetId: number) => {
    const tweet = unsortedTweets.find(t => t.id === tweetId)
    deleteTweetMutation.mutate(tweetId)
    if (tweet) {
      undo.push({
        label: `Tweet by @${tweet.author_handle} deleted`,
        undo: () => {
          // Re-save via POST /api/tweets -- need the tweet data
          // For simplicity, undo of delete is best-effort
          // We can store the full tweet and re-POST it
        },
      })
    }
  },
  [deleteTweetMutation, unsortedTweets, undo],
)
```

Note: Undo for tweet deletion is complex (need to re-POST the tweet). For the initial implementation, show the toast with label but skip the actual undo function for delete-tweet (just show "Tweet deleted" without undo capability). Undo will work for assign/unassign/delete-topic.

Simpler approach for undo:
```typescript
const handleDeleteTweet = useCallback(
  (tweetId: number) => {
    const tweet = unsortedTweets.find(t => t.id === tweetId)
    deleteTweetMutation.mutate(tweetId)
    // No undo for delete -- it's destructive
  },
  [deleteTweetMutation, unsortedTweets],
)
```

Actually, let's keep undo for assign/unassign only (which are cleanly reversible) and use `window.confirm` for destructive deletes:

```typescript
const handleDeleteTweet = useCallback(
  (tweetId: number) => {
    deleteTweetMutation.mutate(tweetId)
  },
  [deleteTweetMutation],
)

const handleDeleteTopic = useCallback(
  (topicId: number) => {
    deleteTopicMutation.mutate(topicId)
  },
  [deleteTopicMutation],
)
```

For assign/unassign, use undo:
```typescript
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
```

5. **Category management handlers:**
```typescript
const handleCreateCategory = useCallback(
  (name: string, color: string) => {
    createCategoryMutation.mutate({ name, color })
  },
  [createCategoryMutation],
)

const handleDeleteCategory = useCallback(
  (id: number) => {
    deleteCategoryMutation.mutate(id)
  },
  [deleteCategoryMutation],
)
```

6. **Layout: Kanban columns**

Replace the stacked topic sections with a horizontally scrolling container:

```tsx
{/* Unsorted section */}
<UnsortedSection
  tweets={unsortedTweets}
  topics={topics}
  categories={categories}
  onAssign={handleAssign}
  onDelete={handleDeleteTweet}
  onTweetClick={handleTweetClick}
  onCreateCategory={handleCreateCategory}
  onDeleteCategory={handleDeleteCategory}
/>

{/* Kanban topic columns */}
<div
  style={{
    display: 'flex',
    gap: 16,
    overflowX: 'auto',
    paddingBottom: 16,
    minHeight: 300,
  }}
>
  {topics.map((topic) => (
    <TopicSectionWithData
      key={topic.id}
      topicId={topic.id}
      title={topic.title}
      color={topic.color}
      date={date}
      search={search}
      onUnassign={handleUnassign}
      onDelete={handleDeleteTopic}
      onTweetClick={handleTweetClick}
    />
  ))}

  {/* Create topic card */}
  <div style={{ width: 280, flexShrink: 0 }}>
    <CreateTopicForm
      onSubmit={handleCreateTopic}
      loading={createTopicMutation.isPending}
      topicCount={topics.length}
    />
  </div>
</div>
```

7. **Remove the 960px maxWidth constraint** on `<main>` since the Kanban layout needs full width. Change to `padding: '24px 24px 80px'` without maxWidth, or use a larger maxWidth like 1400px.

8. **Add UndoToast at the bottom:**
```tsx
<UndoToast
  action={undo.toast}
  onUndo={undo.undoLast}
  onDismiss={undo.dismissToast}
/>
```

9. **Pass category handlers through to UnsortedSection** (which passes them to AssignDropdown). Add `onCreateCategory` and `onDeleteCategory` props to `UnsortedSection` and thread them to `AssignDropdown`.

**Step 2: Update UnsortedSection to accept and pass category handlers**

Add to `UnsortedSectionProps`:
```typescript
onCreateCategory?: (name: string, color: string) => void
onDeleteCategory?: (id: number) => void
```

Pass to `AssignDropdown`:
```tsx
<AssignDropdown
  topics={topics}
  categories={categories}
  onAssign={handleAssign}
  onCreateCategory={onCreateCategory}
  onDeleteCategory={onDeleteCategory}
/>
```

**Step 3: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/src/pages/DailyView.tsx frontend/src/components/UnsortedSection.tsx
git commit -m "feat: integrate kanban layout, undo system, and category management in DailyView"
```

---

### Task 11: Run full TypeScript check and fix any issues

**Files:**
- Any files with type errors

**Step 1: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`

**Step 2: Fix any type errors found**

Common issues to watch for:
- Missing props on component usage
- Optional vs required prop mismatches
- Unused imports after refactoring

**Step 3: Commit fixes if any**

```bash
git add -A
git commit -m "fix: resolve TypeScript errors from dashboard redesign"
```

---

### Task 12: Run backend tests to verify no regressions

**Step 1: Run backend tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -q`
Expected: All tests pass. We didn't change any backend code.

---

### Task 13: Visual review and polish

**Step 1: Start the dev environment**

Run: `docker compose up` (or local dev server)

**Step 2: Verify each feature visually**

Checklist:
- [ ] Date picker: prev/next arrows work, clicking date opens calendar, clicking a day navigates, clicking outside closes
- [ ] Kanban columns: topics display as side-by-side columns, horizontal scroll works
- [ ] Auto colors: new topics get different colors from the palette
- [ ] Topic delete: trash icon on hover, confirmation dialog, tweets return to unsorted
- [ ] Unsorted feed: fixed-height scrollable, feed-style cards with text visible
- [ ] Tweet delete: X button on hover removes tweet
- [ ] Tweet outlinks: external link icon next to @handle, opens tweet on X
- [ ] Category add: "+ Add Category" in assign dropdown, inline form, creates category
- [ ] Category delete: X icon on category hover in dropdown
- [ ] Undo: assign/unassign shows toast, clicking Undo reverses action
- [ ] Cmd+Z: triggers undo when not in an input field
- [ ] Toast auto-dismisses after 5 seconds

**Step 3: Fix any visual issues found**

**Step 4: Commit polish fixes**

```bash
git add -A
git commit -m "fix: visual polish for dashboard improvements"
```
