# Tweet Card Redesign Design

## Problem

Tweet cards use a custom purple dark theme that doesn't feel familiar. Cards are left-aligned instead of centered. Quoted tweets render as bare links instead of embedded cards.

## Solution

Three changes:

### 1. X.com Dark Theme with TBPN Green Accent

Rebrand `design-system.css` to match X.com's dark mode palette, replacing the purple accent with TBPN emerald green (`#00a67d`).

Color mapping:
- `--bg-base`: `#000000` (pure black, like X.com)
- `--bg-raised`: `#16181c`
- `--bg-elevated`: `#1d1f23`
- `--bg-hover`: `#1d1f23`
- `--border`: `#2f3336`
- `--border-strong`: `#536471`
- `--text-primary`: `#e7e9ea`
- `--text-secondary`: `#71767b`
- `--text-tertiary`: `#536471`
- `--accent`: `#00a67d` (TBPN emerald green)
- `--accent-hover`: `#00c896`
- `--accent-muted`: `rgba(0,166,125,0.12)`

### 2. Center Tweet Cards

Add `margin: '0 auto'` to the TweetCard wrapper so cards center within their feed container (already has `maxWidth: 600`).

### 3. Quoted Tweet Embeds

When a tweet has `quoted_tweet_id`, render an embedded quoted tweet card below the text using `react-tweet`'s `<Tweet />` component.

Changes:
- Backend: expose `quoted_tweet_id` in `TweetOut` schema
- Frontend: add `quoted_tweet_id` to `Tweet` type, render `<Tweet id={quoted_tweet_id} />` inside NativeCard

## Files Changed

- `frontend/src/styles/design-system.css` — color token rebrand
- `frontend/src/components/TweetCard.tsx` — centering + quoted tweet embed
- `frontend/src/api/tweets.ts` — add quoted_tweet_id to Tweet type
- `backend/app/schemas/tweet.py` — add quoted_tweet_id to TweetOut
