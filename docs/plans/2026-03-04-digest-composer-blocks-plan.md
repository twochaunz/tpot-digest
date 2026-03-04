# Digest Composer Block Restructure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace monolithic topic blocks with flat, independently movable blocks — topic headers, individual tweets, text blocks for AI summaries/transitions — with a backend endpoint for AI content generation at template creation time.

**Architecture:** The `topic` block type is replaced by `topic-header` (a lightweight heading that opens a tweet selector panel on click). Template generation calls a new backend endpoint `POST /api/digest/generate-template` that returns AI summaries and category transitions, which the frontend assembles into individual editable text and tweet blocks. `_build_digest_content` is simplified to just render blocks as-is without AI generation.

**Tech Stack:** Python/FastAPI, Claude Haiku (anthropic SDK), Jinja2, React/TypeScript, TanStack Query, @dnd-kit

---

### Task 1: Backend Schema + Generate-Template Endpoint

**Files:**
- Modify: `backend/app/schemas/digest.py`
- Modify: `backend/app/routers/digest.py`

**Context:** The `DigestBlock` schema currently has `type: 'text' | 'topic' | 'tweet' | 'divider'` with `tweet_overrides` for per-tweet engagement. We need to replace `topic` with `topic-header`, remove `tweet_overrides`, and add a new endpoint that generates AI content for template assembly.

**Step 1: Update DigestBlock schema**

In `backend/app/schemas/digest.py`, update `DigestBlock`:
```python
class DigestBlock(BaseModel):
    id: str
    type: str  # 'text' | 'topic-header' | 'tweet' | 'divider'
    content: str | None = None
    topic_id: int | None = None    # for topic-header blocks
    tweet_id: int | None = None    # for tweet blocks
    show_engagement: bool = False  # for tweet blocks
```

Remove the `tweet_overrides` field entirely.

**Step 2: Add generate-template endpoint**

In `backend/app/routers/digest.py`, add a new Pydantic model and endpoint. Add this import at the top:

```python
from pydantic import BaseModel as PydanticBaseModel
```

Add the request model after the router definition:

```python
class GenerateTemplateRequest(PydanticBaseModel):
    date: str  # ISO date string
    topic_ids: list[int]
```

Add the endpoint (before the CRUD endpoints):

```python
@router.post("/generate-template")
async def generate_template(body: GenerateTemplateRequest, db: AsyncSession = Depends(get_db)):
    """Generate AI content (summaries + transitions) for template assembly."""
    result_topics = []

    for topic_id in body.topic_ids:
        topic = await db.get(Topic, topic_id)
        if not topic:
            continue

        # Fetch tweets with categories
        stmt = (
            select(Tweet, TweetAssignment.category)
            .join(TweetAssignment, TweetAssignment.tweet_id == Tweet.id)
            .where(TweetAssignment.topic_id == topic_id)
            .order_by(Tweet.saved_at)
        )
        rows = await db.execute(stmt)
        tweet_rows = rows.all()

        # Collect grok_contexts
        grok_contexts = [tw.grok_context for tw, _ in tweet_rows if tw.grok_context]

        # Group tweets by category
        category_tweets: OrderedDict[str, list[dict]] = OrderedDict()
        for tw, category in tweet_rows:
            cat = category or "og post"
            if cat not in category_tweets:
                category_tweets[cat] = []
            category_tweets[cat].append({
                "tweet_id": tw.id,
                "tweet_ext_id": tw.tweet_id,
                "author_handle": tw.author_handle,
                "text": tw.text[:200],
                "category": cat,
            })

        # Sort categories
        sorted_categories = sorted(
            category_tweets.keys(),
            key=lambda c: CATEGORY_ORDER.index(c) if c in CATEGORY_ORDER else len(CATEGORY_ORDER),
        )

        category_groups = []
        for cat in sorted_categories:
            category_groups.append({
                "category": cat,
                "tweet_ids": [t["tweet_id"] for t in category_tweets[cat]],
            })

        # Generate AI summary
        summary = await _generate_topic_summary(topic.title, grok_contexts)

        # Generate AI transitions
        transition_groups = [{"category": cat, "tweets": category_tweets[cat]} for cat in sorted_categories]
        transitions = await _generate_category_transitions(topic.title, transition_groups)

        result_topics.append({
            "topic_id": topic_id,
            "title": topic.title,
            "summary": summary,
            "category_groups": [
                {**g, "transition": transitions.get(g["category"])}
                for g in category_groups
            ],
        })

    return {"topics": result_topics}
```

**Step 3: Run tests to check nothing broke**

Run: `/Users/wonchankim/Projects/tpot-digest/backend/.venv/bin/python -m pytest backend/tests/ -q --ignore=backend/tests/test_embeddings.py`

