# OG Post + Grok Context Design

## Overview

Two related features for topic sections:

1. **OG Post**: Designate one tweet per topic as the "original" reference post. It pins to the top of the topic with a visual indicator, serving as the tweet all others in the topic are reacting to / discussing.
2. **Grok Context**: Auto-fetch an AI breakdown of the OG tweet via the xAI/Grok API. Displayed inside the OG tweet card below a divider.

## Data Model

### topics table

Add column:
- `og_tweet_id INTEGER REFERENCES tweets(id) ON DELETE SET NULL` — nullable FK

No new tables. The OG tweet must be assigned to the topic (has a row in `tweet_assignments`).

### tweets table

Existing column used:
- `grok_context TEXT` — already exists. Stores the Grok API response as plain text or markdown.

## API Changes

### Topics

**`TopicUpdate` schema** — add optional `og_tweet_id: int | None` field.

**`TopicOut` schema** — include `og_tweet_id` in response.

**`PATCH /api/topics/{id}`** — when `og_tweet_id` is set:
- Validate the tweet exists and is assigned to this topic
- If not assigned, auto-assign it
- Update the column
- If the tweet's `grok_context` is empty, trigger a Grok API fetch in the background

Setting `og_tweet_id` to `null` clears the OG designation.

### Grok Context

**`POST /api/tweets/{id}/grok-context`** — new endpoint:
- Calls xAI API with prompt: "I want you to give me context about this tweet: {tweet_url}"
- Stores response in `tweets.grok_context`
- Returns `{ grok_context: string }`
- Idempotent — can be called multiple times to refresh

### Extension

Existing assign flow gets an `is_og` boolean. When true:
- After assigning the tweet to a topic, calls `PATCH /api/topics/{id}` with `og_tweet_id`
- If topic already has an OG tweet, extension shows warning: "This topic already has an OG post. Replace it?"

## Backend Service

### grok_api.py

New service alongside `x_api.py`:
- Uses xAI API (Grok) with `GROK_API_KEY` env var
- Single function: `fetch_grok_context(tweet_url: str) -> str`
- Prompt: "I want you to give me context about this tweet: {tweet_url}"
- Returns the Grok response text

### Environment Variable

| Variable | Required | Description |
|---|---|---|
| `GROK_API_KEY` | Yes (for Grok feature) | xAI API key for Grok context fetching |

## Frontend

### Topic Section Layout (with OG)

1. **Topic header** — unchanged (title, count, collapse toggle)
2. **OG Tweet Card** (if topic has `og_tweet_id`):
   - Uses existing tweet card component with modifications
   - Gold/amber left border (`#F59E0B`)
   - "OG" badge/chip in top-right corner
   - Below tweet content: horizontal divider line
   - Below divider: Grok context rendered as formatted text
   - Small refresh icon button to re-fetch Grok context
   - Not draggable, always pinned at top
3. **Category groups + remaining tweets** — unchanged, OG tweet excluded from normal feed to avoid duplication

### OG Designation (Dashboard)

Two methods:
1. **Context menu**: Right-click tweet in topic → "Set as OG Post"
2. **Pin icon on card**: Small icon on each tweet card within a topic. Click to toggle OG. Only one active per topic.

### OG Designation (Extension)

- "OG" toggle/checkbox in the action card, below topic selector
- Only enabled when a topic is selected
- Shows warning if topic already has an OG post

### Grok Context Display

- Rendered inside the OG tweet card, below a thin horizontal divider
- Label: "Grok Context" with a refresh button (circular arrow icon)
- Text formatted as markdown
- Loading state: spinner + "Fetching context..." while API call is in progress
- Empty state: "No context yet" with a "Fetch" button

## Migration

Alembic migration to add `og_tweet_id` column to `topics` table. The `grok_context` column on `tweets` already exists.
