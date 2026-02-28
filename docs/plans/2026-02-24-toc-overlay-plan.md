# Table of Contents Overlay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a TOC overlay that lists Unsorted + Topic sections, opened via `T` key or FAB button, with smooth scroll-to-section navigation.

**Architecture:** New `TableOfContents.tsx` component renders a fixed overlay with section links. TOC state lives in `DailyView.tsx`. Sections get `id` attributes for `scrollIntoView` targeting. TanStack Query dedupes data fetching so the TOC component can call the same hooks as `DayFeedPanel`.

**Tech Stack:** React, TypeScript, inline styles with CSS variables (existing pattern)

---

### Task 1: Add id attributes to section containers

**Files:**
- Modify: `frontend/src/components/UnsortedSection.tsx:92` (outer div)
- Modify: `frontend/src/components/TopicSection.tsx:231` (sectionRef div in TopicSection)

**Step 1: Add id to UnsortedSection**

In `UnsortedSection.tsx`, add `id="toc-unsorted"` to the outer `<div>` at line 93:

```tsx
<div
  id="toc-unsorted"
  style={{
    background: 'var(--bg-raised)',
    // ... rest unchanged
  }}
>
```

**Step 2: Add id to TopicSection**

In `TopicSection.tsx`, the `TopicSection` component's outer div (line 232, `ref={sectionRef}`) needs a dynamic id:

```tsx
<div
  ref={sectionRef}
  id={`toc-topic-${topicId}`}
  style={{
    // ... unchanged
  }}
>
```

**Step 3: Commit**

```bash
git add frontend/src/components/UnsortedSection.tsx frontend/src/components/TopicSection.tsx
git commit -m "feat: add id attributes to sections for TOC navigation"
```

---

### Task 2: Create TableOfContents component

**Files:**
- Create: `frontend/src/components/TableOfContents.tsx`

**Step 1: Create the component**

The component receives:
- `date: string` — current date to query topics/unsorted
- `onClose: () => void` — called on dismiss
- `search: string` — pass through to useTweets for consistent counts

It fetches data via existing hooks (`useTopics`, `useTweets`), renders a fixed overlay with a centered panel listing sections, and scrolls to section on click.

```tsx
import { useEffect, useRef } from 'react'
import { useTopics } from '../api/topics'
import { useTweets } from '../api/tweets'

interface TableOfContentsProps {
  date: string
  search: string
  onClose: () => void
}

export function TableOfContents({ date, search, onClose }: TableOfContentsProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const topicsQuery = useTopics(date)
  const unsortedQuery = useTweets({ date, unassigned: true, q: search || undefined })

  const topics = topicsQuery.data ?? []
  const unsortedTweets = unsortedQuery.data ?? []

  // Escape to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Prevent body scroll
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose()
  }

  const scrollToSection = (id: string) => {
    onClose()
    // Small delay so overlay unmounts before scroll
    requestAnimationFrame(() => {
      const el = document.getElementById(id)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'var(--bg-raised)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 0',
          minWidth: 280,
          maxWidth: 400,
          maxHeight: '70vh',
          overflowY: 'auto',
          position: 'relative',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px 12px',
            borderBottom: '1px solid var(--border)',
            marginBottom: 8,
          }}
        >
          <span style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}>
            Table of Contents
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-tertiary)',
              fontSize: 18,
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Entries */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Unsorted entry (only if tweets exist) */}
          {unsortedTweets.length > 0 && (
            <TOCEntry
              label="Unsorted"
              count={unsortedTweets.length}
              onClick={() => scrollToSection('toc-unsorted')}
            />
          )}

          {/* Topic entries */}
          {topics.map((topic) => (
            <TOCEntry
              key={topic.id}
              label={topic.title}
              color={topic.color}
              onClick={() => scrollToSection(`toc-topic-${topic.id}`)}
            />
          ))}

          {/* Empty state */}
          {unsortedTweets.length === 0 && topics.length === 0 && (
            <div style={{
              padding: '20px',
              textAlign: 'center',
              fontSize: 13,
              color: 'var(--text-tertiary)',
            }}>
              No sections for this day
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TOCEntry({
  label,
  count,
  color,
  onClick,
}: {
  label: string
  count?: number
  color?: string | null
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '10px 20px',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        color: 'var(--text-primary)',
        fontSize: 14,
        fontFamily: 'var(--font-body)',
        transition: 'background 0.1s ease',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'none'
      }}
    >
      {/* Color dot for topics */}
      {color && (
        <span style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
        }} />
      )}
      <span style={{
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      {count !== undefined && (
        <span style={{
          fontSize: 12,
          color: 'var(--text-tertiary)',
          fontWeight: 500,
        }}>
          {count}
        </span>
      )}
    </button>
  )
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/TableOfContents.tsx
git commit -m "feat: add TableOfContents overlay component"
```

---

### Task 3: Wire up TOC state, keyboard listener, and FAB in DailyView

**Files:**
- Modify: `frontend/src/pages/DailyView.tsx`

**Step 1: Add state and keyboard listener**

Add `tocOpen` state. Add `T` key handler to the existing `useEffect` keyboard listener (checking that active element is not input/textarea, same pattern as DayCarousel). Import and render `TableOfContents` when open.

```tsx
// Add import
import { TableOfContents } from '../components/TableOfContents'

// Add state
const [tocOpen, setTocOpen] = useState(false)

// In existing useEffect keydown handler, add T key:
if (e.key === 't' || e.key === 'T') {
  const tag = (e.target as HTMLElement).tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  e.preventDefault()
  setTocOpen(prev => !prev)
}
```

**Step 2: Add FAB button and TOC overlay to JSX**

After the `DayCarousel` and before/after the `TweetDetailModal`, add:

```tsx
{/* TOC FAB button */}
{!tocOpen && (
  <button
    onClick={() => setTocOpen(true)}
    aria-label="Table of Contents"
    style={{
      position: 'fixed',
      bottom: 24,
      right: 24,
      width: 48,
      height: 48,
      borderRadius: '50%',
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      color: 'var(--text-secondary)',
      fontSize: 20,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      zIndex: 50,
      transition: 'all 0.15s ease',
    }}
  >
    ☰
  </button>
)}

{/* TOC overlay */}
{tocOpen && (
  <TableOfContents
    date={date}
    search={search}
    onClose={() => setTocOpen(false)}
  />
)}
```

**Step 3: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/src/pages/DailyView.tsx
git commit -m "feat: wire up TOC overlay with keyboard shortcut and FAB button"
```

---

### Task 4: Manual verification

**Step 1: Start dev server**

Run: `docker compose up` (or local dev server)

**Step 2: Verify**

- Press `T` — TOC overlay appears
- Press `Escape` — TOC closes
- Click a section entry — scrolls to it, TOC closes
- Click backdrop — TOC closes
- Click X button — TOC closes
- FAB button visible when TOC is closed
- FAB button hidden when TOC is open
- `T` key does nothing when typing in search input
- On mobile viewport: FAB button tappable, TOC works with touch