Some tests may fail because they use the old `topic` block type — that's expected and will be fixed in Task 5.

**Step 4: Commit**

```bash
git add backend/app/schemas/digest.py backend/app/routers/digest.py
git commit -m "feat(digest): add generate-template endpoint, update schema to topic-header"
```

---

### Task 2: Simplify _build_digest_content + Email Template

**Files:**
- Modify: `backend/app/routers/digest.py` (lines 152-278: `_build_digest_content`)
- Modify: `backend/app/templates/digest_email.html`

**Context:** `_build_digest_content` currently does AI generation at render time for topic blocks. With the new architecture, AI content is pre-generated into text blocks at template creation time. The function now just needs to handle 4 simple block types: `text`, `topic-header`, `tweet`, `divider`. The `topic` type is removed.

**Step 1: Simplify _build_digest_content**

Replace the entire `_build_digest_content` function (currently lines 152-278) with:

```python
async def _build_digest_content(draft: DigestDraft, db: AsyncSession) -> list[dict]:
    """Build list of block dicts for rendering from content_blocks."""
    import markdown as md

    result_blocks = []
    topic_number = 0

    for block in (draft.content_blocks or []):
        block_type = block.get("type")

        if block_type == "text":
            content = block.get("content")
            if content:
                html_content = md.markdown(content, extensions=["extra"])
                result_blocks.append({"type": "text", "content": content, "html": html_content})

        elif block_type == "divider":
            result_blocks.append({"type": "divider"})

        elif block_type == "topic-header":
            topic_id = block.get("topic_id")
            if not topic_id:
                continue
            topic = await db.get(Topic, topic_id)
            if not topic:
                continue
            topic_number += 1
            result_blocks.append({
                "type": "topic-header",
                "title": topic.title,
                "topic_number": topic_number,
            })

        elif block_type == "tweet":
            tweet_id = block.get("tweet_id")
            if not tweet_id:
                continue
            tw = await db.get(Tweet, tweet_id)
            if not tw:
                continue

            show_engagement = block.get("show_engagement", False)
            tweet_block = _build_tweet_dict(tw, show_engagement)

            # Fetch quoted tweet if exists
            if tw.quoted_tweet_id:
                qt_stmt = select(Tweet).where(Tweet.tweet_id == tw.quoted_tweet_id)
                qt_result = await db.execute(qt_stmt)
                quoted = qt_result.scalars().first()
                if quoted:
                    tweet_block["quoted_tweet"] = {
                        "author_handle": quoted.author_handle,
                        "author_display_name": quoted.author_display_name,
                        "author_avatar_url": quoted.author_avatar_url,
                        "text": quoted.text,
                        "url": quoted.url,
                    }

            tweet_block["type"] = "tweet"
            result_blocks.append(tweet_block)

        # Legacy support: old 'topic' blocks still render
        elif block_type == "topic":
            topic_id = block.get("topic_id")
            if not topic_id:
                continue
            topic = await db.get(Topic, topic_id)
            if not topic:
                continue
            topic_number += 1

            stmt = (
                select(Tweet)
                .join(TweetAssignment, TweetAssignment.tweet_id == Tweet.id)
                .where(TweetAssignment.topic_id == topic_id)
                .order_by(Tweet.saved_at)
            )
            rows = await db.execute(stmt)
            tweet_rows = rows.scalars().all()
            tweet_overrides = block.get("tweet_overrides") or {}
            tweet_dicts = []
            for tw in tweet_rows:
                tw_override = tweet_overrides.get(str(tw.id), {})
                show_eng = tw_override.get("show_engagement", False)
                tweet_dicts.append(_build_tweet_dict(tw, show_eng))

            result_blocks.append({
                "type": "topic",
                "title": topic.title,
                "topic_number": topic_number,
                "summary": None,
                "category_groups": [{"category": "og post", "transition": None, "tweets": tweet_dicts}],
            })

    return result_blocks
```

Note: Legacy `topic` block support is kept so existing drafts still render.

**Step 2: Update email template**

