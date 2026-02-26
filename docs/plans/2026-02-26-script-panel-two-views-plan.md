# Script Panel Two-View Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the monolithic DayScriptView into a parent ScriptPanel with two child views: TopicManagerView (select, reorder, generate) and ScriptMirrorView (dual-column scripts with element-aligned scroll sync).

**Architecture:** Parent ScriptPanel manages shared state (selectedTopicIds, orderedTopicIds, activeView) and renders a header with tab toggle. Child views are both mounted but toggle with `display: none` for instant switching. Scroll sync changes from ratio-based to element-aligned using IntersectionObserver + rAF.

**Tech Stack:** React 19, TypeScript, @dnd-kit/sortable, TanStack React Query

---

### Task 1: Create ScriptPanel Parent Component

**Files:**
- Create: `frontend/src/components/ScriptPanel.tsx`
- Modify: `frontend/src/components/DayFeedPanel.tsx:2,470-471`

**Step 1: Create ScriptPanel with shared state and tab header**

```tsx
// frontend/src/components/ScriptPanel.tsx
import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { TopicBundle } from '../api/dayBundle'
import { sortTopics } from '../utils/topics'
import { TopicManagerView } from './TopicManagerView'
import { ScriptMirrorView } from './ScriptMirrorView'

interface ScriptPanelProps {
  date: string
  topics: TopicBundle[]
  onClose: () => void
}

export default function ScriptPanel({ date, topics, onClose }: ScriptPanelProps) {
  const [activeView, setActiveView] = useState<'topics' | 'script'>('topics')

  // Sort topics by tweet count (most to least), kek at bottom
  const sortedTopics = useMemo(() => sortTopics(topics), [topics])

  // Top 3 selected by default
  const [selectedTopicIds, setSelectedTopicIds] = useState<Set<number>>(() => {
    const top3 = sortedTopics.slice(0, 3).map(t => t.id)
    return new Set(top3)
  })

  // Track topic order locally (init from sorted topics by tweet count)
  const [orderedTopicIds, setOrderedTopicIds] = useState<number[]>(() =>
    sortedTopics.map(t => t.id)
  )

  // Sync orderedTopicIds when topics are added/removed
  useEffect(() => {
    const currentIds = new Set(topics.map(t => t.id))
    const orderedSet = new Set(orderedTopicIds)
    if (currentIds.size !== orderedSet.size || [...currentIds].some(id => !orderedSet.has(id))) {
      setOrderedTopicIds(prev => {
        const kept = prev.filter(id => currentIds.has(id))
        const newIds = topics.filter(t => !orderedSet.has(t.id)).map(t => t.id)
        return [...kept, ...newIds]
      })
    }
  }, [topics]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts: g to toggle, Escape to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === 'g') {
        e.preventDefault()
        setActiveView(v => v === 'topics' ? 'script' : 'topics')
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const toggleTopic = useCallback((topicId: number) => {
    setSelectedTopicIds(prev => {
      const next = new Set(prev)
      if (next.has(topicId)) next.delete(topicId)
      else next.add(topicId)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedTopicIds(new Set(topics.map(t => t.id)))
  }, [topics])

  const deselectAll = useCallback(() => {
    setSelectedTopicIds(new Set())
  }, [])

  // Build topic map for ordered lookups
  const topicMap = useMemo(() => new Map(topics.map(t => [t.id, t])), [topics])

  // Ordered + selected topics for the script mirror view
  const selectedTopics = useMemo(() =>
    orderedTopicIds
      .filter(id => selectedTopicIds.has(id))
      .map(id => topicMap.get(id))
      .filter((t): t is TopicBundle => !!t),
    [orderedTopicIds, selectedTopicIds, topicMap]
  )

  const tabStyle = (active: boolean): React.CSSProperties => ({
    background: 'none',
    border: 'none',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    padding: '6px 12px',
  })

  return createPortal(
    <div style={{
      position: 'fixed',
      top: 66,
      left: 0,
      width: '100vw',
      height: 'calc(100vh - 66px)',
      zIndex: 60,
      background: 'var(--bg-raised)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header: Back + tabs */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 16px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <button onClick={onClose} style={{
          background: 'none', border: '1px solid var(--border)',
          color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer',
          padding: '4px 14px', borderRadius: 'var(--radius-sm)',
        }}>
          Back
        </button>
        <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
        <button onClick={() => setActiveView('topics')} style={tabStyle(activeView === 'topics')}>
          Topics
        </button>
        <button onClick={() => setActiveView('script')} style={tabStyle(activeView === 'script')}>
          Script
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 4 }}>
          (g)
        </span>
      </div>

      {/* Views: both mounted, toggle with display */}
      <div style={{ display: activeView === 'topics' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
        <TopicManagerView
          date={date}
          topics={topics}
          orderedTopicIds={orderedTopicIds}
          setOrderedTopicIds={setOrderedTopicIds}
          selectedTopicIds={selectedTopicIds}
          toggleTopic={toggleTopic}
          selectAll={selectAll}
          deselectAll={deselectAll}
        />
      </div>
      <div style={{ display: activeView === 'script' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
        <ScriptMirrorView
          date={date}
          topics={selectedTopics}
        />
      </div>
    </div>,
    document.body,
  )
}
```

