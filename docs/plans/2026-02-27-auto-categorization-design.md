# Auto-Categorization Pipeline Design

## Goal

Automatically classify saved tweets into topics and discourse categories using a two-stage AI pipeline (Grok context + Claude classification) with vector similarity for fast topic matching. User retains final control via suggestion badges with accept/dismiss.

## Architecture

When a tweet is saved via the Chrome extension, a background pipeline runs:

1. **Embed** the tweet text locally (all-MiniLM-L6-v2, ~10ms)
2. **In parallel:** fetch Grok context via x_search (~3-5s) AND run pgvector similarity search against topic embeddings (~5ms)
3. **Claude Haiku** receives the tweet + Grok context + top 5 candidate topics (lightweight payloads) and returns a structured suggestion: topic, category, cross-day link, confidence
4. **Store** the suggestion on the tweet row
5. **Dashboard** shows unsorted tweets with suggestion badges; user accepts or dismisses

Total wall time: ~5-7s per tweet, dominated by Grok. Runs async in background — user doesn't wait.

## Data Model Changes

### Topics table additions

```
embedding vector(384)    -- all-MiniLM-L6-v2, generated when OG post is set
```

Embedding source: `title + " " + og_tweet_text + " " + grok_context`. Re-embedded only when OG post or its Grok context changes.

### Tweets table additions

```
embedding vector(384)           -- generated at save time
ai_topic_id int | null          -- suggested topic (FK topics.id)
ai_category str | null          -- suggested category key
ai_related_topic_id int | null  -- cross-day related topic (FK topics.id)
ai_override bool default false  -- true = user manually set category, skip re-categorization
```

### pgvector

Add `pgvector` extension to PostgreSQL. IVFFlat index on `topics.embedding`:

```sql
CREATE INDEX idx_topics_embedding ON topics
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);
```

## Classification Pipeline

### On tweet save (background task)

```
Step 1: embed_text(tweet.text)                           ~10ms, local CPU
Step 2a: fetch_grok_context(tweet.url)                   ~3-5s, parallel
Step 2b: pgvector top 5 topics (last 3 days, sim > 0.7)  ~5ms, parallel (after step 1)
Step 3: claude_classify(tweet, grok_context, candidates)  ~1-2s
Step 4: store ai_topic_id, ai_category, ai_related_topic_id on tweet
```

Steps 2a and 2b run in parallel. Step 3 waits for both.

### Claude classification prompt

Claude receives:

- Tweet text + Grok context
- Top 5 candidate topics, each with:
  - Title
  - OG post text (truncated 280 chars)
  - OG post Grok context
  - Category summary (e.g. "3 context, 2 pushback, 1 kek")
- Category definitions with descriptions:
  - **context** — adds background, explains, provides data
  - **signal-boost** — amplifies, agrees with the OG post
  - **pushback** — disagrees, challenges, counters
  - **hot-take** — strong or provocative opinion
  - **kek** — humor, memes, jokes about it

Claude returns structured JSON:

```json
{
  "topic_id": 42,
  "new_topic_title": null,
  "category": "pushback",
  "related_topic_id": 38,
  "confidence": 0.85
}
```

- `topic_id` — existing topic match (null if no match)
- `new_topic_title` — suggested new topic name (null if matched existing)
- `category` — one of the 5 category keys
- `related_topic_id` — cross-day related topic (null if none)
- `confidence` — 0-1 score

### On suggestion accepted (re-categorization)

When user accepts a suggestion and tweet moves into a topic:

1. Load OG post + all tweets in the topic (with Grok contexts)
2. Claude re-categorizes all tweets relative to the OG post
3. Skip tweets where `ai_override = true`
4. Update `category` on `tweet_assignments` for changed tweets

This ensures categories stay coherent as the topic grows. Each new tweet changes the context — what was "hot take" with 2 tweets might be "pushback" with 5.

## Cross-Day Topic Matching

