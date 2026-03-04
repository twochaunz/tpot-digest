# Digest Composer Block Restructure

**Date**: 2026-03-04

## Problem

The current digest composer has a monolithic "topic" block type that bundles the topic header, AI summary, all tweets, and category transitions into one unit. This prevents granular editing — you can't reorder individual tweets, edit AI-generated text, or remove specific pieces. Additionally:
- The X outlink uses text "X ↗" instead of the actual X logo
- All tweets show when a topic is selected — no per-tweet toggle
- Dividers appear after topic titles instead of before them
- The "topic" block type is an opaque container, not composable

## Design

### 1. Block Architecture

Replace the monolithic `topic` block with a flat list of independently movable blocks.

**New block type `topic-header`** replaces `topic`:
- Renders as numbered heading with topic color dot (e.g., "1. Topic Title")
- Clicking opens a side panel showing all tweets in the topic, grouped by category, with checkboxes
- Toggling a tweet on inserts a tweet block after the topic's section; toggling off removes it
- In the email, renders as `<h2>` with auto-numbering based on order of topic-header blocks

**Block types**:
- `topic-header` — topic title, clickable to manage tweet selection
- `text` — markdown content (used for AI summaries, transitions, intro, custom text)
- `tweet` — single compact tweet card (composer: compact; preview: full styled card)
- `divider` — horizontal rule

**Schema**:
```typescript
DigestBlock {
  id: string
  type: 'text' | 'topic-header' | 'tweet' | 'divider'
  content?: string | null       // text blocks
  topic_id?: number | null      // topic-header blocks
  tweet_id?: number | null      // tweet blocks (DB integer id)
  show_engagement?: boolean     // tweet blocks
}
```

The `tweet_overrides` field is removed — engagement is now per tweet block via `show_engagement`.

### 2. Template Generation

**Topic selector modal**: Shows all topics for the date. "Top 3" quick button. Kek tweets auto-checked by default.

**On confirm**, frontend calls `POST /api/digest/generate-template` with `{ date, topic_ids }`. Backend returns AI-generated text (summaries + category transitions per topic). Frontend assembles blocks:

```
[text: "N topics from [DATE] tech discourse"]
[divider]                                    ← before first topic
[topic-header: Topic 1]
[text: AI summary]
[tweet] [tweet]                              ← og post tweets
[text: "some pushback on..."]                ← AI transition
[tweet] [tweet]                              ← pushback tweets
[divider]                                    ← before second topic
[topic-header: Topic 2]
[text: AI summary]
[tweet]
[divider]
[text: "**More on the timeline**\n- links"]  ← if unselected topics exist
[divider]
[text: "kek moments of the day"]             ← kek section title
[tweet] [tweet]                              ← kek tweets from all topics
```

No "Until next time" outro.

**Kek handling**: Kek tweets from all selected topics are collected into a separate section at the bottom with "kek moments of the day" as a text block title, not a topic-header.

### 3. Backend Changes

**New endpoint**: `POST /api/digest/generate-template`
- Input: `{ date: string, topic_ids: number[] }`
- For each topic: fetch tweets with categories and grok_context, generate AI summary and category transitions
- Returns: `{ topics: [{ topic_id, summary, category_groups: [{ category, transition, tweet_ids }] }] }`
- Frontend uses this to assemble the block list

**Simplified `_build_digest_content`**: No more AI generation at render time. Reads blocks as-is:
- `topic-header` → fetches topic title, assigns number based on block order
- `text` → markdown → HTML (unchanged)
- `tweet` → fetches tweet + quoted tweet (unchanged)
- `divider` → passthrough

### 4. Composer UX

**Topic header click** → opens panel:
- All tweets in the topic grouped by category (og post, echo, context, pushback, etc.)
- Each tweet has checkbox + compact preview
- Category name as group header
- Checking inserts tweet block after last block in that topic's section
- Unchecking removes the tweet block from the draft

**Compact tweet blocks** in composer:
- Author handle + truncated text
- Drag handle + delete button (same as other blocks)
- Expandable on click for full text

**Preview** renders full styled tweet cards as they appear in the email.

### 5. Email Template

**X logo**: Replace text "X ↗" with `<img src="https://abridged.tech/x-logo.svg" width="12" height="12">` + "↗" text. SVG hosted on our server.

**Topic numbering**: Auto-numbered from order of `topic-header` blocks in the draft.

**No category grouping in template**: Since tweets are now individual blocks in whatever order the user arranged them, the email renders them sequentially. Category transitions are just text blocks rendered as styled paragraphs.

### 6. Files to Modify

**Frontend:**
- `frontend/src/pages/DigestComposer.tsx` — replace topic block rendering, add topic-header block type, tweet selector panel, update template generation
- `frontend/src/api/digest.ts` — update `DigestBlock` type, add `generateTemplate` API call

**Backend:**
- `backend/app/routers/digest.py` — add `generate-template` endpoint, simplify `_build_digest_content`
- `backend/app/templates/digest_email.html` — add `topic-header` rendering, X logo image
- `backend/app/schemas/digest.py` — update block type enum