**Step 2: Update DayFeedPanel import**

In `frontend/src/components/DayFeedPanel.tsx`, change:
- Line 2: `import DayScriptView from './DayScriptView'` → `import ScriptPanel from './ScriptPanel'`
- Line 471: `<DayScriptView date={date} topics={topics} onClose={onGenPanelClose} />` → `<ScriptPanel date={date} topics={topics} onClose={onGenPanelClose} />`

**Step 3: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: Will fail until TopicManagerView and ScriptMirrorView exist. That's OK — we create them next.

**Step 4: Commit**

```bash
git add frontend/src/components/ScriptPanel.tsx frontend/src/components/DayFeedPanel.tsx
git commit -m "feat: create ScriptPanel parent with tab toggle and shared state"
```

---

### Task 2: Create TopicManagerView

**Files:**
- Create: `frontend/src/components/TopicManagerView.tsx`

**Step 1: Build the TopicManagerView component**

```tsx
// frontend/src/components/TopicManagerView.tsx
import { useState, useCallback, useMemo, useEffect } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { TopicBundle } from '../api/dayBundle'
import { useUpdateTopic } from '../api/topics'
import {
  AVAILABLE_MODELS,
  useTopicScript,
  useGenerateDayScripts,
} from '../api/scripts'

interface TopicManagerViewProps {
  date: string
  topics: TopicBundle[]
  orderedTopicIds: number[]
  setOrderedTopicIds: React.Dispatch<React.SetStateAction<number[]>>
  selectedTopicIds: Set<number>
  toggleTopic: (topicId: number) => void
  selectAll: () => void
  deselectAll: () => void
}

/* ---- Script status indicator per topic ---- */
function ScriptStatusBadge({ topicId }: { topicId: number }) {
  const { data: script, isLoading } = useTopicScript(topicId)
  if (isLoading) return <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>...</span>
  if (script) return <span style={{ fontSize: 11, color: '#4ade80' }}>✓ Script</span>
  return <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>No script</span>
}

/* ---- Sortable topic row ---- */
function SortableTopicRow({ topic, selected, onToggle }: {
  topic: TopicBundle
  selected: boolean
  onToggle: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: topic.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 16px',
    borderBottom: '1px solid var(--border)',
    background: selected ? 'var(--bg-elevated)' : 'transparent',
  }

  return (
    <div ref={setNodeRef} style={style}>
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        style={{ accentColor: 'var(--accent)', cursor: 'pointer', width: 16, height: 16, flexShrink: 0 }}
      />
      {/* Color dot */}
      <span style={{
        width: 10, height: 10, borderRadius: '50%',
        background: topic.color || 'var(--text-tertiary)', flexShrink: 0,
      }} />
      {/* Title + tweet count */}
      <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
        {topic.title}
        <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 8, fontSize: 12 }}>
          {topic.tweet_count ?? topic.tweets?.length ?? 0} tweets
        </span>
      </span>
      {/* Script status */}
      <ScriptStatusBadge topicId={topic.id} />
      {/* Drag handle */}
      <span
        {...attributes}
        {...listeners}
        style={{
          cursor: 'grab', color: 'var(--text-tertiary)', fontSize: 14,
          lineHeight: 1, padding: '2px 4px', userSelect: 'none', touchAction: 'none',
        }}
        title="Drag to reorder"
      >
        &#10303;
      </span>
    </div>
  )
}

export function TopicManagerView({
  date,
  topics,
  orderedTopicIds,
  setOrderedTopicIds,
  selectedTopicIds,
  toggleTopic,
  selectAll,
  deselectAll,
}: TopicManagerViewProps) {
  const topicMap = useMemo(() => new Map(topics.map(t => [t.id, t])), [topics])
  const orderedTopics = useMemo(() =>
    orderedTopicIds.map(id => topicMap.get(id)).filter((t): t is TopicBundle => !!t),
    [orderedTopicIds, topicMap]
  )

  const updateTopicMutation = useUpdateTopic()
  const generateAll = useGenerateDayScripts()
  const [genModel, setGenModel] = useState<string>(AVAILABLE_MODELS[0].id)

  // Track which topics have scripts (for "generate missing" count)
  const [scriptStatus, setScriptStatus] = useState<Map<number, boolean>>(new Map())

  // We need each ScriptStatusBadge to report back — but since they use useTopicScript
  // internally, we can derive the missing count by checking query cache.
  // Simpler: track via a callback from ScriptStatusBadge.
  // Actually, let's just use the generate endpoint which handles filtering server-side.
  // The "missing" count is best-effort from scriptStatus tracking.

  // DnD
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setOrderedTopicIds(prev => {
      const oldIndex = prev.indexOf(active.id as number)
      const newIndex = prev.indexOf(over.id as number)
      const newOrder = arrayMove(prev, oldIndex, newIndex)
      newOrder.forEach((id, idx) => {
        const topic = topicMap.get(id)
        if (topic && topic.position !== idx) {
          updateTopicMutation.mutate({ id, position: idx })
        }
      })
      return newOrder
    })
  }, [topicMap, updateTopicMutation, setOrderedTopicIds])

  const selectedCount = selectedTopicIds.size
  const totalCount = topics.length

  // Generate for selected topics
  const handleGenerate = useCallback(() => {
    const selectedIds = orderedTopicIds.filter(id => selectedTopicIds.has(id))
    if (selectedIds.length === 0) return
    generateAll.mutate({ date, model: genModel, topicIds: selectedIds })
  }, [generateAll, date, genModel, orderedTopicIds, selectedTopicIds])

  const allSelected = selectedCount === totalCount
  const btnStyle: React.CSSProperties = {
    background: 'none', border: '1px solid var(--border)',
    color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer',
    padding: '4px 10px', borderRadius: 'var(--radius-sm)',
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Toolbar: Select all / deselect */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <button onClick={allSelected ? deselectAll : selectAll} style={btnStyle}>
          {allSelected ? 'Deselect All' : 'Select All'}
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          {selectedCount} of {totalCount} selected
        </span>
      </div>

      {/* Topic list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={orderedTopicIds} strategy={verticalListSortingStrategy}>
            {orderedTopics.map(topic => (
              <SortableTopicRow
                key={topic.id}
                topic={topic}
                selected={selectedTopicIds.has(topic.id)}
                onToggle={() => toggleTopic(topic.id)}
              />
            ))}
          </SortableContext>
          <DragOverlay />
        </DndContext>
      </div>

      {/* Bottom toolbar: model picker + generate */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 16px', borderTop: '1px solid var(--border)', flexShrink: 0,
      }}>
        <select value={genModel} onChange={(e) => setGenModel(e.target.value)} style={{
          background: 'var(--bg-elevated)', color: 'var(--text-primary)',
          border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
          padding: '4px 8px', fontSize: 12,
        }}>
          {AVAILABLE_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <button
          onClick={handleGenerate}
          disabled={generateAll.isPending || selectedCount === 0}
          style={{
            background: (generateAll.isPending || selectedCount === 0) ? 'var(--bg-elevated)' : 'var(--accent)',
            color: (generateAll.isPending || selectedCount === 0) ? 'var(--text-tertiary)' : '#fff',
            border: 'none', borderRadius: 'var(--radius-sm)',
            padding: '6px 16px', fontSize: 13, fontWeight: 600,
            cursor: (generateAll.isPending || selectedCount === 0) ? 'not-allowed' : 'pointer',
          }}
        >
          {generateAll.isPending ? 'Generating...' : `Generate Scripts (${selectedCount})`}
        </button>
      </div>
    </div>
  )
}
```

