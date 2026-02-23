# X API Tweet Display - Design Document

## Summary

Replace screenshot-based tweet display with native tweet cards rendered from X API data. The X API is the source of truth for tweet content; the Chrome extension supplements with page context the API cannot provide.

## Key Decisions

- **API as source of truth**: X API v2 provides tweet text, author info, media, engagement. Extension only provides feed_source, thread_id, thread_position.
- **Fetch at save time**: Backend calls X API when a tweet is saved. Data persists even if tweet is later deleted.
- **Fail on API error**: If X API call fails, the save endpoint returns an error rather than storing partial data.
- **API key on backend only**: `X_API_BEARER_TOKEN` env var, never exposed to extension or frontend.
- **Engagement toggle**: Global toggle (localStorage) to show/hide engagement stats across all tweet cards.
- **Download as PNG**: `html-to-image` in the browser captures the rendered card. Crop tool retained for partial captures.
- **Backward compatible**: Old tweets with screenshots still display via screenshot fallback.

## Data Model Changes

### New fields on Tweet model (from X API)

| Field | Type | Source |
|-------|------|--------|
| `author_avatar_url` | str, nullable | X API user.profile_image_url |
| `author_verified` | bool, default False | X API user.verified |
| `created_at` | datetime, nullable | X API tweet.created_at (posted time) |

### Modified fields

| Field | Change |
|-------|--------|
| `text` | Now populated from X API instead of DOM parsing |
| `media_urls` | Now from X API with type info (photo/video/gif) |
| `engagement` | Now exact counts from X API public_metrics |

### Extension-only fields (unchanged)

| Field | Source |
|-------|--------|
| `feed_source` | Extension (for_you, following, search, etc.) |
| `thread_id` | Extension (from page URL) |
| `thread_position` | Extension (DOM position) |

### Kept for backward compat

- `screenshot_path` - nullable, used by old tweets

### New env var

- `X_API_BEARER_TOKEN` - Bearer token for X API v2

## Backend Changes

### New: `backend/app/services/x_api.py`

Async X API v2 client using httpx:

- `fetch_tweet(tweet_id: str) -> dict`
- Calls `GET https://api.x.com/2/tweets/{id}` with:
  - `tweet.fields`: text, created_at, public_metrics, entities
  - `expansions`: author_id, attachments.media_keys
  - `user.fields`: profile_image_url, verified, name, username
  - `media.fields`: url, preview_image_url, type, width, height
- Returns normalized dict matching model fields
- Handles: deleted tweets, suspended accounts, rate limiting (429)

### Modified: `POST /api/tweets`

New flow:
1. Extension POSTs `{tweet_id, feed_source, thread_id, thread_position}`
2. Backend checks duplicate (existing)
3. Backend calls X API with tweet_id
4. Merges API data + extension context fields
5. Stores to DB, returns TweetOut

If X API fails, returns error (no partial save).

### Modified: `TweetSave` schema

Extension payload simplified to: `tweet_id`, `feed_source`, `thread_id`, `thread_position`, `topic_id`, `category_id`

Removed from extension payload: `text`, `author_handle`, `author_display_name`, `engagement`, `media_urls`, `screenshot_base64`, `url`, `is_quote_tweet`, `is_reply`

## Frontend Changes

### TweetCard.tsx - Native tweet card

Replaces screenshot thumbnail with:
- Author row: avatar (rounded), display name, @handle, verified badge
- Tweet text: truncated on card, full in detail view
- Media: inline images/video thumbnails
- Engagement row (toggleable): likes, retweets, replies with icons
- Timestamp: posted date

Falls back to screenshot display for old tweets without API data.

### Engagement toggle

- Global toggle in DateBar or settings area
- Stored in localStorage
- Shows/hides engagement stats on all cards and detail modal
- Download captures respect current toggle state

### Download button

- Uses `html-to-image` library
- Available on hover and in detail modal
- Captures rendered card as PNG

### TweetDetailModal.tsx

- Full-size native card (no screenshot for new tweets)
- Crop tool retained, works on rendered HTML card
- Download button prominent
- Engagement toggle applies

### Removed

- Screenshot image loading for new tweets
- Screenshot fallback/placeholder logic (except for old tweets)

## Extension Changes

### Simplified content.js

Only extracts:
- `tweet_id` (from link href)
- `feed_source` (from URL context)
- `thread_id` (from page URL)
- `thread_position` (from DOM position)

No longer parses: text, author info, engagement, media URLs from DOM.

### Simplified background.js

- No `captureVisibleTab()` or OffscreenCanvas cropping
- Forwards minimal payload to backend

### Popup unchanged

Backend URL config, connection status, daily count.

## Migration

- Alembic migration adds: `author_avatar_url`, `author_verified`, `created_at`
- `screenshot_path` kept as nullable
- Existing tweets display via screenshot fallback
- Optional future: admin "re-fetch" to backfill existing tweets with API data

## Dependencies

- Backend: `httpx` (likely already installed for async HTTP)
- Frontend: `html-to-image` (new npm package)
