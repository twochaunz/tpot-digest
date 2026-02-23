# Dashboard Polish v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix react-tweet engagement hiding, add header-feed padding, move search to right with Cmd+K, center side panels vertically.

**Architecture:** Four independent CSS/layout fixes in DailyView.tsx, DayCarousel.tsx, DayFeedPanel.tsx, and design-system.css. No backend changes.

**Tech Stack:** React 19, TypeScript, react-tweet 3.3.0, CSS

---

### Task 1: Fix react-tweet engagement metric hiding

**Files:**
- Modify: `frontend/src/styles/design-system.css:51-55`

**Step 1: Replace broken CSS selectors**

The current selectors at lines 51-55 target `[data-testid="tweet-actions"]` and `.react-tweet-actions-row` which don't exist in react-tweet 3.3.0. react-tweet uses CSS Modules with hashed class names that preserve the base name (e.g., `_actions__k3d9f`).

Replace lines 51-55:

```css
/* react-tweet overrides: hide engagement metrics */
.react-tweet-container [data-testid="tweet-actions"],
.react-tweet-container .react-tweet-actions-row {
  display: none !important;
}
```

With:

```css
/* react-tweet overrides: hide engagement metrics and info row */
.react-tweet-container [class*="actions"],
.react-tweet-container [class*="tweet-info"],
.react-tweet-container [class*="tweetInfo"] {
  display: none !important;
}
```

This uses CSS attribute selectors that match any class containing "actions" (the like/reply/retweet row), "tweet-info" or "tweetInfo" (the view count / timestamp info row at the bottom).

**Step 2: TypeScript check**

Run: `cd /Users/wonchankim/Projects/happy-test/frontend && npx tsc --noEmit`
Expected: no errors (CSS-only change)

**Step 3: Commit**

```bash
cd /Users/wonchankim/Projects/happy-test && git add frontend/src/styles/design-system.css && git commit -m "fix: correct CSS selectors to hide react-tweet engagement metrics"
```

---

### Task 2: Add padding between header and feeds

**Files:**
- Modify: `frontend/src/components/DayFeedPanel.tsx:190`

**Step 1: Add top padding**

In `DayFeedPanel.tsx` line 190, the padding is currently `'0 16px 80px'`. Change to `'12px 16px 80px'`.

Find:
```tsx
padding: '0 16px 80px',
```

Replace with:
```tsx
padding: '12px 16px 80px',
```

**Step 2: TypeScript check**

Run: `cd /Users/wonchankim/Projects/happy-test/frontend && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
cd /Users/wonchankim/Projects/happy-test && git add frontend/src/components/DayFeedPanel.tsx && git commit -m "fix: add top padding between header and feed content"
```

---

### Task 3: Move search to right side + Cmd+K shortcut

**Files:**
- Modify: `frontend/src/pages/DailyView.tsx`

**Step 1: Add useEffect and useRef imports**

Line 1 currently imports `useState, useCallback`. Add `useEffect, useRef`:

```tsx
import { useState, useCallback, useEffect, useRef } from 'react'
```

**Step 2: Add searchRef and Cmd+K effect**

After line 23 (`const { showEngagement, toggle: toggleEngagement } = useEngagementToggle()`), add:

```tsx
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])
```

**Step 3: Restructure header layout**

Replace the entire header content (lines 58-141, everything inside the `<div style={{ maxWidth: 1400, ... }}>`) with:

```tsx
          {/* Left: empty for balance */}
          <div style={{ flex: 1 }} />

          {/* Center: date picker */}
          <DatePicker value={date} onChange={setDate} />

          {/* Right: search + settings */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
            <div style={{ position: 'relative' }}>
              <input
                ref={searchRef}
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
              {/* Cmd+K hint badge */}
              {!searchFocused && !search && (
                <span
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-tertiary)',
                    fontSize: 10,
                    fontFamily: 'var(--font-body)',
                    background: 'var(--bg-elevated)',
                    padding: '2px 6px',
                    borderRadius: 'var(--radius-sm)',
                    pointerEvents: 'none',
                    border: '1px solid var(--border)',
                  }}
                >
                  &#8984;K
                </span>
              )}
            </div>

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
```

Note: The engagement toggle button is removed from the header. The `showEngagement` state and `useEngagementToggle` import can also be removed, along with the `showEngagement` prop on `TweetDetailModal`. But to keep this task minimal, just remove the button from the header. If the engagement toggle is needed elsewhere, keep the hook import.

Actually — keep the engagement toggle state and pass it to the modal. Just remove the toggle button from the header since we're hiding engagement via CSS now.

**Step 4: Clean up unused engagement toggle button**

Remove the engagement toggle button that was in the right section (the `<button onClick={toggleEngagement}...>` block). The `useEngagementToggle` hook import and `showEngagement` state should stay since `TweetDetailModal` still uses `showEngagement`.

**Step 5: TypeScript check**

Run: `cd /Users/wonchankim/Projects/happy-test/frontend && npx tsc --noEmit`
Expected: no errors

**Step 6: Commit**

```bash
cd /Users/wonchankim/Projects/happy-test && git add frontend/src/pages/DailyView.tsx && git commit -m "feat: move search to right side with Cmd+K shortcut"
```

---

### Task 4: Center side panels vertically in carousel

**Files:**
- Modify: `frontend/src/components/DayCarousel.tsx:140-153`

**Step 1: Change panel wrapper styles for side panels**

In the panel wrapper div (line 141-153), change `transformOrigin` from `'center top'` to `'center center'`, and add flex centering for side panels.

Replace the style object:

```tsx
style={{
  flex: `0 0 ${config.widthPct}%`,
  scrollSnapAlign: 'center',
  transform: `scale(${config.scale})`,
  opacity: config.opacity,
  transition: 'transform 0.3s ease, opacity 0.3s ease',
  transformOrigin: 'center top',
  position: 'relative',
  height: '100%',
  overflow: 'hidden',
}}
```

With:

```tsx
style={{
  flex: `0 0 ${config.widthPct}%`,
  scrollSnapAlign: 'center',
  transform: `scale(${config.scale})`,
  opacity: config.opacity,
  transition: 'transform 0.3s ease, opacity 0.3s ease',
  transformOrigin: isCenter ? 'center top' : 'center center',
  position: 'relative',
  height: '100%',
  overflow: 'hidden',
  display: isCenter ? undefined : 'flex',
  alignItems: isCenter ? undefined : 'center',
}}
```

Center panel keeps `transformOrigin: 'center top'` so it scrolls from the top. Side panels use `'center center'` + flex centering so the scaled-down preview is vertically centered.

**Step 2: TypeScript check**

Run: `cd /Users/wonchankim/Projects/happy-test/frontend && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
cd /Users/wonchankim/Projects/happy-test && git add frontend/src/components/DayCarousel.tsx && git commit -m "fix: center side panels vertically in carousel"
```