**Step 2: Verify TypeScript compiles (partial — ScriptMirrorView still missing)**

Run: `cd frontend && npx tsc --noEmit`
Expected: Will still fail for ScriptMirrorView import.

**Step 3: Commit**

```bash
git add frontend/src/components/TopicManagerView.tsx
git commit -m "feat: create TopicManagerView with select, reorder, generate"
```

---

### Task 3: Create ScriptMirrorView with Element-Aligned Scroll Sync

**Files:**
- Create: `frontend/src/components/ScriptMirrorView.tsx`

This is the largest task — extract the dual-column rendering, drawing system, and replace scroll sync.

**Step 1: Create ScriptMirrorView**

Extract from `DayScriptView.tsx` lines 918-1349: all drawing state, mirror cursor, image overlay, column rendering. Replace the scroll sync (lines 1040-1062) with element-aligned sync.

```tsx
// frontend/src/components/ScriptMirrorView.tsx
import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import type { TopicBundle } from '../api/dayBundle'
import { useUpdateTopic } from '../api/topics'
import {
  AVAILABLE_MODELS,
  useGenerateDayScripts,
} from '../api/scripts'

// Import shared sub-components from DayScriptView (they'll stay there for now)
// We need: ColorWheelPicker, DrawCanvas, InlineImageOverlay, MirrorCursor,
//          SortableTopicItem, FADE_MS, StyledStroke, DrawTool, TimedPoint
// These will be imported after we export them from DayScriptView.
import {
  ColorWheelPicker,
  DrawCanvas,
  InlineImageOverlay,
  MirrorCursor,
  SortableTopicItem,
  FADE_MS,
  type StyledStroke,
  type DrawTool,
  type TimedPoint,
} from './DayScriptView'

interface ScriptMirrorViewProps {
  date: string
  topics: TopicBundle[]  // already filtered to selected topics, in order
}

export function ScriptMirrorView({ date, topics }: ScriptMirrorViewProps) {
  const [expandedImage, setExpandedImage] = useState<string | null>(null)
  const [mirrorPos, setMirrorPos] = useState<{ x: number; y: number } | null>(null)
  const [mirrorClicking, setMirrorClicking] = useState(false)
  const [drawStrokes, setDrawStrokes] = useState<StyledStroke[]>([])
  const [photoStrokes, setPhotoStrokes] = useState<StyledStroke[]>([])
  const [drawTool, setDrawTool] = useState<DrawTool>('pen')
  const [drawColor, setDrawColor] = useState('#FF4444')
  const [drawOpacity, setDrawOpacity] = useState(1)
  const currentStrokeRef = useRef<TimedPoint[]>([])
  const drawToolRef = useRef<DrawTool>(drawTool)
  const drawColorRef = useRef(drawColor)
  const drawOpacityRef = useRef(drawOpacity)
  drawToolRef.current = drawTool
  drawColorRef.current = drawColor
  drawOpacityRef.current = drawOpacity
  const [leftSize, setLeftSize] = useState({ w: 0, h: 0 })
  const [rightSize, setRightSize] = useState({ w: 0, h: 0 })
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const leftColumnRef = useRef<HTMLDivElement>(null)
  const rightColumnRef = useRef<HTMLDivElement>(null)
  const syncing = useRef(false)

  const topicIds = useMemo(() => topics.map(t => t.id), [topics])
  const allTweets = useMemo(() => topics.flatMap(t => t.tweets), [topics])

  // Track which topics have scripts (for generate missing)
  const [scriptStatus, setScriptStatus] = useState<Map<number, boolean>>(new Map())
  const handleScriptStatus = useCallback((topicId: number, hasScript: boolean) => {
    setScriptStatus(prev => {
      if (prev.get(topicId) === hasScript) return prev
      const next = new Map(prev)
      next.set(topicId, hasScript)
      return next
    })
  }, [])

  const missingScriptIds = topics
    .filter(t => scriptStatus.get(t.id) === false)
    .map(t => t.id)
  const generateAll = useGenerateDayScripts()
  const [genModel, setGenModel] = useState<string>(AVAILABLE_MODELS[0].id)
  const handleGenerateMissing = useCallback(() => {
    if (missingScriptIds.length === 0) return
    generateAll.mutate({ date, model: genModel, topicIds: missingScriptIds })
  }, [generateAll, date, genModel, missingScriptIds])

  // --- ELEMENT-ALIGNED SCROLL SYNC ---
  // Track which topic is topmost visible in the left column
  const activeTopicRef = useRef<number | null>(null)
  const rafId = useRef<number>(0)

  useEffect(() => {
    const left = leftRef.current
    const right = rightRef.current
    if (!left || !right || topicIds.length === 0) return

    // Find all topic section headers in each column
    const getTopicElements = (container: HTMLDivElement) => {
      const elements = new Map<number, HTMLElement>()
      for (const id of topicIds) {
        const el = container.querySelector(`[data-topic-id="${id}"]`) as HTMLElement | null
        if (el) elements.set(id, el)
      }
      return elements
    }

    const syncScroll = () => {
      if (syncing.current) return
      syncing.current = true

      const leftEls = getTopicElements(left)
      const rightEls = getTopicElements(right)

      // Find the topmost visible topic in the left column
      const leftScrollTop = left.scrollTop
      const leftRect = left.getBoundingClientRect()
      let activeId: number | null = null
      let activeOffsetFromTop = 0

      for (const id of topicIds) {
        const el = leftEls.get(id)
        if (!el) continue
        const elTop = el.getBoundingClientRect().top - leftRect.top
        // First topic whose top is at or below the viewport top, or closest above
        if (elTop <= 20) {
          activeId = id
          activeOffsetFromTop = elTop
        }
      }
      // If no topic is at/above top, use the first one
      if (activeId === null && topicIds.length > 0) {
        activeId = topicIds[0]
        const el = leftEls.get(activeId)
        if (el) activeOffsetFromTop = el.getBoundingClientRect().top - leftRect.top
      }

      if (activeId === null) { syncing.current = false; return }

      // Align the matching topic in the right column
      const rightEl = rightEls.get(activeId)
      if (rightEl) {
        const rightRect = right.getBoundingClientRect()
        const rightElTop = rightEl.getBoundingClientRect().top - rightRect.top
        const targetScroll = right.scrollTop + rightElTop - activeOffsetFromTop
        right.scrollTop = targetScroll
      }

      syncing.current = false
    }

    // Reverse sync: right scrolls left
    const syncScrollReverse = () => {
      if (syncing.current) return
      syncing.current = true

      const leftEls = getTopicElements(left)
      const rightEls = getTopicElements(right)

      const rightRect = right.getBoundingClientRect()
      let activeId: number | null = null
      let activeOffsetFromTop = 0

      for (const id of topicIds) {
        const el = rightEls.get(id)
        if (!el) continue
        const elTop = el.getBoundingClientRect().top - rightRect.top
        if (elTop <= 20) {
          activeId = id
          activeOffsetFromTop = elTop
        }
      }
      if (activeId === null && topicIds.length > 0) {
        activeId = topicIds[0]
        const el = rightEls.get(activeId)
        if (el) activeOffsetFromTop = el.getBoundingClientRect().top - rightRect.top
      }

      if (activeId === null) { syncing.current = false; return }

      const leftEl = leftEls.get(activeId)
      if (leftEl) {
        const leftRect = left.getBoundingClientRect()
        const leftElTop = leftEl.getBoundingClientRect().top - leftRect.top
        const targetScroll = left.scrollTop + leftElTop - activeOffsetFromTop
        left.scrollTop = targetScroll
      }

      syncing.current = false
    }

    // rAF-throttled handlers
    let leftRafQueued = false
    let rightRafQueued = false

    const leftHandler = () => {
      if (leftRafQueued) return
      leftRafQueued = true
      requestAnimationFrame(() => {
        syncScroll()
        leftRafQueued = false
      })
    }

    const rightHandler = () => {
      if (rightRafQueued) return
      rightRafQueued = true
      requestAnimationFrame(() => {
        syncScrollReverse()
        rightRafQueued = false
      })
    }

    left.addEventListener('scroll', leftHandler, { passive: true })
    right.addEventListener('scroll', rightHandler, { passive: true })
    return () => {
      left.removeEventListener('scroll', leftHandler)
      right.removeEventListener('scroll', rightHandler)
    }
  }, [topicIds])

  // Mirror mouse
  useEffect(() => {
    const left = leftRef.current
    const right = rightRef.current
    if (!left || !right) return

    const handleMouseMove = (e: MouseEvent) => {
      const leftRect = left.getBoundingClientRect()
      const rightRect = right.getBoundingClientRect()
      const relX = (e.clientX - leftRect.left) / leftRect.width
      const relY = (e.clientY - leftRect.top) / leftRect.height
      setMirrorPos({
        x: rightRect.left + relX * rightRect.width,
        y: rightRect.top + relY * rightRect.height,
      })
    }

    const handleMouseLeave = () => setMirrorPos(null)
    const handleClick = () => {
      setMirrorClicking(true)
      setTimeout(() => setMirrorClicking(false), 400)
    }

    left.addEventListener('mousemove', handleMouseMove)
    left.addEventListener('mouseleave', handleMouseLeave)
    left.addEventListener('click', handleClick, true)
    return () => {
      left.removeEventListener('mousemove', handleMouseMove)
      left.removeEventListener('mouseleave', handleMouseLeave)
      left.removeEventListener('click', handleClick, true)
    }
  }, [topicIds.length])

  // Right-click drawing on left column
  useEffect(() => {
    const left = leftRef.current
    if (!left) return

    const toLocal = (e: MouseEvent): TimedPoint => {
      const rect = left.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top + left.scrollTop, t: Date.now() }
    }

    const handleContextMenu = (e: MouseEvent) => e.preventDefault()

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 2) return
      e.preventDefault()
      const now = Date.now()
      currentStrokeRef.current = [toLocal(e)]
      setDrawStrokes(prev => {
        const active = prev.filter(s => s.points.some(p => now - p.t < FADE_MS))
        return [...active, { points: [], color: drawColorRef.current, tool: drawToolRef.current, opacity: drawOpacityRef.current }]
      })
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!currentStrokeRef.current.length) return
      currentStrokeRef.current.push(toLocal(e))
      setDrawStrokes(prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        updated[updated.length - 1] = { ...last, points: [...currentStrokeRef.current] }
        return updated
      })
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button !== 2 || !currentStrokeRef.current.length) return
      currentStrokeRef.current = []
    }

    left.addEventListener('contextmenu', handleContextMenu)
    left.addEventListener('mousedown', handleMouseDown)
    left.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      left.removeEventListener('contextmenu', handleContextMenu)
      left.removeEventListener('mousedown', handleMouseDown)
      left.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [topicIds.length])

  // Track column sizes
  useEffect(() => {
    const left = leftRef.current
    const right = rightRef.current
    if (!left || !right) return

    const update = () => {
      setLeftSize({ w: left.clientWidth, h: left.scrollHeight })
      setRightSize({ w: right.clientWidth, h: right.scrollHeight })
    }
    update()

    const ro = new ResizeObserver(update)
    ro.observe(left)
    ro.observe(right)
    return () => ro.disconnect()
  }, [topicIds.length])

  const closeImage = useCallback(() => {
    setExpandedImage(null)
    setPhotoStrokes([])
  }, [])

  const hasColumnStrokes = drawStrokes.some(s => s.points.length >= 2)

  const mirroredDrawStrokes: StyledStroke[] = (hasColumnStrokes && leftSize.w > 0 && rightSize.w > 0)
    ? drawStrokes.map(s => ({
        ...s,
        points: s.points.map(p => ({
          x: (p.x / leftSize.w) * rightSize.w,
          y: (p.y / leftSize.h) * rightSize.h,
          t: p.t,
        })),
      }))
    : []

  const toolBtnStyle = (active: boolean): React.CSSProperties => ({
    background: active ? 'var(--accent)' : 'none',
    color: active ? '#fff' : 'var(--text-secondary)',
    border: active ? 'none' : '1px solid var(--border)',
    fontSize: 12,
    cursor: 'pointer',
    padding: '4px 10px',
    borderRadius: 'var(--radius-sm)',
  })

  // Render column content — no DnD needed here (reorder is in TopicManagerView)
  const renderContent = (editable: boolean) => (
    <>
      {topics.map((topic, idx) => (
        <div key={topic.id} data-topic-id={topic.id}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 0 8px', borderBottom: '2px solid var(--border)', marginBottom: 12,
          }}>
            <span style={{
              width: 10, height: 10, borderRadius: '50%',
              background: topic.color || 'var(--text-tertiary)', flexShrink: 0,
            }} />
            <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}>
              {topic.title}
            </span>
          </div>
          {editable ? (
            <TopicScriptSectionDirect
              topicId={topic.id}
              tweets={topic.tweets}
              onImageClick={setExpandedImage}
              onScriptStatus={handleScriptStatus}
            />
          ) : (
            <TopicScriptSectionMirrorDirect
              topicId={topic.id}
              tweets={topic.tweets}
              allTweets={allTweets}
              onImageClick={setExpandedImage}
            />
          )}
          {idx < topics.length - 1 && (
            <div style={{ height: 1, background: 'var(--border)', margin: '16px 0' }} />
          )}
        </div>
      ))}
    </>
  )

  return (
    <>
      {/* Drawing tools header bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 16px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <button onClick={() => setDrawTool('pen')} style={toolBtnStyle(drawTool === 'pen')}>Pen</button>
        <button onClick={() => setDrawTool('highlighter')} style={toolBtnStyle(drawTool === 'highlighter')}>Highlighter</button>
        <ColorWheelPicker color={drawColor} opacity={drawOpacity} onColorChange={setDrawColor} onOpacityChange={setDrawOpacity} />
        <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />

        {missingScriptIds.length > 0 && (
          <>
            <select value={genModel} onChange={(e) => setGenModel(e.target.value)} style={{
              background: 'var(--bg-elevated)', color: 'var(--text-primary)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              padding: '3px 6px', fontSize: 11,
            }}>
              {AVAILABLE_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <button
              onClick={handleGenerateMissing}
              disabled={generateAll.isPending}
              style={{
                background: generateAll.isPending ? 'var(--bg-elevated)' : 'var(--accent)',
                color: generateAll.isPending ? 'var(--text-tertiary)' : '#fff',
                border: 'none', borderRadius: 'var(--radius-sm)',
                padding: '4px 12px', fontSize: 12, fontWeight: 600,
                cursor: generateAll.isPending ? 'wait' : 'pointer',
              }}
            >
              {generateAll.isPending ? 'Generating...' : `Generate Missing (${missingScriptIds.length})`}
            </button>
            <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
          </>
        )}

        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          {topics.length} topic{topics.length !== 1 ? 's' : ''}
        </span>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes mirror-click-ripple { from { transform: translate(-6px,-6px) scale(0.5); opacity: 1; } to { transform: translate(-6px,-6px) scale(2); opacity: 0; } }
      `}</style>

      {/* Two-column layout */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Left column (editable) */}
        <div
          ref={(el) => { leftRef.current = el; leftColumnRef.current = el }}
          style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '12px 20px', position: 'relative' }}
        >
          {hasColumnStrokes && <DrawCanvas strokes={drawStrokes} width={leftSize.w} height={leftSize.h} />}
          {renderContent(true)}
        </div>

        {/* Center divider */}
        <div style={{ width: 1, flexShrink: 0, background: 'var(--border)' }} />

        {/* Right column (mirror) */}
        <div
          ref={(el) => { rightRef.current = el; rightColumnRef.current = el }}
          style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '12px 16px', position: 'relative' }}
        >
          {mirroredDrawStrokes.length > 0 && <DrawCanvas strokes={mirroredDrawStrokes} width={rightSize.w} height={rightSize.h} />}
          {renderContent(false)}
        </div>
      </div>

      {/* Mirror cursor */}
      {!expandedImage && <MirrorCursor pos={mirrorPos} clicking={mirrorClicking} />}

      {/* Image overlays */}
      {expandedImage && (
        <>
          <InlineImageOverlay
            url={expandedImage}
            onClose={closeImage}
            containerRef={leftColumnRef}
            drawingEnabled
            drawStrokes={photoStrokes}
            onDrawStrokes={setPhotoStrokes}
            toolRef={drawToolRef}
            colorRef={drawColorRef}
            opacityRef={drawOpacityRef}
          />
          <InlineImageOverlay
            url={expandedImage}
            onClose={closeImage}
            containerRef={rightColumnRef}
            drawStrokes={photoStrokes}
          />
        </>
      )}
    </>
  )
}
```

Note: `TopicScriptSectionDirect` and `TopicScriptSectionMirrorDirect` are the existing `TopicScriptSection` and `TopicScriptSectionMirror` — we'll import them from DayScriptView (renamed exports). Alternatively, since we're removing the SortableTopicItem wrapper (no drag in mirror view), we render topic headers inline and use the script section components directly.

**Step 2: Export shared sub-components from DayScriptView**

In `frontend/src/components/DayScriptView.tsx`, add `export` to these declarations:
- `export const FADE_MS = 2000`
- `export type DrawTool = ...`
- `export type TimedPoint = ...`
- `export type StyledStroke = ...`
- `export function hexToRgb(...)` (line 40)
- `export function hslToRgb(...)` (line 47)
- `export function ColorWheelPicker(...)` (find line)
- `export function DrawCanvas(...)` (find line)
- `export function InlineImageOverlay(...)` (find line)
- `export function MirrorCursor(...)` (find line)
- `export function TopicScriptSection(...)` (line 620) — rename to `TopicScriptSectionDirect` or just export as-is
- `export function TopicScriptSectionMirror(...)` (line 748)
- `export function ScriptTextBlock(...)` (find line)
- `export function TweetRows(...)` (line 570)
- `export function groupBlocks(...)` (line 552)
- `export function chunk(...)` (find line)

Alternatively, extract all these shared sub-components into a `scriptComponents.ts` file. This is cleaner but more work. For now, just add `export` keywords.

**Step 3: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/components/ScriptMirrorView.tsx frontend/src/components/DayScriptView.tsx
git commit -m "feat: create ScriptMirrorView with element-aligned scroll sync"
```

