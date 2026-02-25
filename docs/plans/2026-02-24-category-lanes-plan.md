# Category Lane Headers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the tiny dot+label category display with prominent lane headers that create clear narrative "chapters" within each topic.

**Architecture:** Add `sortOrder` to category definitions, sort category groups by that order in TopicSection, and replace the 6px dot + 11px label with a full-width lane header (3px colored left border, bold name, count badge, spacing between groups).

**Tech Stack:** React, TypeScript, inline styles (existing pattern)

---

### Task 1: Add sortOrder to category definitions

**Files:**
- Modify: `frontend/src/constants/categories.ts`

**Step 1: Update CategoryDef interface and add sortOrder**

Replace the entire file:

```typescript
export interface CategoryDef {
  key: string
  label: string
  color: string
  sortOrder: number
}

export const CATEGORIES: CategoryDef[] = [
  { key: 'context', label: 'Context', color: '#60A5FA', sortOrder: 1 },
  { key: 'kek', label: 'Kek', color: '#C084FC', sortOrder: 2 },
  { key: 'signal-boost', label: 'Signal Boost', color: '#34D399', sortOrder: 3 },
  { key: 'pushback', label: 'Pushback', color: '#FB923C', sortOrder: 4 },
  { key: 'hot-take', label: 'Hot Take', color: '#F87171', sortOrder: 5 },
]

export const CATEGORY_MAP = new Map(CATEGORIES.map(c => [c.key, c]))

/** Lookup a category by key. Returns label, color, and sortOrder, falling back to gray for legacy/unknown keys. */
export function getCategoryDef(key: string): { label: string; color: string; sortOrder: number } {
  const found = CATEGORY_MAP.get(key)
  if (found) return found
  return { label: key, color: '#9CA3AF', sortOrder: 999 }
}
```

**Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (sortOrder is additive, existing callers just get an extra field)

**Step 3: Commit**

```bash
git add frontend/src/constants/categories.ts
git commit -m "feat: add sortOrder to category definitions for narrative ordering"
```

---

### Task 2: Sort category groups by narrative order in TopicSection

**Files:**
- Modify: `frontend/src/components/TopicSection.tsx:67-80` (the `tweetsByCategory` useMemo in `TopicSectionWithData`)

**Step 1: Update the tweetsByCategory memo to include sortOrder and sort**

Replace lines 67-80 (`const tweetsByCategory = useMemo(...)`) with:

```typescript
  const tweetsByCategory = useMemo(() => {
    const byCat = new Map<string | null, { category: { name: string; color: string; sortOrder: number } | null; tweets: Tweet[] }>()
    for (const tweet of remainingTweets) {
      const catKey = tweet.category ?? null
      if (!byCat.has(catKey)) {
        const def = catKey ? getCategoryDef(catKey) : null
        byCat.set(catKey, {
          category: def ? { name: def.label, color: def.color, sortOrder: def.sortOrder } : null,
          tweets: [],
        })
      }
      byCat.get(catKey)!.tweets.push(tweet)
    }
    // Sort by narrative order: categorized groups by sortOrder, uncategorized (null) last
    const sorted = new Map(
      Array.from(byCat.entries()).sort(([aKey, aGroup], [bKey, bGroup]) => {
        if (aKey === null) return 1
        if (bKey === null) return -1
        return (aGroup.category?.sortOrder ?? 999) - (bGroup.category?.sortOrder ?? 999)
      })
    )
    return sorted
  }, [remainingTweets])
```

**Step 2: Update the TopicSectionProps type for the new category shape**

On line 191, update the `tweetsByCategory` type in `TopicSectionProps`:

```typescript
  tweetsByCategory: Map<string | null, { category: { name: string; color: string; sortOrder: number } | null; tweets: Tweet[] }>
```

**Step 3: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/components/TopicSection.tsx
git commit -m "feat: sort category groups by narrative order in TopicSection"
```

---

### Task 3: Replace dot+label with lane header

**Files:**
- Modify: `frontend/src/components/TopicSection.tsx:507-554` (the category group rendering loop)

**Step 1: Replace the category group rendering**

Replace lines 507-555 (the `Array.from(tweetsByCategory.entries()).map(...)` block) with:

```tsx
          {Array.from(tweetsByCategory.entries()).map(([catKey, group], idx) => (
            <div key={catKey ?? 'uncategorized'} style={{ marginTop: idx > 0 ? 16 : 0 }}>
              {/* Category lane header */}
              <div
                style={{
                  borderLeft: `3px solid ${group.category?.color || '#6B7280'}`,
                  background: group.category
                    ? `${group.category.color}0D`
                    : 'rgba(107, 114, 128, 0.05)',
                  padding: '8px 12px',
                  marginBottom: 10,
                  borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: group.category?.color || '#6B7280',
                  }}
                >
                  {group.category?.name || 'Uncategorized'}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: group.category?.color || '#6B7280',
                    background: group.category
                      ? `${group.category.color}1A`
                      : 'rgba(107, 114, 128, 0.1)',
                    padding: '1px 8px',
                    borderRadius: 10,
                  }}
                >
                  {group.tweets.length}
                </span>
              </div>

              {/* Tweet cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {group.tweets.map((t) => (
                  <DraggableTweetInTopic
                    key={t.id}
                    tweet={t}
                    topicId={topicId}
                    ogTweetId={ogTweetId}
                    onSetOg={onSetOg}
                    onTweetClick={onTweetClick}
                    onContextMenu={onContextMenu}
                  />
                ))}
              </div>
            </div>
          ))}
```

Note: The `0D` suffix on hex colors is ~5% opacity, `1A` is ~10% opacity. This creates a subtle tinted background for the lane header and a slightly stronger tint for the count badge.

**Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 3: Visual verification**

Run: `cd frontend && npm run dev`
Open the dashboard, navigate to a date with topics that have categorized tweets. Verify:
- Each category group has a colored left border header
- Category name is bold and in the category's color
- Count badge appears next to the name
- Groups are sorted: Context → Kek → Signal Boost → Pushback → Hot Take → Uncategorized
- 16px spacing between groups
- OG tweet still pinned at top above all category groups

**Step 4: Commit**

```bash
git add frontend/src/components/TopicSection.tsx
git commit -m "feat: replace dot+label with prominent category lane headers"
```
