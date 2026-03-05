# Digest Composer: Draft List Landing & Topic Ordering — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the empty default view with a draft list landing page, and add numbered topic ordering to the template creation modal.

**Architecture:** All changes are in `frontend/src/pages/DigestComposer.tsx`. The draft list is inline (not a modal) shown when no draft is selected. The topic selector replaces checkboxes with click-to-number badges. No backend changes needed.

**Tech Stack:** React, TypeScript

---

### Task 1: Add numbered topic ordering to TopicSelectorModal

**Files:**
- Modify: `frontend/src/pages/DigestComposer.tsx` (TopicSelectorModal ~line 920)

**Step 1: Change TopicSelectorModal state from Set to ordered array**

Replace the `selected` state and `toggle` function:

```tsx
// OLD
const [selected, setSelected] = useState<Set<number>>(new Set())

const toggle = (id: number) => {
  setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
}

const selectTop3 = () => {
  setSelected(new Set(topics.slice(0, 3).map(t => t.id)))
}
```

```tsx
// NEW
const [ordered, setOrdered] = useState<number[]>([])

const toggle = (id: number) => {
  setOrdered(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  )
}

const selectTop3 = () => {
  setOrdered(topics.slice(0, 3).map(t => t.id))
}
```

**Step 2: Update the "All" and "None" buttons**

```tsx
// OLD
<button onClick={() => setSelected(new Set(topics.map(t => t.id)))} ...>All</button>
<button onClick={() => setSelected(new Set())} ...>None</button>
```

```tsx
// NEW
<button onClick={() => setOrdered(topics.map(t => t.id))} ...>All</button>
<button onClick={() => setOrdered([])} ...>None</button>
```

**Step 3: Replace checkbox with numbered circle badge**

Replace the checkbox `<input>` and label rendering in the topics list:

```tsx
// OLD
<input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
```

```tsx
// NEW
<span
  style={{
    width: 22, height: 22, borderRadius: '50%',
    border: ordered.includes(t.id) ? 'none' : '2px solid var(--border)',
    background: ordered.includes(t.id) ? 'var(--accent)' : 'transparent',
    color: '#fff', fontSize: 11, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  }}
>
  {ordered.includes(t.id) ? ordered.indexOf(t.id) + 1 : ''}
</span>
```

**Step 4: Update onConfirm call and props**

Change the `onConfirm` prop type from `Set<number>` to `number[]`:

```tsx
// OLD
onConfirm: (selectedIds: Set<number>) => void
...
onClick={() => onConfirm(selected)}
```

```tsx
// NEW
onConfirm: (orderedIds: number[]) => void
...
onClick={() => onConfirm(ordered)}
```

Also update the Create Draft button disabled state:

```tsx
// Disable when nothing selected
disabled={ordered.length === 0}
```

**Step 5: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`

**Step 6: Commit**

```
git add frontend/src/pages/DigestComposer.tsx
git commit -m "feat: numbered topic ordering in template selector"
```

---

### Task 2: Update generateTemplateBlocks to use ordered array

**Files:**
- Modify: `frontend/src/pages/DigestComposer.tsx` (generateTemplateBlocks ~line 1333, handleCreateFromTemplate ~line 1410)

**Step 1: Change generateTemplateBlocks signature and ordering logic**

```tsx
// OLD
const generateTemplateBlocks = useCallback(async (selectedIds: Set<number>): Promise<DigestBlock[]> => {
  const sorted = sortTopics(topics)
  const featured = sorted.filter(t => selectedIds.has(t.id))
  const rest = sorted.filter(t => !selectedIds.has(t.id))
```

```tsx
// NEW
const generateTemplateBlocks = useCallback(async (orderedIds: number[]): Promise<DigestBlock[]> => {
  const orderedSet = new Set(orderedIds)
  const featured = orderedIds.map(id => topics.find(t => t.id === id)!).filter(Boolean)
  const rest = sortTopics(topics).filter(t => !orderedSet.has(t.id))
```

Also update the `topic_ids` passed to the backend to preserve order:

```tsx
// OLD
topic_ids: featured.map(t => t.id),
```

No change needed — `featured` is already ordered by user selection now.

**Step 2: Update handleCreateFromTemplate signature**

```tsx
// OLD
const handleCreateFromTemplate = useCallback(async (selectedIds: Set<number>) => {
  ...
  const newBlocks = await generateTemplateBlocks(selectedIds)
```

```tsx
// NEW
const handleCreateFromTemplate = useCallback(async (orderedIds: number[]) => {
  ...
  const newBlocks = await generateTemplateBlocks(orderedIds)
```

**Step 3: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`

**Step 4: Commit**

```
git add frontend/src/pages/DigestComposer.tsx
git commit -m "feat: use ordered topic IDs for template generation"
```

---

### Task 3: Add inline draft list when no draft is selected

**Files:**
- Modify: `frontend/src/pages/DigestComposer.tsx` (main return JSX ~line 1483)

**Step 1: Add draft list view in the main content area**

In the `<main>` section, after the "New Draft from Topics" button block and before the content blocks section, add a conditional draft list. The key condition: show when `!selectedDraftId`.

Wrap the existing content blocks, schedule, action buttons, and email preview sections in `{selectedDraftId && ( ... )}`.

When `!selectedDraftId`, show the draft list inline:

```tsx
{!selectedDraftId && (
  <div
    style={{
      background: 'var(--bg-raised)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}
  >
    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
        Drafts
      </h3>
    </div>
    {!drafts || drafts.length === 0 ? (
      <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
        No drafts yet. Create one from topics above.
      </div>
    ) : (
      <div>
        {[...drafts].sort((a, b) => b.date.localeCompare(a.date)).map(d => {
          const topicCount = (d.content_blocks || []).filter(
            (b: any) => b.type === 'topic-header' || b.type === 'topic'
          ).length
          const statusColor: Record<string, string> = {
            draft: 'var(--text-secondary)',
            scheduled: '#a78bfa',
            sent: '#4ade80',
          }
          return (
            <div
              key={d.id}
              onClick={() => setSelectedDraftId(d.id)}
              style={{
                padding: '12px 20px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid var(--border)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <div>
                <span style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>
                  {d.subject || d.date}
                </span>
                {d.subject && (
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 8 }}>
                    {d.date}
                  </span>
                )}
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 8 }}>
                  {topicCount} topic{topicCount !== 1 ? 's' : ''}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {d.sent_at && (
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {d.recipient_count} recipients
                  </span>
                )}
                <span style={{
                  fontSize: 11, fontWeight: 600, color: statusColor[d.status] || 'var(--text-tertiary)',
                  textTransform: 'uppercase' as const, letterSpacing: '0.05em',
                }}>
                  {d.status}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    )}
  </div>
)}
```

**Step 2: Hide the draft dropdown when no draft is selected**

The draft `<select>` in the date strip (line ~1729) should only show when a draft is selected:

```tsx
// OLD
{drafts && drafts.length > 0 && (
  <select ...>
```

```tsx
// NEW
{selectedDraftId && drafts && drafts.length > 0 && (
  <select ...>
```

**Step 3: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`

**Step 4: Commit**

```
git add frontend/src/pages/DigestComposer.tsx
git commit -m "feat: draft list landing page for digest composer"
```

---

### Task 4: Verify and deploy

**Step 1: Run full verification**

```bash
cd frontend && npx tsc --noEmit
```

**Step 2: Deploy**

```bash
git push origin master
./scripts/deploy.sh root@46.225.9.10
```
