# Dashboard Carousel Redesign

## Problem

The current dashboard is a single-column vertical feed with custom-rendered tweet cards that don't look like real tweets. Navigation between days requires clicking the date picker. Topics collapse/expand but don't guide the user through the content smoothly.

## Solution

Redesign the dashboard as a 3-panel horizontal day carousel with embedded tweets (react-tweet), sticky topic headers, and gentle magnetic snap scrolling.

## Design

### 1. Header

- Date centered, bold, large (18px+)
- Left/right arrow buttons flanking the date
- Engagement toggle + settings pushed to the right
- Search stays in header

### 2. Three-Panel Day Carousel

A horizontal scroll container with CSS `scroll-snap-type: x mandatory`.

- **5 panels loaded** (current day +/- 2 days), 3 visible at once
- **Center panel**: ~60% viewport width, full opacity, full scale
- **Side panels**: ~20% each, 85% scale, 50% opacity
- **Navigation**: swipe/drag horizontally, left/right arrow keys, or click header arrows
- **Transitions**: smooth CSS snap transitions
- **Date updates**: header date syncs with the centered panel
- **Prefetching**: React Query prefetches adjacent days' tweet data

### 3. Tweet Rendering — react-tweet

Replace custom TweetCard with `<Tweet id={tweetId} />` from react-tweet.

- **Dark mode**: `data-theme="dark"` wrapper
- **Tweet ID**: use existing `tweet_id` field (X post ID)
- **Fallback**: if tweet unavailable on X, show minimal card from our stored data
- **Engagement toggle**: CSS override to hide engagement metrics when toggled off
- **Selection/drag**: embed wrapped in container with checkbox, drag handle, hover actions
- **Legacy tweets**: keep LegacyCard for screenshot-only tweets

### 4. Feed Layout (within each day panel)

Vertical scrollable feed:

1. **Unsorted section** at top (hidden if 0 tweets)
2. **Topic sections** stacked below

### 5. Topic Sections

- **Sticky headers**: `position: sticky` below the main date header. As you scroll through a topic, its header sticks at the top. Next topic's header pushes it away.
- **Prominent tweet count**: larger font, pill-shaped badge with topic accent color background so high-activity topics visually pop
- **Magnetic snap**: CSS `scroll-snap-type: y proximity` on the feed container. Topic headers gently snap when near the top, but scrolling is free — not locked.
- **Toggle behavior**: opening a topic triggers `scrollIntoView({ behavior: 'smooth', block: 'start' })`
- **Collapse/expand, color dots, inline editing, drag-drop**: all preserved from current implementation

### 6. Keyboard Navigation

- **Left/Right arrows**: switch between days in the carousel
- **Free scroll**: up/down scrolls the active day's feed naturally
- **Topic snap**: gentle proximity snap, not forced

### 7. Dependencies

- **react-tweet**: embedded tweet rendering (no Twitter API needed, uses syndication API)
- No new carousel library — pure CSS scroll-snap

### 8. What's Preserved

- Drag-and-drop (dnd-kit) for tweet organization
- Context menus
- Undo system for bulk operations
- Topic CRUD (create, edit title, delete, color)
- Category grouping within topics
- Search filtering
- Engagement toggle
- Settings page link
