# React-Tweet + Scroll Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the outer page bounce when scrolling inside the feed, and replace the custom tweet cards with react-tweet components (dark theme, engagement metrics hidden via CSS).

**Architecture:** Two independent fixes. (1) Lock the DailyView root to `height: 100vh; overflow: hidden` so only the inner DayFeedPanel scrolls. (2) Replace the custom `EmbeddedTweet` component body with react-tweet's `<Tweet>` component, passing the `tweet_id` string. Add CSS overrides to hide engagement metrics. Keep existing drag/click/context-menu wrappers untouched.

**Tech Stack:** React 19, react-tweet 3.3.0 (already installed), CSS overrides, TypeScript

---

### Task 1: Fix outer page scroll bounce

**Files:**
- Modify: `frontend/src/pages/DailyView.tsx:30-34`

**Step 1: Change the root container style**

In `DailyView.tsx`, the root `<div>` at line 30 currently has:

```tsx
style={{
  minHeight: '100vh',
  background: 'var(--bg-base)',
}}
```

Change it to:

```tsx
style={{
  height: '100vh',
  overflow: 'hidden',
  background: 'var(--bg-base)',
  display: 'flex',
  flexDirection: 'column' as const,
}}
```

This locks the page to exactly the viewport height. No outer scroll.

**Step 2: Make the carousel fill remaining space**

The `<DayCarousel>` container in `DayCarousel.tsx` line 131 currently uses `height: 'calc(100vh - 65px)'`. Change it to `flex: 1` and `minHeight: 0` so it fills whatever space the header doesn't use, regardless of exact header height.

In `frontend/src/components/DayCarousel.tsx:127-133`, change:

```tsx
style={{
  display: 'flex',
  overflowX: 'auto',
  scrollSnapType: 'x mandatory',
  height: 'calc(100vh - 65px)',
  scrollbarWidth: 'none',
}}
```

to:

```tsx
style={{
  display: 'flex',
  overflowX: 'auto',
  scrollSnapType: 'x mandatory',
  flex: 1,
  minHeight: 0,
  scrollbarWidth: 'none',
}}
```

**Step 3: Verify in browser**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

Test manually: scroll inside the feed, confirm the outer page does not shift.

**Step 4: Commit**

```bash
git add frontend/src/pages/DailyView.tsx frontend/src/components/DayCarousel.tsx
git commit -m "fix: lock outer page scroll, carousel fills remaining space"
```

---

### Task 2: Replace EmbeddedTweet with react-tweet

**Files:**
- Modify: `frontend/src/components/EmbeddedTweet.tsx` (full rewrite of component body)
- Modify: `frontend/src/styles/design-system.css` (add CSS overrides)

**Step 1: Rewrite EmbeddedTweet to use react-tweet**

Replace the entire contents of `frontend/src/components/EmbeddedTweet.tsx` with:

```tsx
import { Tweet } from 'react-tweet'
import type { Tweet as TweetData } from '../api/tweets'

interface EmbeddedTweetProps {
  tweet: TweetData
  onTweetClick?: (tweet: TweetData) => void
  onContextMenu?: (e: React.MouseEvent, tweet: TweetData) => void
  onDelete?: (id: number) => void
}

export function EmbeddedTweet({ tweet, onTweetClick, onContextMenu, onDelete }: EmbeddedTweetProps) {
  return (
    <div
      className="embedded-tweet-wrapper"
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault()
              onContextMenu(e, tweet)
            }
          : undefined
      }
      onClick={() => onTweetClick?.(tweet)}
      style={{
        position: 'relative',
        cursor: onTweetClick ? 'pointer' : 'default',
      }}
    >
      <div data-theme="dark" className="react-tweet-container">
        <Tweet id={tweet.tweet_id} />
      </div>

      {/* Hover actions overlay */}
      <div className="embedded-tweet-actions">
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete(tweet.id)
            }}
            style={{
              width: 28,
              height: 28,
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(0,0,0,0.6)',
              border: 'none',
              color: '#fff',
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Remove tweet"
          >
            &times;
          </button>
        )}
        {tweet.url && (
          <a
            href={tweet.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 28,
              height: 28,
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(0,0,0,0.6)',
              border: 'none',
              color: '#fff',
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textDecoration: 'none',
            }}
            title="Open on X"
          >
            &#8599;
          </a>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Add CSS overrides to design-system.css**

Append to `frontend/src/styles/design-system.css`:

```css
/* react-tweet overrides: hide engagement metrics */
.react-tweet-container [data-testid="tweet-actions"],
.react-tweet-container .react-tweet-actions-row,
[data-theme="dark"] [class*="actions_"] {
  display: none !important;
}

/* react-tweet: remove default margins/padding, fit container */
.react-tweet-container {
  --tweet-container-margin: 0;
}

.react-tweet-container > div {
  margin: 0 !important;
}

/* Hover actions for embedded tweets */
.embedded-tweet-wrapper .embedded-tweet-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: none;
  gap: 4px;
  z-index: 2;
}

.embedded-tweet-wrapper:hover .embedded-tweet-actions {
  display: flex;
}
```

**Step 3: TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

**Step 4: Verify in browser**

- Tweets should render as native Twitter cards with dark theme
- Quoted tweets should appear inline
- Media (images, video) should display
- Engagement metrics (likes, retweets, replies, views) should be hidden
- Hover shows delete/open actions
- Drag and drop still works (wrappers in UnsortedSection/TopicSection are unchanged)

**Step 5: Commit**

```bash
git add frontend/src/components/EmbeddedTweet.tsx frontend/src/styles/design-system.css
git commit -m "feat: replace custom tweet cards with react-tweet dark embeds"
```

---

### Task 3: Fine-tune CSS overrides for react-tweet engagement hiding

react-tweet's class names may vary. After Task 2, inspect the rendered DOM in browser DevTools.

**Files:**
- Modify: `frontend/src/styles/design-system.css`

**Step 1: Inspect and refine selectors**

Open browser DevTools on a rendered tweet. Find the element containing likes/retweets/replies. It typically uses class names like:
- `.css-xxx` (CSS modules)
- `[data-testid="like"]`, `[data-testid="reply"]`, `[data-testid="retweet"]`
- A container row at the bottom of the tweet

Update the CSS selectors in `design-system.css` to match whatever react-tweet 3.3.0 actually renders. The goal: the entire bottom action bar (like, reply, retweet, share, views) is `display: none`.

Common selectors that work with react-tweet 3.x:

```css
/* Hide the entire bottom actions bar in react-tweet */
.react-tweet-container [class*="tweet-replies"],
.react-tweet-container [class*="tweet-actions"],
.react-tweet-container [class*="tweet-info"] {
  display: none !important;
}
```

**Step 2: Verify engagement is hidden for all tweet types**

Check: regular tweet, quote tweet, tweet with media, tweet with video. All should have no engagement row.

**Step 3: Commit**

```bash
git add frontend/src/styles/design-system.css
git commit -m "fix: refine react-tweet CSS overrides for engagement hiding"
```