---

### Task 4: Wire Everything Together and Test

**Files:**
- Modify: `frontend/src/components/ScriptPanel.tsx` (if adjustments needed)
- Modify: `frontend/src/components/DayFeedPanel.tsx:2,471`

**Step 1: Ensure DayFeedPanel uses ScriptPanel**

Verify line 2 imports `ScriptPanel` and line 471 renders `<ScriptPanel>` instead of `<DayScriptView>`.

**Step 2: TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 3: Manual smoke test**

Run: `cd frontend && npm run dev`

Test the following:
1. Open the script panel from DayFeedPanel
2. See the Topics tab by default with top 3 topics checked
3. Topics are ordered by tweet count (most to least)
4. Check/uncheck topics
5. Click "Script" tab or press `g` to switch to script mirror view
6. Only selected topics appear in the dual-column view
7. Scroll left column — right column follows with same topic aligned side-by-side
8. Press `g` to switch back — Topics view preserved
9. Drawing works on script view (right-click)
10. Escape closes the panel

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: wire ScriptPanel, TopicManagerView, ScriptMirrorView together"
```

---

### Task 5: Clean Up Old DayScriptView

**Files:**
- Modify: `frontend/src/components/DayScriptView.tsx`

**Step 1: Remove the main DayScriptView export**

Since `ScriptPanel` now replaces `DayScriptView` as the entry point, the default export is no longer needed. Keep the file as a library of shared sub-components (DrawCanvas, ColorWheelPicker, etc.), or extract them into a dedicated `scriptShared.ts` file.

Options:
- **Option A**: Keep `DayScriptView.tsx` as-is but remove the default export. It becomes a library of exported helpers.
- **Option B**: Extract shared components into `frontend/src/components/scriptShared.tsx` and delete `DayScriptView.tsx`.

Recommend **Option A** for now — less risk, and we can refactor later.

**Step 2: Remove unused code**

Remove from DayScriptView:
- The `DayScriptView` function (lines 918-1349) — no longer used
- The `SortableTopicItem` wrapper (lines 824-909) — reorder is now in TopicManagerView
- Any imports only used by the removed function

Keep:
- All exported sub-components (DrawCanvas, ColorWheelPicker, etc.)
- All exported types and helpers

**Step 3: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/components/DayScriptView.tsx
git commit -m "refactor: remove unused DayScriptView default export, keep shared components"
```

