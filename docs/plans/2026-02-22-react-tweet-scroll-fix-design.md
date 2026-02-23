# React-Tweet + Scroll Fix Design

## Issue 1: Page Bounce on Scroll

**Problem:** The outer page shifts a few pixels vertically when scrolling inside the feed. The carousel container uses `height: calc(100vh - 65px)` but if the header isn't exactly 65px, the body can scroll.

**Fix:** Lock the DailyView root container with `overflow: hidden` and `height: 100vh`. Ensure only DayFeedPanel's inner container scrolls vertically. No body-level scroll should be possible.

## Issue 2: Tweet Rendering with react-tweet

**Problem:** Current custom EmbeddedTweet component only renders text, avatar, name, and basic media. Missing: quoted tweets, thread context, reply indicators, rich media. User wants tweets displayed like techtwitter.com -- full native Twitter card rendering without engagement metrics.

**Approach:** Use `react-tweet` library (already installed) with `<Tweet>` component.

- Pass `tweet_id` (already stored in DB) to react-tweet
- Set `theme="dark"`
- CSS override to hide engagement metrics (likes, retweets, replies, views, bookmarks)
- react-tweet fetches tweet data via Twitter's syndication API client-side
- Handles quoted tweets, media, threads, avatars automatically
- No backend changes needed

**What changes:**
- `EmbeddedTweet.tsx` -- replace custom card with react-tweet `<Tweet>` component
- `design-system.css` -- add CSS overrides to hide engagement metrics inside react-tweet cards
- `DailyView.tsx` -- fix overflow on root container
- Drag/drop wrappers in `UnsortedSection.tsx` and `TopicSection.tsx` remain unchanged (they wrap EmbeddedTweet)

**What stays the same:**
- Backend (no changes)
- Data model (no changes)
- Drag-and-drop behavior
- Context menu, hover actions
- Detail modal
