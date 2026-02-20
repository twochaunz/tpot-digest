# Dashboard Improvements Design

## Problem

The dashboard lacks granular controls that the extension provides (category/topic CRUD, tweet deletion). Navigation is cumbersome (day-by-day only). Topics feel disorganized (uniform purple, stacked layout). Tweets don't link to X.

## Design

### 1. Date Picker with Calendar Popup

Keep prev/next arrows. Make the date text clickable -- opens a lightweight custom calendar dropdown (month grid). Click a day to jump to it, click outside to dismiss. Month/year navigation within the calendar. No external library.

### 2. Kanban Topic Layout

Topics displayed as vertical columns (~280px wide) in a horizontally scrollable container. Each column:

- **Header**: topic title + color dot + tweet count + trash icon (delete)
- **Body**: tweets stacked vertically, vertical scroll within column if many tweets
- **Create**: "+ New Topic" button/card at the end of the column row, inline creation

**Auto-rotating colors**: Palette of 8-10 distinct colors. New topics auto-cycle through palette based on existing topic count (modulo palette length). User can still pick manually.

Deleting a topic shows confirmation, then unassigns its tweets back to unsorted.

### 3. Undo System

Lightweight undo stack for reversible actions:

- **Actions**: delete tweet, delete topic, assign, unassign
- **UI**: Toast notification at bottom: "Tweet deleted. [Undo]" -- auto-dismiss after 5s
- **Keyboard**: Cmd+Z triggers undo of most recent action
- **Stack**: Last 10 actions, clears on date change
- **Implementation**: Each action pushes its inverse operation onto the stack. Undo pops and executes the inverse.

### 4. Unsorted Tweets Section (Feed-Style Inbox)

Stays above the Kanban columns. Fixed height (~400px) scrollable container. Wider, feed-style cards:

- Author handle + outlink icon to tweet on X
- Tweet text (truncated ~2 lines)
- Screenshot thumbnail (small, to the side)
- Checkbox for bulk selection
- Delete button (X) on hover -- removes tweet entirely

Bulk actions: select multiple, then assign to topic or bulk delete.

### 5. Inline Category Management

In the AssignDropdown (when assigning tweets to topic+category):

- Bottom of category list: "+ Add Category" expands inline form (name + color picker)
- Each category in list gets small delete icon on hover
- Keeps category management contextual

### 6. Tweet Outlinks

Small external-link icon next to author handle on every tweet card (unsorted and topic columns). Opens tweet URL on X in new tab. Uses the `url` field from the backend Tweet model.

Frontend `Tweet` interface needs `url: string | null` added (backend already has the field).

### 7. Backend Schema Update

Add `url` to `TweetOut` schema if not already exposed. The model field `url` exists on the Tweet model.

## Data Flow Changes

```
DailyView (date state)
├─ DatePicker (prev/next arrows + clickable date -> calendar popup)
├─ UnsortedSection (fixed-height scrollable feed)
│  ├─ Feed-style tweet cards with delete (X) button
│  ├─ Outlink icon -> tweet on X
│  ├─ Bulk select -> assign or delete
│  └─ AssignDropdown (with inline category add/delete)
├─ Kanban columns (horizontal scroll)
│  ├─ TopicColumn[] (one per topic, ~280px wide)
│  │  ├─ Header: title, color dot, count, delete button
│  │  └─ Tweet cards stacked vertically
│  └─ "+ New Topic" card at end
├─ UndoToast (bottom of screen)
│  └─ "[Action]. Undo" -- auto-dismiss 5s
└─ Cmd+Z listener -> undo stack
```

## Color Palette

```
#6366f1 (indigo)
#ec4899 (pink)
#f59e0b (amber)
#22c55e (green)
#3b82f6 (blue)
#ef4444 (red)
#06b6d4 (cyan)
#8b5cf6 (violet)
#f97316 (orange)
#14b8a6 (teal)
```

Colors auto-assigned in order. Index = (existing topic count for date) % palette length.
