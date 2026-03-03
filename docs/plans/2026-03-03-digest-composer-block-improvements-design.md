# Digest Composer: Block Improvements Design

## Date: 2026-03-03

## Context

The block-based digest composer shipped but has several UX issues:
- Topic blocks only show a title + note textarea — no visibility into which tweets will be included
- No way to add individual tweets (only whole topics)
- Topic picker dropdown is clipped by `overflow: hidden` on the parent container
- Email preview is hidden behind a toggle button instead of always visible
- Per-topic note textarea is redundant with text blocks

## Changes

### Block types (3 total)

- **Text block**: monospace textarea (unchanged)
- **Topic block**: topic title header with color dot + tweet count, plus all assigned tweets rendered as compact inline cards (author handle + truncated text). No note textarea.
- **Tweet block** (new): a single tweet stored with `tweet_id` (DB integer id). Displayed as a compact tweet card in the composer. When rendered in the email, fetched the same way topic tweets are.

### 1. Topic block rendering

Replace color badge + note textarea with:
- Topic title header with color dot + tweet count
- All assigned tweets rendered as compact read-only cards (avatar + author + truncated text)

### 2. Remove `note` field

Drop from DigestBlock schema and frontend type. Text blocks serve the same purpose.

### 3. New tweet block type

`{ type: 'tweet', tweet_id: number }`. The "+ Tweet" button opens a picker grouped by topic (collapsible sections, each showing its tweets). Only tweets from the selected date's day bundle are shown.

### 4. Fix topic picker overflow

Remove `overflow: hidden` from the Content Blocks card so dropdown escapes the container.

### 5. Preview always visible

Remove the toggle. Always show the email preview iframe below the content blocks section when a draft exists.

### Backend changes

- In `_build_digest_content`, handle `type: 'tweet'` blocks — fetch the single tweet by DB id and render it as a standalone tweet card (same dict shape as topic tweets)
- No migration needed — `content_blocks` is JSONB, adding a new block type is additive
- Remove `note` from DigestBlock schema

### Data model

```
DigestBlock:
  type: 'text' | 'topic' | 'tweet'
  content?: string       # text blocks
  topic_id?: number      # topic blocks
  tweet_id?: number      # tweet blocks (DB integer id)
```
