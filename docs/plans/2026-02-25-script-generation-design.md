# Script Generation Pipeline — Design Document

## Overview

Transform the dashboard from a doom-scroll of categorized tweets into a narrative reading experience. Each topic gets an AI-generated script with tweets embedded inline as evidence at the right moments. Users can generate per-topic or batch for a full day, iterate with feedback, and choose which AI model to use.

## Data Model

### New table: `topic_scripts`

| Column | Type | Description |
|--------|------|-------------|
| `id` | int PK | Auto-increment |
| `topic_id` | FK → topics | One topic, many script versions |
| `version` | int | Auto-incrementing per topic (1, 2, 3...) |
| `model_used` | string | e.g. `grok-4-1-fast-reasoning`, `claude-opus-4-6` |
| `content` | JSONB | Array of blocks (see below) |
| `feedback` | text, nullable | User feedback that produced this version (null for v1) |
| `is_active` | bool | Which version is currently displayed |
| `created_at` | timestamp | When generated |

### Script content block format

```json
[
  {"type": "text", "text": "SpaceX acquired xAI, merging the two companies into a single entity valued at $1.25 trillion, split roughly 80/20 between SpaceX and xAI."},
  {"type": "tweet", "tweet_id": "1234567890"},
  {"type": "text", "text": "The announcement sparked excitement across X, with many citing the Kardashev scale as a framework for why this merger makes sense."},
  {"type": "tweet", "tweet_id": "9876543210"},
  {"type": "tweet", "tweet_id": "5555555555"}
]

```

Text blocks are natural prose — clear, accessible, unbiased. Not artificially short-lined. Tweet blocks render as inline TweetCards.

### Versioning

Each regeneration creates a new row. Only one row per topic has `is_active = true`. Previous versions preserved for history. Regeneration prompt includes previous version's content + user feedback.

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|------------|
| `POST /api/topics/{id}/script/generate` | POST | Generate/regenerate script for a topic |
| `GET /api/topics/{id}/script` | GET | Get the active script for a topic |
| `GET /api/topics/{id}/script/versions` | GET | List all versions for a topic |
| `POST /api/dates/{date}/script/generate` | POST | Batch generate scripts for all topics on a date |
| `GET /api/dates/{date}/script` | GET | Get stitched full-day script |

### Generate request body

```json
{
  "model": "grok-4-1-fast-reasoning",
  "feedback": "make the opening punchier",
  "fetch_grok_context": true
}
```

- `model` — user's choice per generation
- `feedback` — null for first gen, string for iterations
- `fetch_grok_context` — batch-fetch Grok context for tweets missing it before generating

## Prompt Architecture

### 1. Grok Context Prompt (per tweet, upgraded)

Replaces the current generic one-liner. Passes the tweet URL so Grok taps into X's native data (replies, quote tweets, sentiment, sarcasm, full conversation tree):

```
Explain this X post: {tweet_url}

- Include relevant context, backstory, and discourse happening around this post
- Cover sentiment: how are people reacting? Any sarcasm, ratio, pushback?
- Note any parent tweet/thread context if this is a reply or quote tweet
- Who are the key figures involved and why does that matter?
- Keep it concise — bullet points, no fluff
```

Results cached in `tweet.grok_context`. Uses `grok-4-1-fast-reasoning`.

### 2. Script Generation Prompt (per topic)

```
You are writing a narrative summary of a tech discourse topic for a daily digest.

STYLE GUIDE:
- Present discourse objectively — show what different sides said without editorializing
- Simplify complex topics so a general audience can follow
- Reference specific people/entities when they're central to the story
- Let the tweets do the heavy lifting for opinions — the script sets up context, tweets show the proof
- Conversational but informative — not academic, not meme-speak
- Natural prose, full sentences, clear and accessible
{user-editable style guide from settings}

TOPIC: {topic_title}
OG POST: {og_tweet text + url + grok_context}

TWEETS IN THIS TOPIC (grouped by category):
[For each tweet]:
- Category: {context/signal-boost/pushback/hot-take/kek}
- Author: @{handle}
- Text: {tweet text}
- Grok Context: {grok_context}
- Tweet ID: {tweet_id}

{if previous version exists}
PREVIOUS SCRIPT VERSION:
{previous script content}

USER FEEDBACK:
{feedback}
{endif}

Return a JSON array of blocks. Each block is either:
- {"type": "text", "text": "narrative prose"}
- {"type": "tweet", "tweet_id": "123456"}

Place tweets at moments where they serve as evidence for what the script is saying.
Use the category ordering to shape narrative flow: context → kek → signal-boost → pushback → hot-take.
Only reference tweet_ids from the list above.
```

Style guide is editable via settings.

## Supported Models

| Model ID | Provider | Use Case |
|----------|----------|----------|
| `grok-4-1-fast-reasoning` | xAI | Context fetch + generation (X-native context) |
| `grok-4-1-fast-non-reasoning` | xAI | Faster/cheaper generation |
| `grok-3` | xAI | Legacy, still available |
| `claude-opus-4-6` | Anthropic | Strong narrative writing |
| `claude-sonnet-4-6` | Anthropic | Cheaper iteration |

Default: `grok-4-1-fast-reasoning`. User chooses per generation.

Requires `ANTHROPIC_API_KEY` env var alongside existing `XAI_API_KEY`.

## Frontend UX

### Topic section: two modes

- **Edit mode** (current): drag-and-drop tweets, categorize, set OG
- **Script mode** (new): generated narrative with inline tweet cards

Toggle via button in topic header. Script mode available once a script exists.

### Script mode view

- Script text rendered as natural prose with breathing room
- Tweet blocks rendered as compact TweetCards inline
- Bottom bar: model selector dropdown, feedback text input, [Regenerate] button
- Version indicator: "v3 · grok-4-1 · 2 min ago"

### Generate button (no script yet)

- Centered CTA: model selector + [Generate Script]
- Progress indicator during generation

### Full-day generation

- Button in day header: [Generate All Scripts]
- Processes topics sequentially with progress ("Generating 2/5...")
- All topics flip to script mode when done

### Feedback flow

1. Read script in script mode
2. Type feedback in input
3. Hit Regenerate → new version replaces view
4. Previous version preserved in DB

## Settings additions

New section in SettingsPage:

- **Style guide**: editable textarea for voice/tone instructions injected into generation prompt
- **Grok context prompt**: editable textarea for per-tweet context prompt
- **Default model**: dropdown for pre-selected model
- **Auto-fetch Grok context**: toggle (default true)

## End-to-End Flow

### Single topic generation

1. User clicks [Generate Script] on a topic
2. Frontend sends `POST /api/topics/{id}/script/generate`
3. Backend loads topic + all assigned tweets with categories + OG tweet
4. For each tweet missing `grok_context`: call Grok with tweet URL, cache result
5. Build generation prompt (style guide + topic + tweets + grok contexts)
6. Call chosen model → parse JSON blocks
7. Validate all tweet_ids exist in the topic
8. Store in `topic_scripts` (new version, `is_active = true`)
9. Return script → frontend switches to script mode

### Regeneration with feedback

1. User types feedback, hits Regenerate
2. Backend loads previous active script
3. Builds prompt with previous script + feedback appended
4. Calls model → stores as next version
5. Frontend updates

### Full day batch

1. User clicks [Generate All Scripts]
2. Backend loads all topics for date in order
3. Runs single topic flow for each sequentially
4. Returns all scripts → frontend flips all topics to script mode
