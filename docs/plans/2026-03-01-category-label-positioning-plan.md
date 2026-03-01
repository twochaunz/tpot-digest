# Category Label Responsive Positioning — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Position category labels to the left of tweet cards (right-aligned to tweet card left edge with 8px gap) on desktop, and above tweet groups on mobile.

**Architecture:** Replace fixed `marginLeft: -30` with `transform: translateX(calc(-100% - 8px))` inside a centering wrapper that matches tweet card positioning. On mobile (<900px), labels render inline above tweets with no transform. A `useMediaQuery` hook provides the viewport breakpoint.

**Tech Stack:** React, inline styles, `window.matchMedia`

---

### Task 1: Create `useMediaQuery` hook

**Files:**
- Create: `frontend/src/hooks/useMediaQuery.ts`

**Step 1: Create the hook file**

```ts
import { useState, useEffect } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [query])

  return matches
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/hooks/useMediaQuery.ts
git commit -m "feat: add useMediaQuery hook for responsive breakpoints"
```

---

### Task 2: Update CategoryNavLabel — desktop transform + mobile inline

**Files:**
- Modify: `frontend/src/components/TopicSection.tsx:212-372` (CategoryNavLabel component)

**Step 1: Add `isWide` prop to CategoryNavLabel**

Add prop to the component signature at line 212:

```tsx
function CategoryNavLabel({
  allCategories,
  currentCategoryKey,
  topicId,
  onHoverChange,
  isWide,
}: {
  allCategories: Array<{ key: string | null; name: string; color: string }>
  currentCategoryKey: string | null
  topicId: number
  onHoverChange?: (hovered: boolean) => void
  isWide: boolean
}) {
```

**Step 2: Update single-category label (lines 270-287)**

Replace the return block for `allCategories.length <= 1`:

```tsx
  if (allCategories.length <= 1) {
    const label = (
      <div style={{
        display: 'inline-block',
        background: displayed.color,
        color: '#fff',
        fontSize: 15,
        fontWeight: 700,
        padding: '4px 10px',
        borderRadius: 'var(--radius-sm)',
        letterSpacing: '0.03em',
        transform: isWide ? 'translateX(calc(-100% - 8px)) translateY(4px)' : undefined,
      }}>
        {displayed.name}
      </div>
    )

    if (isWide) {
      return <div style={{ maxWidth: 600, margin: '0 auto', width: '100%' }}>{label}</div>
    }
    return label
  }
```

Key changes:
- Remove `marginLeft: -30`
- Remove `transform: 'translateY(4px)'` for mobile
- Desktop: wrap in centering div + use full transform
- Mobile: plain inline-block, no transform

**Step 3: Update multi-category wrapper (lines 289-371)**

Replace the outer wrapper div styles:

```tsx
  // Wrap the whole multi-category block
  const menu = (
    <div
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={{
        position: 'relative',
        display: 'inline-block',
        transform: isWide ? 'translateX(calc(-100% - 8px)) translateY(4px)' : undefined,
        pointerEvents: 'auto',
      }}
    >
      {/* ... existing inner content unchanged (current label + cascade menu) ... */}
    </div>
  )

  if (isWide) {
    return <div style={{ maxWidth: 600, margin: '0 auto', width: '100%' }}>{menu}</div>
  }
  return menu
```

Key changes:
- Remove `marginLeft: -30`
- Remove `transform: 'translateY(4px)'` (merged into conditional)
- Desktop: wrap in centering div + use full transform
- Mobile: plain inline-block

**Step 4: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: Errors about missing `isWide` prop at call sites (fixed in Task 3)

---

### Task 3: Update TopicSection — pass `isWide` + conditional sticky wrapper

**Files:**
- Modify: `frontend/src/components/TopicSection.tsx:388-719` (TopicSection component)

**Step 1: Import and use the hook**

At the top of `TopicSection` function (line 398), add:

```tsx
import { useMediaQuery } from '../hooks/useMediaQuery'
```

Inside the component:

```tsx
const isWide = useMediaQuery('(min-width: 900px)')
```

**Step 2: Update OG tweet sticky label wrapper (lines 609-624)**

Change the sticky wrapper to conditional `height`:

```tsx
<div
  style={{
    position: 'sticky',
    top: 52,
    zIndex: labelHovered ? 10 : 4,
    pointerEvents: 'none',
    height: isWide ? 0 : undefined,
    marginBottom: isWide ? 0 : 8,
  }}
>
  <CategoryNavLabel
    allCategories={allCategoryList}
    currentCategoryKey="og"
    topicId={topicId}
    onHoverChange={setLabelHovered}
    isWide={isWide}
  />
</div>
```

**Step 3: Update category group sticky label wrapper (lines 682-697)**

Same pattern:

```tsx
<div
  style={{
    position: 'sticky',
    top: 52,
    zIndex: labelHovered ? 10 : 4,
    pointerEvents: 'none',
    height: isWide ? 0 : undefined,
    marginBottom: isWide ? 0 : 8,
  }}
>
  <CategoryNavLabel
    allCategories={allCategoryList}
    currentCategoryKey={catKey}
    topicId={topicId}
    onHoverChange={setLabelHovered}
    isWide={isWide}
  />
</div>
```

**Step 4: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS, no errors

**Step 5: Commit**

```bash
git add frontend/src/components/TopicSection.tsx
git commit -m "feat: responsive category labels - transform positioning on desktop, inline on mobile"
```

---

### Task 4: Adjust DayFeedPanel padding for responsive

**Files:**
- Modify: `frontend/src/components/DayFeedPanel.tsx:288`

**Step 1: Import hook and make padding responsive**

Import `useMediaQuery` and adjust left padding:

```tsx
const isWide = useMediaQuery('(min-width: 900px)')
```

Update the padding at line 288:

```tsx
padding: isWide ? '0 16px 80px 40px' : '0 8px 80px 8px',
```

Desktop keeps 40px left padding (room for labels extending into this area).
Mobile uses 8px symmetric padding (labels are inline, no overflow needed).

**Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add frontend/src/components/DayFeedPanel.tsx
git commit -m "feat: responsive feed panel padding for mobile"
```

---

### Task 5: Visual verification

**Step 1: Run dev server**

Run: `docker compose up` (or local dev server)

**Step 2: Desktop verification (viewport > 900px)**

Check:
- Category labels sit to the LEFT of tweet cards
- Labels' right edge has ~8px gap from tweet card left edge
- Cascade menu on hover still works and aligns properly
- Labels stay sticky while scrolling through a category group
- Labels track tweet card centering when resizing window

**Step 3: Mobile verification (viewport < 900px)**

Check:
- Category labels appear ABOVE tweet groups as inline blocks
- Labels take up space in flow (no overlap with tweets)
- Labels still sticky while scrolling
- Feed panel has reduced padding (8px)
- No horizontal overflow or clipping

**Step 4: Breakpoint transition**

Resize browser across 900px boundary and verify smooth transition between modes.

**Step 5: Final commit if any tweaks needed**

```bash
git add -A
git commit -m "fix: category label positioning tweaks after visual review"
```