Replace `backend/app/templates/digest_email.html` to handle `topic-header` blocks and use x-logo.svg for the X link:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>abridged tech - {{ date_str }}</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;color:#1a1a1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px;">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-size:24px;font-weight:700;margin:0 0 4px 0;color:#1a1a1a;letter-spacing:-0.02em;">abridged tech</h1>
      <p style="font-size:14px;color:#6b7280;margin:0;">{{ date_str }}</p>
    </div>

    {# ---- Tweet card macro ---- #}
    {% macro tweet_card(tweet) %}
    <div style="background:#ffffff;border:1px solid #e1e8ed;border-radius:12px;padding:16px;margin-bottom:10px;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:10px;">
        <tr>
          {% if tweet.author_avatar_url %}
          <td style="vertical-align:top;padding-right:10px;width:48px;">
            <img src="{{ tweet.author_avatar_url }}" alt="" width="48" height="48" style="border-radius:50%;display:block;">
          </td>
          {% endif %}
          <td style="vertical-align:center;">
            <div style="font-weight:700;font-size:15px;color:#0f1419;line-height:1.3;">{{ tweet.author_display_name or tweet.author_handle }}</div>
            <div style="font-size:13px;color:#536471;">@{{ tweet.author_handle }}</div>
          </td>
          {% if tweet.url %}
          <td style="vertical-align:top;text-align:right;width:40px;">
            <a href="{{ tweet.url }}" style="text-decoration:none;display:inline-flex;align-items:center;gap:2px;">
              <img src="https://abridged.tech/x-logo.svg" alt="X" width="12" height="12" style="display:inline-block;vertical-align:middle;">
              <span style="font-size:12px;color:#536471;">&#x2197;</span>
            </a>
          </td>
          {% endif %}
        </tr>
      </table>
      <p style="margin:0 0 12px 0;font-size:15px;line-height:1.5;color:#0f1419;white-space:pre-wrap;">{{ tweet.text }}</p>
      {% if tweet.quoted_tweet %}
      <div style="border:1px solid #e1e8ed;border-radius:12px;padding:12px;margin-bottom:10px;background:#f7f9fa;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:8px;">
          <tr>
            {% if tweet.quoted_tweet.author_avatar_url %}
            <td style="vertical-align:top;padding-right:8px;width:24px;">
              <img src="{{ tweet.quoted_tweet.author_avatar_url }}" alt="" width="24" height="24" style="border-radius:50%;display:block;">
            </td>
            {% endif %}
            <td style="vertical-align:center;">
              <span style="font-weight:700;font-size:13px;color:#0f1419;">{{ tweet.quoted_tweet.author_display_name or tweet.quoted_tweet.author_handle }}</span>
              <span style="font-size:12px;color:#536471;"> @{{ tweet.quoted_tweet.author_handle }}</span>
            </td>
            {% if tweet.quoted_tweet.url %}
            <td style="vertical-align:top;text-align:right;width:32px;">
              <a href="{{ tweet.quoted_tweet.url }}" style="text-decoration:none;">
                <img src="https://abridged.tech/x-logo.svg" alt="X" width="10" height="10" style="display:inline-block;vertical-align:middle;">
                <span style="font-size:11px;color:#536471;">&#x2197;</span>
              </a>
            </td>
            {% endif %}
          </tr>
        </table>
        <p style="margin:0;font-size:14px;line-height:1.4;color:#0f1419;white-space:pre-wrap;">{{ tweet.quoted_tweet.text }}</p>
      </div>
      {% endif %}
      {% if tweet.show_engagement and tweet.engagement %}
      <div style="font-size:13px;color:#536471;margin-bottom:10px;padding-top:8px;border-top:1px solid #e1e8ed;">
        {% if tweet.engagement.replies is not none %}<span style="margin-right:16px;">{{ tweet.engagement.replies }} replies</span>{% endif %}
        {% if tweet.engagement.retweets is not none %}<span style="margin-right:16px;">{{ tweet.engagement.retweets }} reposts</span>{% endif %}
        {% if tweet.engagement.likes is not none %}<span style="margin-right:16px;">{{ tweet.engagement.likes }} likes</span>{% endif %}
      </div>
      {% endif %}
    </div>
    {% endmacro %}

    {% for block in blocks %}
    {% if block.type == 'text' %}
    <div style="margin-bottom:24px;font-size:15px;line-height:1.7;color:#374151;">
      {% if block.html %}{{ block.html }}{% else %}<p>{{ block.content }}</p>{% endif %}
    </div>

    {% elif block.type == 'divider' %}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;">

    {% elif block.type == 'topic-header' %}
    <div style="margin-bottom:8px;">
      <h2 style="font-size:17px;font-weight:700;color:#1a1a1a;margin:0;padding-bottom:4px;">{{ block.topic_number }}. {{ block.title }}</h2>
    </div>

    {% elif block.type == 'topic' %}
    <!-- Legacy topic block -->
    <div style="margin-bottom:28px;">
      <h2 style="font-size:17px;font-weight:700;color:#1a1a1a;margin:0 0 4px 0;padding-bottom:8px;border-bottom:1px solid #e5e7eb;">{{ block.topic_number }}. {{ block.title }}</h2>
      {% if block.summary %}
      <p style="font-size:14px;line-height:1.5;color:#6b7280;margin:4px 0 14px 0;font-style:italic;">{{ block.summary }}</p>
      {% endif %}
      {% for group in block.category_groups %}
      {% if group.transition %}
      <p style="font-size:14px;color:#6b7280;margin:16px 0 8px 0;font-style:italic;">{{ group.transition }}</p>
      {% endif %}
      {% for tweet in group.tweets %}
      {{ tweet_card(tweet) }}
      {% endfor %}
      {% endfor %}
    </div>

    {% elif block.type == 'tweet' %}
    {{ tweet_card(block) }}
    {% endif %}
    {% endfor %}

    <!-- Footer -->
    <div style="text-align:center;padding-top:24px;border-top:1px solid #e5e7eb;">
      <p style="font-size:12px;color:#9ca3af;margin:0;">
        <a href="{{ unsubscribe_url }}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a>
      </p>
    </div>

  </div>
</body>
</html>
```

**Step 3: Remove unused AI functions if no longer needed at render time**

Keep `_generate_topic_summary` and `_generate_category_transitions` — they're now called from the `generate-template` endpoint, not from `_build_digest_content`.

**Step 4: Run tests**

Run: `/Users/wonchankim/Projects/tpot-digest/backend/.venv/bin/python -m pytest backend/tests/ -q --ignore=backend/tests/test_embeddings.py`

**Step 5: Commit**

```bash
git add backend/app/routers/digest.py backend/app/templates/digest_email.html
git commit -m "feat(digest): simplify _build_digest_content, add topic-header to email template"
```

---

### Task 3: Update Backend Tests

**Files:**
- Modify: `backend/tests/test_digest_api.py`
- Modify: `backend/tests/test_subscribers_api.py`

**Context:** Tests use old `topic` block type with `tweet_overrides`. Update to use new `topic-header` and standalone `tweet` blocks. The `test_email_service_renders_template` test in subscribers also needs updating.

**Step 1: Update test_digest_api.py**

Update `test_create_digest_draft` (line 57): change topic block to topic-header:
```python
{"id": "b2", "type": "topic-header", "topic_id": topic_db_id},
```

Update `test_preview_digest` (line 101): Instead of one topic block, use topic-header + tweet blocks:
```python
"content_blocks": [
    {"id": "b1", "type": "text", "content": "Welcome"},
    {"id": "b2", "type": "topic-header", "topic_id": topic_db_id},
    {"id": "b3", "type": "tweet", "tweet_id": tweet_db_id},
],
```
Update assertions: check for topic title in `<h2>` and tweet text/handle separately.

Update `test_preview_divider_block` (line 197): No changes needed (divider unchanged).

Update `test_preview_markdown_text_block` (line 218): No changes needed (text unchanged).

Update `test_preview_tweet_engagement_toggle` (line 236): No changes needed (tweet block unchanged).

Update `test_cannot_edit_sent_draft` (line 279): change topic block to topic-header.

**Step 2: Update test_subscribers_api.py**

Update `test_email_service_renders_template` (line 99): Use new block format:
```python
blocks = [
    {
        "type": "text",
        "content": "Welcome to today's digest",
    },
    {
        "type": "topic-header",
        "title": "AI News",
        "topic_number": 1,
    },
    {
        "type": "tweet",
        "author_handle": "karpathy",
        "author_display_name": "Andrej Karpathy",
        "author_avatar_url": "https://example.com/avatar.jpg",
        "text": "Claude 4 is amazing",
        "url": "https://x.com/karpathy/status/123",
        "show_engagement": False,
    },
]
```
Update assertions to match new structure (topic title in h2, tweet in separate card).

**Step 3: Run tests**

Run: `/Users/wonchankim/Projects/tpot-digest/backend/.venv/bin/python -m pytest backend/tests/ -q --ignore=backend/tests/test_embeddings.py`

Expected: All pass.

**Step 4: Commit**

```bash
git add backend/tests/
git commit -m "test(digest): update tests for topic-header block type"
```

---

### Task 4: Frontend Type + API Updates

**Files:**
- Modify: `frontend/src/api/digest.ts`

**Context:** Update the `DigestBlock` TypeScript interface to match the new backend schema. Add a new API hook for the `generate-template` endpoint.

**Step 1: Update DigestBlock interface**

```typescript
export interface DigestBlock {
  id: string
  type: 'text' | 'topic-header' | 'tweet' | 'divider'
  content?: string | null       // text blocks (supports markdown)
  topic_id?: number | null      // topic-header blocks
  tweet_id?: number | null      // tweet blocks (DB integer id)
  show_engagement?: boolean     // tweet blocks
}
```

Remove `tweet_overrides`.

**Step 2: Add GenerateTemplateResult type**

```typescript
export interface GenerateTemplateResult {
  topics: Array<{
    topic_id: number
    title: string
    summary: string | null
    category_groups: Array<{
      category: string
      tweet_ids: number[]
      transition: string | null
    }>
  }>
}
```

**Step 3: Add useGenerateTemplate hook**

```typescript
export function useGenerateTemplate() {
  return useMutation<GenerateTemplateResult, Error, { date: string; topic_ids: number[] }>({
    mutationFn: async (body) => {
      const { data } = await api.post('/digest/generate-template', body)
      return data
    },
  })
}
```

**Step 4: Run type check**

Run: `cd frontend && npx tsc --noEmit`

Fix any type errors in `DigestComposer.tsx` related to removed `tweet_overrides` or changed `topic` → `topic-header`. At this point, there will be errors because DigestComposer still references the old type — that's expected and fixed in the next task.

**Step 5: Commit**

```bash
git add frontend/src/api/digest.ts
git commit -m "feat(digest): update DigestBlock type, add generate-template API hook"
```

---

### Task 5: Frontend SortableBlock + TweetSelectorPanel

**Files:**
- Modify: `frontend/src/pages/DigestComposer.tsx`

**Context:** This is the main frontend change. Replace the old topic block rendering in SortableBlock with a new `topic-header` block type. Add a TweetSelectorPanel that opens when clicking a topic header, showing tweets grouped by category with checkboxes. Update block management functions.

**Step 1: Add TweetSelectorPanel component**

Add a new component before SortableBlock (around line 93). This is a slide-out panel that shows all tweets in a topic grouped by category with checkboxes:

```typescript
function TweetSelectorPanel({
  topic,
  includedTweetIds,
  onToggleTweet,
  onClose,
}: {
  topic: TopicBundle
  includedTweetIds: Set<number>
  onToggleTweet: (tweetId: number, include: boolean) => void
  onClose: () => void
}) {
  // Group tweets by category from their assignments
  // For each tweet, check if it's in the current block list
  // Show category headers with tweets underneath, each with checkbox

  // Group tweets by their assignment category
  const categoryGroups: Record<string, Tweet[]> = {}
  for (const tw of topic.tweets) {
    // We need category info — get it from the topic's tweet assignments
    // Since TopicBundle.tweets doesn't include category, we'll need to pass it
    // For now, group all under "tweets"
    const cat = (tw as any).category || 'og post'
    if (!categoryGroups[cat]) categoryGroups[cat] = []
    categoryGroups[cat].push(tw)
  }

  const CATEGORY_ORDER = ['og post', 'echo', 'context', 'commentary', 'pushback', 'hot-take', 'callout', 'kek']
  const sortedCategories = Object.keys(categoryGroups).sort(
    (a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a)
      const bi = CATEGORY_ORDER.indexOf(b)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    }
  )

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 400, zIndex: 10001,
      background: 'var(--bg-elevated)', borderLeft: '1px solid var(--border)',
      boxShadow: '-8px 0 24px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
          {topic.title}
        </h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 18, cursor: 'pointer' }}>&times;</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
        {sortedCategories.map(cat => (
          <div key={cat} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              {cat}
            </div>
            {categoryGroups[cat].map(tw => {
              const included = includedTweetIds.has(tw.id)
              return (
                <label key={tw.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={included}
                    onChange={(e) => onToggleTweet(tw.id, e.target.checked)}
                    style={{ marginTop: 3 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <CompactTweet tweet={tw} />
                  </div>
                </label>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
```

**Important:** The `TopicBundle.tweets` array does not include category info. We need the category from `TweetAssignment`. There are two approaches:
1. **Frontend fetches categories from a new endpoint** — adds complexity
2. **Piggyback on existing data** — the tweets have `ai_category` on the Tweet model

Check if the `Tweet` type in `frontend/src/api/tweets.ts` includes category info. If not, we need to add it. The `TweetAssignment` has a `category` field. The `useDayBundle` endpoint returns tweets within topics but doesn't include the assignment category.

**Fallback approach:** Add a category field to the tweet data returned by the day bundle endpoint, OR fetch it from the generate-template response (which already groups by category). Since the generate-template endpoint returns `category_groups` with `tweet_ids`, we can use that data to know each tweet's category.

Store the category mapping from the generate-template response in state and pass it to the TweetSelectorPanel.

**Step 2: Update SortableBlock to handle topic-header**

Replace the `topic` block rendering section (currently lines 219-291) with `topic-header`:

```typescript
} else if (block.type === 'topic-header') {
  const topic = topics.find(t => t.id === block.topic_id)
  if (topic) {
    content = (
      <div
        onClick={() => !isSent && onOpenTweetSelector?.(block.topic_id!)}
        style={{ cursor: isSent ? 'default' : 'pointer', padding: '8px 0' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 10, height: 10, borderRadius: '50%',
            background: topic.color || 'var(--text-tertiary)',
            flexShrink: 0,
          }} />
          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
            {topic.title}
          </span>
          {!isSent && (
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
              click to select tweets
            </span>
          )}
        </div>
      </div>
    )
  } else {
    content = (
      <div style={{ padding: '8px 0', color: 'var(--text-tertiary)', fontSize: 13 }}>
        Topic #{block.topic_id} (not found)
      </div>
    )
  }
```

Add `onOpenTweetSelector` to SortableBlock's props:
```typescript
onOpenTweetSelector?: (topicId: number) => void
```

**Step 3: Remove old topic block rendering**

Remove the entire `topic` block rendering section (lines 219-291 in the old code). Keep only `topic-header`.

**Step 4: Update the main DigestComposer component**

Add state for the tweet selector panel:
```typescript
const [tweetSelectorTopicId, setTweetSelectorTopicId] = useState<number | null>(null)
```

Add a `categoryMap` state to store category info from generate-template:
```typescript
const [categoryMap, setCategoryMap] = useState<Record<number, string>>({})
```

Pass `onOpenTweetSelector` to SortableBlock:
```typescript
onOpenTweetSelector={setTweetSelectorTopicId}
```

Add TweetSelectorPanel rendering:
```typescript
{tweetSelectorTopicId && (() => {
  const topic = topics.find(t => t.id === tweetSelectorTopicId)
  if (!topic) return null
  const includedTweetIds = new Set(
    blocks
      .filter(b => b.type === 'tweet' && topic.tweets.some(t => t.id === b.tweet_id))
      .map(b => b.tweet_id!)
  )
  return (
    <TweetSelectorPanel
      topic={topic}
      includedTweetIds={includedTweetIds}
      onToggleTweet={(tweetId, include) => {
        if (include) {
          // Find the last block that belongs to this topic's section
          // Insert after it
          const topicHeaderIdx = blocks.findIndex(
            b => b.type === 'topic-header' && b.topic_id === tweetSelectorTopicId
          )
          // Find last tweet/text block before next topic-header or divider
          let insertIdx = topicHeaderIdx + 1
          for (let i = topicHeaderIdx + 1; i < blocks.length; i++) {
            if (blocks[i].type === 'topic-header' || blocks[i].type === 'divider') break
            insertIdx = i + 1
          }
          const newBlock: DigestBlock = {
            id: nextBlockId(),
            type: 'tweet',
            tweet_id: tweetId,
          }
          setBlocks(prev => [
            ...prev.slice(0, insertIdx),
            newBlock,
            ...prev.slice(insertIdx),
          ])
          triggerAutoSave()
        } else {
          // Remove the tweet block
          setBlocks(prev => prev.filter(b => !(b.type === 'tweet' && b.tweet_id === tweetId)))
          triggerAutoSave()
        }
      }}
      onClose={() => setTweetSelectorTopicId(null)}
    />
  )
})()}
```

**Step 5: Update addTopicBlock → addTopicHeaderBlock**

Rename and update:
```typescript
const addTopicHeaderBlock = useCallback((topicId: number) => {
  setBlocks((prev) => [...prev, { id: nextBlockId(), type: 'topic-header' as const, topic_id: topicId }])
  triggerAutoSave()
}, [triggerAutoSave])
```

Update the TopicPicker in the toolbar to call `addTopicHeaderBlock` instead of `addTopicBlock`.

**Step 6: Run type check**

Run: `cd frontend && npx tsc --noEmit`

**Step 7: Commit**

```bash
git add frontend/src/pages/DigestComposer.tsx
git commit -m "feat(digest): topic-header blocks with tweet selector panel"
```

---

### Task 6: Frontend Template Generation

**Files:**
- Modify: `frontend/src/pages/DigestComposer.tsx`

**Context:** Update `generateTemplateBlocks` to call the backend `generate-template` endpoint, then assemble flat blocks: dividers, topic-headers, text blocks (summaries/transitions), and individual tweet blocks. Handle kek specially.

**Step 1: Update generateTemplateBlocks to be async**

Replace the current `generateTemplateBlocks` function (lines 982-1029) with an async version that calls the backend:

```typescript
const generateTemplate = useGenerateTemplate()

const generateTemplateBlocks = useCallback(async (selectedIds: Set<number>): Promise<DigestBlock[]> => {
  const sorted = sortTopics(topics)
  const featured = sorted.filter(t => selectedIds.has(t.id))
  const rest = sorted.filter(t => !selectedIds.has(t.id))

  const formattedDate = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })

  // Call backend for AI content
  const templateData = await generateTemplate.mutateAsync({
    date,
    topic_ids: featured.map(t => t.id),
  })

  // Build category map for tweet selector panel
  const newCategoryMap: Record<number, string> = {}
  for (const topicData of templateData.topics) {
    for (const group of topicData.category_groups) {
      for (const tweetId of group.tweet_ids) {
        newCategoryMap[tweetId] = group.category
      }
    }
  }
  setCategoryMap(newCategoryMap)

  const newBlocks: DigestBlock[] = []

  // Intro
  newBlocks.push({
    id: nextBlockId(),
    type: 'text',
    content: `${featured.length} topic${featured.length !== 1 ? 's' : ''} from ${formattedDate} tech discourse`,
  })

  // Collect kek tweets across all topics
  const kekTweets: number[] = []

  let isFirstTopic = true
  for (const topicData of templateData.topics) {
    // Separate kek tweets
    const nonKekGroups = topicData.category_groups.filter(g => g.category !== 'kek')
    const kekGroup = topicData.category_groups.find(g => g.category === 'kek')
    if (kekGroup) {
      kekTweets.push(...kekGroup.tweet_ids)
    }

    // Skip topics that only have kek tweets
    if (nonKekGroups.length === 0) continue

    // Divider before topic (except first)
    if (!isFirstTopic) {
      newBlocks.push({ id: nextBlockId(), type: 'divider' })
    }
    isFirstTopic = false

    // Topic header
    newBlocks.push({ id: nextBlockId(), type: 'topic-header', topic_id: topicData.topic_id })

    // Summary text block
    if (topicData.summary) {
      newBlocks.push({ id: nextBlockId(), type: 'text', content: `*${topicData.summary}*` })
    }

    // Tweet blocks grouped by category
    let isFirstGroup = true
    for (const group of nonKekGroups) {
      // Category transition text
      if (!isFirstGroup && group.transition) {
        newBlocks.push({ id: nextBlockId(), type: 'text', content: `*${group.transition}*` })
      }
      isFirstGroup = false

      // Individual tweet blocks
      for (const tweetId of group.tweet_ids) {
        newBlocks.push({ id: nextBlockId(), type: 'tweet', tweet_id: tweetId })
      }
    }
  }

  // "More on the timeline" section
  if (rest.length > 0) {
    newBlocks.push({ id: nextBlockId(), type: 'divider' })
    const sorted2 = sortTopics(topics)
    const links = rest.map(t => {
      const topicNum = sorted2.indexOf(t) + 1
      return `- [${t.title}](https://abridged.tech/app/${date}/${topicNum})`
    }).join('\n')
    newBlocks.push({
      id: nextBlockId(),
      type: 'text',
      content: `**More on the timeline**\n\n${links}`,
    })
  }

  // Kek section
  if (kekTweets.length > 0) {
    newBlocks.push({ id: nextBlockId(), type: 'divider' })
    newBlocks.push({ id: nextBlockId(), type: 'text', content: 'kek moments of the day' })
    for (const tweetId of kekTweets) {
      newBlocks.push({ id: nextBlockId(), type: 'tweet', tweet_id: tweetId })
    }
  }

  return newBlocks
}, [topics, date, generateTemplate, setCategoryMap])
```

**Step 2: Update handleCreateFromTemplate to be async**

```typescript
const handleCreateFromTemplate = useCallback(async (selectedIds: Set<number>) => {
  const newBlocks = await generateTemplateBlocks(selectedIds)
  setBlocks(newBlocks)
  setShowTopicSelector(false)
  triggerAutoSave()
}, [generateTemplateBlocks, triggerAutoSave])
```

**Step 3: Update TopicSelectorModal for kek auto-check**

In TopicSelectorModal, update the initial `selected` state to auto-include kek:

The kek topic isn't a separate topic — kek is a category within topics. So "kek auto-check" means: when the user opens the topic selector, all topics that contain kek tweets should be pre-selected? No — the user said "kek should be default toggled when choosing topics for the draft." This likely means that a special "kek moments" option should be auto-toggled, and kek tweets from all selected topics should be included automatically.

Actually, re-reading the user's request: kek tweets are collected across all selected topics automatically. The "default toggled" means the kek section is always included by default (the user can delete the kek text block and kek tweet blocks if they don't want them). No special toggle needed in the topic selector — kek is just automatically included.

**Step 4: Import useGenerateTemplate**

Add the import at the top of DigestComposer.tsx:
```typescript
import {
  type DigestBlock,
  useDigestDrafts,
  useDigestDraft,
  useCreateDigestDraft,
  useUpdateDigestDraft,
  useDeleteDigestDraft,
  useDigestPreview,
  useSendTestDigest,
  useSendDigest,
  useSubscriberCount,
  useSubscribers,
  useGenerateTemplate,
} from '../api/digest'
```

**Step 5: Run type check**

Run: `cd frontend && npx tsc --noEmit`

**Step 6: Commit**

```bash
git add frontend/src/pages/DigestComposer.tsx
git commit -m "feat(digest): async template generation with AI content and kek section"
```

---

### Task 7: Tweet Category Data in TweetSelectorPanel

**Files:**
- Modify: `frontend/src/pages/DigestComposer.tsx`
- Possibly modify: `frontend/src/api/dayBundle.ts` or `backend/app/routers/days.py`

**Context:** The TweetSelectorPanel needs to know each tweet's category to group them. The category comes from `TweetAssignment.category`, but the `TopicBundle.tweets` array doesn't include this. Two options:

1. **Use the `categoryMap` from generate-template** — already populated in Task 6 when generating a template. But won't be available if user adds a topic-header manually without using the template.

2. **Add category to the day bundle response** — modify the `/api/days/{date}/bundle` endpoint to include category in the tweet data.

**Recommended: Option 2** — Include `assignment_category` in the tweet data returned by the day bundle. This is the cleanest solution.

**Step 1: Check the day bundle endpoint**

Read `backend/app/routers/days.py` to see how tweets are fetched for the bundle. The tweet's category comes from the `TweetAssignment` table.

**Step 2: Add category to tweet response in day bundle**

In the day bundle endpoint, when building topic tweets, include the assignment category. Add it to each tweet dict as `assignment_category`.

**Step 3: Update the frontend Tweet type**

In `frontend/src/api/tweets.ts`, add:
```typescript
assignment_category?: string | null
```

**Step 4: Update TweetSelectorPanel to use assignment_category**

Replace the category grouping logic to use `tw.assignment_category` instead of `(tw as any).category`:

```typescript
const cat = tw.assignment_category || 'og post'
```

**Step 5: Run type check and tests**

Run: `cd frontend && npx tsc --noEmit`
Run: `/Users/wonchankim/Projects/tpot-digest/backend/.venv/bin/python -m pytest backend/tests/ -q --ignore=backend/tests/test_embeddings.py`

**Step 6: Commit**

```bash
git add backend/app/routers/days.py frontend/src/api/tweets.ts frontend/src/pages/DigestComposer.tsx
git commit -m "feat(digest): include assignment_category in day bundle tweet data"
```

---

### Task 8: Final Cleanup + Integration Test

**Files:**
- Modify: `frontend/src/pages/DigestComposer.tsx` (cleanup)

**Context:** Clean up any remaining references to old `topic` block type in the frontend. Update the toolbar's TopicPicker to add `topic-header` blocks. Remove `usedTopicIds` if it referenced old topic blocks.

**Step 1: Update usedTopicIds**

```typescript
const usedTopicIds = new Set(
  blocks.filter(b => b.type === 'topic-header' && b.topic_id).map(b => b.topic_id!)
)
```

**Step 2: Update usedTweetIds**

```typescript
const usedTweetIds = new Set(
  blocks.filter(b => b.type === 'tweet' && b.tweet_id).map(b => b.tweet_id!)
)
```

**Step 3: Update toolbar TopicPicker**

Ensure TopicPicker's `onSelect` calls `addTopicHeaderBlock`.

**Step 4: Run full type check**

Run: `cd frontend && npx tsc --noEmit`

**Step 5: Run full backend tests**

Run: `/Users/wonchankim/Projects/tpot-digest/backend/.venv/bin/python -m pytest backend/tests/ -q --ignore=backend/tests/test_embeddings.py`

Expected: All pass.

**Step 6: Manual integration test**

1. Open the digest composer at `https://abridged.tech/app/digest` (or local dev)
2. Create a new draft → topic selector should appear
3. Select 2-3 topics → confirm
4. Verify blocks are generated: intro text, dividers, topic-headers, summary text, individual tweets, transition text, "more on timeline", kek section
5. Click a topic-header → tweet selector panel should open
6. Toggle tweets on/off → verify blocks are added/removed
7. Drag blocks to reorder → verify reordering works
8. Delete blocks → verify deletion works
9. Preview → verify email renders correctly with numbered topics, X logo, quoted tweets
10. Auto-save → verify saves after 2 seconds

**Step 7: Commit**

```bash
git add frontend/src/pages/DigestComposer.tsx
git commit -m "feat(digest): cleanup and final integration"
```