- pgvector search spans the last 3 days of topics
- A tweet saved on 2/26 can be suggested for a 2/24 topic if it's the best match
- The tweet's `saved_at` date doesn't change — it appears on the topic's date page
- `ai_related_topic_id` surfaces cross-day connections in the UI

Use case: a single late reaction to yesterday's story gets appended to yesterday's topic rather than creating a new topic today for one tweet.

## Frontend: Suggestion Badges

Unsorted tweets with AI suggestions show a clickable badge:

```
┌─────────────────────────────────────────┐
│ @user: "This is a terrible take..."     │
│                                         │
│   [→ Sam Altman GPT-5 Drama · Pushback] │  ← click to accept
│   [✕]                                    │  ← dismiss
└─────────────────────────────────────────┘
```

- Badge text: topic title + category + date (if cross-day)
- Cross-day example: `[→ Sam Altman GPT-5 Drama (2/24) · Pushback]`
- Click badge → accepts: assigns tweet to topic with category, triggers re-categorization
- Click ✕ → dismisses: clears `ai_topic_id` and `ai_category`, tweet stays unsorted
- Right-click → existing context menu for manual assignment

## Backend Architecture

### New service: `backend/app/services/classifier.py`

- Loads `all-MiniLM-L6-v2` at startup (~50MB RAM), stays warm
- `embed_text(text: str) -> list[float]` — generates 384-dim embedding
- `classify_tweet(tweet_id: int) -> Suggestion` — full pipeline (embed, grok, pgvector, claude)
- `recategorize_topic(topic_id: int) -> dict[int, str]` — re-evaluates all tweets in topic

### New service: `backend/app/services/claude_api.py`

- Anthropic SDK client for Claude Haiku calls
- `classify(tweet_text, grok_context, candidates, categories) -> dict` — structured JSON response
- `recategorize(og_post, tweets, categories) -> dict[int, str]` — bulk re-categorization

### Background task integration

```python
@router.post("/tweets")
async def save_tweet(..., background_tasks: BackgroundTasks):
    tweet = ...  # save tweet to DB
    background_tasks.add_task(classify_pipeline, tweet.id)
    return tweet
```

No Celery/Redis needed — FastAPI BackgroundTasks is sufficient at this scale.

### New API endpoints

- `POST /api/tweets/{id}/accept-suggestion` — accepts AI suggestion, assigns tweet to topic with category, triggers re-categorization
- `POST /api/tweets/{id}/dismiss-suggestion` — clears AI suggestion fields

### Topic embedding generation

Triggered in `PATCH /api/topics/{id}` when `og_tweet_id` is set or changed. Embeds `title + og_tweet_text + grok_context`. Stored in `topics.embedding`.

## Performance

| Operation | Latency | Notes |
|-----------|---------|-------|
| Tweet embedding | ~10ms | Local CPU, model warm in memory |
| pgvector search | ~5ms | IVFFlat index, ~100s of topics |
| Grok x_search | ~3-5s | External API, runs in parallel |
| Claude Haiku | ~1-2s | Small payload (top 5 candidates, summaries only) |
| Total pipeline | ~5-7s | Async background, user doesn't wait |
| Re-categorization | ~2-3s | Only on accept, small payload |

**Payload optimization for Claude:**
- Topic candidates include title + OG text (280 char max) + category summary — not every tweet's full text
- Re-categorization sends OG post + tweet texts (tweet-length, naturally short)

**No N+1 queries:**
- AI suggestion fields ride the existing `TweetOut` schema — day bundle endpoint returns them for free
- Embedding generation is a single DB write alongside existing tweet/topic saves

## Dependencies

### Backend

- `sentence-transformers` — loads all-MiniLM-L6-v2
- `torch` (CPU only) — required by sentence-transformers
- `anthropic` — Anthropic SDK for Claude Haiku
- `pgvector` — Python pgvector bindings for SQLAlchemy

### Infrastructure

- PostgreSQL: add `CREATE EXTENSION vector` via Alembic migration
- Docker: backend image grows ~200MB for torch CPU + model weights

### Environment variables

- `ANTHROPIC_API_KEY` — required for Claude classification
