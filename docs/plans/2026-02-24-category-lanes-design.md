# Category Lane Headers Design

## Problem

Current category display within topics is a tiny 6px color dot + 11px label text. Categories are barely visible, don't follow a narrative order, and groups blend together with no visual separation. This makes it hard to tell the story of a topic during both curation and video recording.

## Solution: Category Lane Headers

Replace the minimal dot+label with prominent lane headers that create clear "chapters" within each topic.

### Visual Design

Each category group gets a header with:
- **3px left border** in the category's color (consistent with OG tweet's gold border pattern)
- **Category name** at 14px, font-weight 600, in the category's color
- **Tweet count** as a small badge
- **Subtle background tint** — category color at ~5% opacity
- **16px vertical gap** between category groups for clear separation
- **Uncategorized** group: rendered last with gray styling

### Narrative Sort Order

Categories sort in a fixed story arc order:

1. OG (gold) — already pinned at top, outside category groups
2. Context (blue) — sortOrder: 1
3. Kek (purple) — sortOrder: 2
4. Signal Boost (green) — sortOrder: 3
5. Pushback (orange) — sortOrder: 4
6. Hot Take (red) — sortOrder: 5
7. Uncategorized — always last (sortOrder: 999)

### Files Changed

- `frontend/src/constants/categories.ts` — add `sortOrder` field to CategoryDef and each category
- `frontend/src/components/TopicSection.tsx` — replace dot+label with lane header, sort groups by sortOrder, add spacing

### Files NOT Changed

- TweetCard / EmbeddedTweet — cards stay the same
- Backend/API — no schema change (categories are strings)
- Drag-and-drop — unchanged
- OG tweet display — already prominent at top
