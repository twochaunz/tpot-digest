# Email Image Proxy Design

## Problem

Digest emails sent via Resend have broken images:
- **Profile avatars** (from `pbs.twimg.com`) — Gmail and other email clients proxy images through their own CDN (e.g., Google Image Proxy). Twitter's CDN blocks or rejects these proxy requests, resulting in broken avatar images.
- **X logo** (`x-logo.svg`) — Most email clients (Gmail, Outlook, Yahoo) do not support SVG images.

## Solution

### 1. X Logo: SVG → PNG

Convert `frontend/public/x-logo.svg` to `x-logo.png`. Update the email template (`digest_email.html`) to reference the PNG version.

### 2. Avatar Proxy

Rewrite avatar URLs at email build time to go through the existing `/api/image-proxy` endpoint on `abridged.tech`.

- In `_build_tweet_dict()`, rewrite `author_avatar_url` from `pbs.twimg.com/...` to `https://abridged.tech/api/image-proxy?url={url_encoded_avatar_url}`
- Same rewriting for quoted tweet avatar URLs
- When the email client requests the image, our server fetches from Twitter CDN and serves it

### 3. Disk Caching for Image Proxy

Add disk caching to `/api/image-proxy` so repeated requests (multiple subscribers opening the same email) don't re-fetch from Twitter:
- Cache images to `DATA_DIR/image-cache/` keyed by URL hash
- Serve from cache if exists and not expired (24h TTL)
- Fall back to live fetch if cache miss

## Files Changed

- `frontend/public/x-logo.png` — new PNG version of X logo
- `backend/app/templates/digest_email.html` — reference PNG instead of SVG
- `backend/app/routers/digest.py` — rewrite avatar URLs in `_build_tweet_dict`
- `backend/app/main.py` — add disk caching to `/api/image-proxy`