---

### Task 6: Add `data-topic-id` Attributes for Scroll Sync

**Files:**
- Modify: `frontend/src/components/ScriptMirrorView.tsx`

**Step 1: Ensure both columns have `data-topic-id` on each topic section**

In the `renderContent` function of ScriptMirrorView, each topic's wrapper div already has `data-topic-id={topic.id}`. Verify this is present in both columns (it should be since `renderContent` is called for both editable=true and editable=false).

**Step 2: Verify scroll sync works**

Run the app and test:
1. Scroll left column slowly — right column should keep the same topic aligned
2. Scroll to a different topic — right column jumps to match
3. No jitter or lag (rAF throttling)
4. Works when topics have very different content heights (text vs no-text)

**Step 3: Commit (if any fixes needed)**

```bash
git add frontend/src/components/ScriptMirrorView.tsx
git commit -m "fix: ensure data-topic-id attributes on both columns for scroll sync"
```

---

### Summary of Files

| File | Action |
|------|--------|
| `frontend/src/components/ScriptPanel.tsx` | Create — parent component with tabs + shared state |
| `frontend/src/components/TopicManagerView.tsx` | Create — topic selection, reorder, generation |
| `frontend/src/components/ScriptMirrorView.tsx` | Create — dual-column scripts with element-aligned scroll |
| `frontend/src/components/DayScriptView.tsx` | Modify — export sub-components, remove default export |
| `frontend/src/components/DayFeedPanel.tsx` | Modify — import ScriptPanel instead of DayScriptView |
