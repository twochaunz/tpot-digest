# Digest Composer Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the digest composer with a draft management modal, auto-save, smart template generation, markdown text blocks, divider blocks, per-tweet engagement toggles, and a neutral-themed email template with Twitter-embed-style tweet cards.

**Architecture:** Backend gains a `markdown` dependency for rendering text blocks in emails, and `_build_digest_content()` passes through new per-tweet fields. Frontend's `DigestComposer.tsx` gets a major rewrite — draft management moves to a modal, blocks gain new types (divider) and features (markdown, engagement toggles), and auto-save replaces manual save. The email template is completely redesigned from dark to neutral/adaptive with Twitter-embed-style tweet cards.

**Tech Stack:** Python `markdown` library, Jinja2 `|safe` filter for rendered HTML, React `useRef`+`useCallback` for debounced auto-save, existing `@dnd-kit` for block reordering.

---

### Task 1: Add `markdown` dependency and update backend schema

**Files:**
- Modify: `backend/pyproject.toml:8` (add `markdown` to dependencies)
- Modify: `backend/app/schemas/digest.py:6-11` (add `divider` type, new fields)

**Step 1: Add markdown to dependencies**

In `backend/pyproject.toml`, add `"markdown>=3.5"` to the `dependencies` list:

```toml
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.34",
    "sqlalchemy[asyncio]>=2.0",
    "asyncpg>=0.30",
    "alembic>=1.14",
    "httpx>=0.28",
    "pydantic>=2.10",
    "pydantic-settings>=2.7",
    "email-validator>=2.0",
    "pgvector>=0.3",
    "sentence-transformers>=3.0",
    "anthropic>=0.40",
    "resend>=2.0",
    "jinja2>=3.1",
    "markdown>=3.5",
]
```

**Step 2: Install the new dependency**

Run: `cd backend && .venv/bin/pip install markdown`

**Step 3: Update `DigestBlock` schema with new fields**

In `backend/app/schemas/digest.py`, update `DigestBlock`:

```python
class DigestBlock(BaseModel):
    id: str
    type: str  # 'text' | 'topic' | 'tweet' | 'divider'
    content: str | None = None    # text blocks (supports markdown)
    topic_id: int | None = None   # topic blocks
    tweet_id: int | None = None   # tweet blocks (DB integer id)
    show_engagement: bool = False  # tweet blocks: show engagement metrics
    tweet_overrides: dict[int, dict] | None = None  # topic blocks: per-tweet overrides
```

**Step 4: Run existing tests to verify nothing breaks**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_digest_api.py -v`
Expected: All tests PASS (schema changes are backward-compatible defaults)

**Step 5: Commit**

```bash
git add backend/pyproject.toml backend/app/schemas/digest.py
git commit -m "feat(digest): add markdown dep, divider block type, engagement toggle fields"
```

---

### Task 2: Update `_build_digest_content()` to handle new block types and fields

**Files:**
- Modify: `backend/app/routers/digest.py:37-104` (`_build_digest_content` function)
- Test: `backend/tests/test_digest_api.py`

**Step 1: Write tests for divider block and engagement toggle**

Add to `backend/tests/test_digest_api.py`:

```python
@pytest.mark.asyncio
async def test_preview_divider_block(client: AsyncClient):
    """A divider block should render as an <hr> in the preview."""
    today = date.today()
    create_resp = await client.post("/api/digest/drafts", json={
        "date": today.isoformat(),
        "content_blocks": [
            {"id": "b1", "type": "text", "content": "Before divider"},
            {"id": "b2", "type": "divider"},
            {"id": "b3", "type": "text", "content": "After divider"},
        ],
    })
    draft_id = create_resp.json()["id"]

    resp = await client.get(f"/api/digest/drafts/{draft_id}/preview")
    assert resp.status_code == 200
    data = resp.json()
    assert "<hr" in data["html"]
    assert "Before divider" in data["html"]
    assert "After divider" in data["html"]


@pytest.mark.asyncio
async def test_preview_markdown_text_block(client: AsyncClient):
    """Text blocks with markdown should render as HTML in the email."""
    today = date.today()
    create_resp = await client.post("/api/digest/drafts", json={
        "date": today.isoformat(),
        "content_blocks": [
            {"id": "b1", "type": "text", "content": "Hello **bold** and [a link](https://example.com)"},
        ],
    })
    draft_id = create_resp.json()["id"]

    resp = await client.get(f"/api/digest/drafts/{draft_id}/preview")
    assert resp.status_code == 200
    data = resp.json()
    assert "<strong>bold</strong>" in data["html"]
    assert 'href="https://example.com"' in data["html"]


@pytest.mark.asyncio
async def test_preview_tweet_engagement_toggle(client: AsyncClient):
    """Tweet blocks with show_engagement=true should include engagement in preview."""
    today = date.today()
    async with async_session() as session:
        tweet = Tweet(
            tweet_id="engage_1",
            author_handle="engager",
            author_display_name="Engager",
            text="Engagement test",
            engagement={"likes": 500, "retweets": 100},
            url="https://x.com/engager/status/1",
        )
        session.add(tweet)
        await session.commit()
        await session.refresh(tweet)
        tweet_db_id = tweet.id

    # Without engagement
    create_resp = await client.post("/api/digest/drafts", json={
        "date": today.isoformat(),
        "content_blocks": [
            {"id": "b1", "type": "tweet", "tweet_id": tweet_db_id, "show_engagement": False},
        ],
    })
    draft_id = create_resp.json()["id"]
    resp = await client.get(f"/api/digest/drafts/{draft_id}/preview")
    data = resp.json()
    assert "500" not in data["html"]  # engagement hidden

    # With engagement
    await client.patch(f"/api/digest/drafts/{draft_id}", json={
        "content_blocks": [
            {"id": "b1", "type": "tweet", "tweet_id": tweet_db_id, "show_engagement": True},
        ],
    })
    resp = await client.get(f"/api/digest/drafts/{draft_id}/preview")
    data = resp.json()
    assert "500" in data["html"]  # engagement shown
```

**Step 2: Run tests to verify they fail**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_digest_api.py::test_preview_divider_block backend/tests/test_digest_api.py::test_preview_markdown_text_block backend/tests/test_digest_api.py::test_preview_tweet_engagement_toggle -v`
Expected: FAIL (divider not handled, markdown not rendered, engagement always shown)

**Step 3: Update `_build_digest_content()` in `backend/app/routers/digest.py`**

Replace the `_build_digest_content` function (lines 37-104):

```python
async def _build_digest_content(draft: DigestDraft, db: AsyncSession) -> list[dict]:
    """Build list of block dicts for rendering from content_blocks."""
    import markdown as md

    result_blocks = []

    for block in (draft.content_blocks or []):
        block_type = block.get("type")

        if block_type == "text":
            content = block.get("content")
            if content:
                # Render markdown to HTML
                html_content = md.markdown(content, extensions=["extra"])
                result_blocks.append({"type": "text", "content": content, "html": html_content})

        elif block_type == "divider":
            result_blocks.append({"type": "divider"})

        elif block_type == "topic":
            topic_id = block.get("topic_id")
            if not topic_id:
                continue

            topic = await db.get(Topic, topic_id)
            if not topic:
                continue

            # Fetch assigned tweets for this topic
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
                # Check per-tweet engagement override
                tw_override = tweet_overrides.get(str(tw.id), {})
                show_engagement = tw_override.get("show_engagement", False)

                tweet_dict = {
                    "author_handle": tw.author_handle,
                    "author_display_name": tw.author_display_name,
                    "author_avatar_url": tw.author_avatar_url,
                    "text": tw.text,
                    "url": tw.url,
                    "show_engagement": show_engagement,
                }
                if show_engagement:
                    tweet_dict["engagement"] = tw.engagement
                tweet_dicts.append(tweet_dict)

            result_blocks.append({
                "type": "topic",
                "title": topic.title,
                "tweets": tweet_dicts,
            })

        elif block_type == "tweet":
            tweet_id = block.get("tweet_id")
            if not tweet_id:
                continue

            tw = await db.get(Tweet, tweet_id)
            if not tw:
                continue

            show_engagement = block.get("show_engagement", False)
            tweet_block = {
                "type": "tweet",
                "author_handle": tw.author_handle,
                "author_display_name": tw.author_display_name,
                "author_avatar_url": tw.author_avatar_url,
                "text": tw.text,
                "url": tw.url,
                "show_engagement": show_engagement,
            }
            if show_engagement:
                tweet_block["engagement"] = tw.engagement

            result_blocks.append(tweet_block)

    return result_blocks
```

**Step 4: Run tests to verify they pass**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_digest_api.py -v`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add backend/app/routers/digest.py backend/tests/test_digest_api.py
git commit -m "feat(digest): support divider blocks, markdown text, per-tweet engagement toggle"
```

---

### Task 3: Redesign the email template

**Files:**
- Modify: `backend/app/templates/digest_email.html` (complete rewrite)
- Modify: `backend/app/services/email.py:13` (disable autoescaping for markdown HTML)

**Step 1: Disable Jinja2 autoescaping for the digest template**

The template now receives pre-rendered HTML from markdown. Update `backend/app/services/email.py` line 13:

```python
_jinja_env = Environment(loader=FileSystemLoader(str(_TEMPLATE_DIR)), autoescape=False)
```

Note: This is safe because all user-facing content (tweet text, author names) comes from the X API, not from arbitrary user input. The markdown content is written by the admin only.

**Step 2: Rewrite the email template**

Replace the entire content of `backend/app/templates/digest_email.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>abridged - {{ date_str }}</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;color:#1a1a1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px;">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="font-size:24px;font-weight:700;margin:0 0 4px 0;color:#1a1a1a;letter-spacing:-0.02em;">abridged</h1>
      <p style="font-size:14px;color:#6b7280;margin:0;">{{ date_str }}</p>
    </div>

    {% for block in blocks %}
    {% if block.type == 'text' %}
    <!-- Text block (rendered markdown) -->
    <div style="margin-bottom:24px;font-size:15px;line-height:1.7;color:#374151;">
      {{ block.html }}
    </div>

    {% elif block.type == 'divider' %}
    <!-- Divider -->
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;">

    {% elif block.type == 'topic' %}
    <!-- Topic: {{ block.title }} -->
    <div style="margin-bottom:28px;">
      <h2 style="font-size:17px;font-weight:700;color:#1a1a1a;margin:0 0 12px 0;padding-bottom:8px;border-bottom:1px solid #e5e7eb;">{{ block.title }}</h2>

      {% for tweet in block.tweets %}
      <!-- Tweet card -->
      <div style="background:#ffffff;border:1px solid #e1e8ed;border-radius:12px;padding:16px;margin-bottom:10px;">
        <div style="display:flex;margin-bottom:10px;">
          {% if tweet.author_avatar_url %}
          <img src="{{ tweet.author_avatar_url }}" alt="" width="48" height="48" style="border-radius:50%;margin-right:10px;">
          {% endif %}
          <div>
            <div style="font-weight:700;font-size:15px;color:#0f1419;line-height:1.3;">{{ tweet.author_display_name or tweet.author_handle }}</div>
            <div style="font-size:13px;color:#536471;">@{{ tweet.author_handle }}</div>
          </div>
        </div>
        <p style="margin:0 0 12px 0;font-size:15px;line-height:1.5;color:#0f1419;white-space:pre-wrap;">{{ tweet.text }}</p>
        {% if tweet.show_engagement and tweet.engagement %}
        <div style="font-size:13px;color:#536471;margin-bottom:10px;padding-top:8px;border-top:1px solid #e1e8ed;">
          {% if tweet.engagement.replies is not none %}<span style="margin-right:16px;">{{ tweet.engagement.replies }} replies</span>{% endif %}
          {% if tweet.engagement.retweets is not none %}<span style="margin-right:16px;">{{ tweet.engagement.retweets }} reposts</span>{% endif %}
          {% if tweet.engagement.likes is not none %}<span style="margin-right:16px;">{{ tweet.engagement.likes }} likes</span>{% endif %}
        </div>
        {% endif %}
        {% if tweet.url %}
        <a href="{{ tweet.url }}" style="font-size:13px;color:#1d9bf0;text-decoration:none;">View on X &rarr;</a>
        {% endif %}
      </div>
      {% endfor %}
    </div>

    {% elif block.type == 'tweet' %}
    <!-- Standalone tweet -->
    <div style="background:#ffffff;border:1px solid #e1e8ed;border-radius:12px;padding:16px;margin-bottom:20px;">
      <div style="display:flex;margin-bottom:10px;">
        {% if block.author_avatar_url %}
        <img src="{{ block.author_avatar_url }}" alt="" width="48" height="48" style="border-radius:50%;margin-right:10px;">
        {% endif %}
        <div>
          <div style="font-weight:700;font-size:15px;color:#0f1419;line-height:1.3;">{{ block.author_display_name or block.author_handle }}</div>
          <div style="font-size:13px;color:#536471;">@{{ block.author_handle }}</div>
        </div>
      </div>
      <p style="margin:0 0 12px 0;font-size:15px;line-height:1.5;color:#0f1419;white-space:pre-wrap;">{{ block.text }}</p>
      {% if block.show_engagement and block.engagement %}
      <div style="font-size:13px;color:#536471;margin-bottom:10px;padding-top:8px;border-top:1px solid #e1e8ed;">
        {% if block.engagement.replies is not none %}<span style="margin-right:16px;">{{ block.engagement.replies }} replies</span>{% endif %}
        {% if block.engagement.retweets is not none %}<span style="margin-right:16px;">{{ block.engagement.retweets }} reposts</span>{% endif %}
        {% if block.engagement.likes is not none %}<span style="margin-right:16px;">{{ block.engagement.likes }} likes</span>{% endif %}
      </div>
      {% endif %}
      {% if block.url %}
      <a href="{{ block.url }}" style="font-size:13px;color:#1d9bf0;text-decoration:none;">View on X &rarr;</a>
      {% endif %}
    </div>
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

**Step 3: Run tests to verify template changes work**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_digest_api.py -v`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add backend/app/templates/digest_email.html backend/app/services/email.py
git commit -m "feat(digest): redesign email template - neutral theme, Twitter-embed-style tweet cards"
```

---

### Task 4: Update frontend `DigestBlock` type

**Files:**
- Modify: `frontend/src/api/digest.ts:4-10` (update `DigestBlock` interface)

**Step 1: Update the DigestBlock interface**

In `frontend/src/api/digest.ts`, replace the `DigestBlock` interface (lines 4-10):

```typescript
export interface DigestBlock {
  id: string
  type: 'text' | 'topic' | 'tweet' | 'divider'
  content?: string | null    // text blocks (supports markdown)
  topic_id?: number | null   // topic blocks
  tweet_id?: number | null   // tweet blocks (DB integer id)
  show_engagement?: boolean  // tweet blocks: show engagement metrics (default false)
  tweet_overrides?: Record<number, { show_engagement: boolean }>  // topic blocks: per-tweet overrides
}
```

**Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (the existing composer code doesn't reference the new fields yet)

**Step 3: Commit**

```bash
git add frontend/src/api/digest.ts
git commit -m "feat(digest): add divider type, engagement toggle fields to DigestBlock"
```

---

### Task 5: Rewrite DigestComposer — Draft modal + auto-load fix

This is the first of several frontend tasks that together rewrite `DigestComposer.tsx`. This task focuses on the draft management modal and fixing auto-load.

**Files:**
- Modify: `frontend/src/pages/DigestComposer.tsx`

**Step 1: Remove the "All Drafts" section from the bottom of the page**

Delete the entire `{/* Existing Drafts List */}` block (lines 1049-1115 in the current file).

**Step 2: Add DraftsModal component**

Add this component before the main `DigestComposer` function:

```tsx
/* ---- Drafts browser modal ---- */
function DraftsModal({
  drafts,
  selectedDraftId,
  onSelect,
  onClose,
  onCreate,
}: {
  drafts: DigestDraft[]
  selectedDraftId: number | null
  onSelect: (id: number) => void
  onClose: () => void
  onCreate: (date: string) => void
}) {
  const [newDate, setNewDate] = useState('')

  const grouped = {
    draft: drafts.filter(d => d.status === 'draft'),
    scheduled: drafts.filter(d => d.status === 'scheduled'),
    sent: drafts.filter(d => d.status === 'sent'),
  }

  const statusLabel = { draft: 'Drafts', scheduled: 'Scheduled', sent: 'Sent' }
  const statusColor = {
    draft: 'var(--text-secondary)',
    scheduled: '#a78bfa',
    sent: '#4ade80',
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', width: 480, maxHeight: '70vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Drafts</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: 18, cursor: 'pointer' }}>&times;</button>
        </div>

        {/* New draft */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="date"
            value={newDate}
            onChange={e => setNewDate(e.target.value)}
            style={{
              flex: 1, background: 'var(--bg-base)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', padding: '6px 10px', color: 'var(--text-primary)',
              fontSize: 13, fontFamily: 'var(--font-body)', outline: 'none',
            }}
          />
          <button
            onClick={() => { if (newDate) { onCreate(newDate); onClose() } }}
            disabled={!newDate}
            style={{
              background: 'var(--accent)', color: '#fff', border: 'none',
              borderRadius: 'var(--radius-md)', padding: '6px 14px', fontSize: 13,
              fontWeight: 500, cursor: newDate ? 'pointer' : 'default',
              opacity: newDate ? 1 : 0.4, fontFamily: 'var(--font-body)',
            }}
          >
            New Draft
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {(['draft', 'scheduled', 'sent'] as const).map(status => {
            const items = grouped[status]
            if (items.length === 0) return null
            return (
              <div key={status}>
                <div style={{ padding: '8px 20px', fontSize: 11, fontWeight: 600, color: statusColor[status], textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {statusLabel[status]} ({items.length})
                </div>
                {items.map(d => {
                  const topicCount = (d.content_blocks || []).filter(b => b.type === 'topic').length
                  return (
                    <div
                      key={d.id}
                      onClick={() => { onSelect(d.id); onClose() }}
                      style={{
                        padding: '10px 20px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        background: d.id === selectedDraftId ? 'var(--bg-hover)' : 'transparent',
                        borderRadius: 0,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = d.id === selectedDraftId ? 'var(--bg-hover)' : 'transparent' }}
                    >
                      <div>
                        <span style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>{d.date}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 8 }}>
                          {topicCount} topic{topicCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                      {d.sent_at && (
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                          {d.recipient_count} sent
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
```

**Step 3: Fix auto-load and add "Drafts" button to header**

In the main `DigestComposer` function:

1. Replace the broken auto-select `useEffect` (lines 553-560) with this:

```tsx
// Auto-select existing draft for this date (runs once when drafts load)
useEffect(() => {
  if (!drafts) return
  const existing = drafts.find((d) => d.date === date && d.status === 'draft')
  if (existing) {
    setSelectedDraftId(existing.id)
  }
}, [drafts, date])
```

Remove the `selectedDraftId` dependency — the old code had `!selectedDraftId` which caused the race condition. Now it runs whenever `drafts` or `date` changes and always selects the right draft.

2. Add state for the drafts modal:

```tsx
const [showDraftsModal, setShowDraftsModal] = useState(false)
```

3. Add a "Drafts" button in the header (next to subscriber count):

```tsx
<button
  onClick={() => setShowDraftsModal(true)}
  style={{
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-secondary)',
    padding: '6px 12px',
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
  }}
>
  Drafts{drafts ? ` (${drafts.length})` : ''}
</button>
```

4. Render the modal at the bottom of the component (before the subscribers modal):

```tsx
{showDraftsModal && drafts && (
  <DraftsModal
    drafts={drafts}
    selectedDraftId={selectedDraftId}
    onSelect={(id) => setSelectedDraftId(id)}
    onClose={() => setShowDraftsModal(false)}
    onCreate={(newDate) => {
      setDate(newDate)
      setSelectedDraftId(null)
      setBlocks([])
    }}
  />
)}
```

**Step 4: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/pages/DigestComposer.tsx
git commit -m "feat(digest): draft management modal, fix auto-load race condition"
```

---

### Task 6: Add auto-save with debounce

**Files:**
- Modify: `frontend/src/pages/DigestComposer.tsx`

**Step 1: Add auto-save logic**

Add a `useRef` for tracking changes and a debounced save effect. Place this after the mutation hooks setup:

```tsx
// --- Auto-save ---
const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
const blocksRef = useRef(blocks)
blocksRef.current = blocks

const triggerAutoSave = useCallback(() => {
  setSaveStatus('idle')
  if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
  saveTimeoutRef.current = setTimeout(async () => {
    const currentBlocks = blocksRef.current.map(b => ({ ...b }))
    if (selectedDraftId) {
      setSaveStatus('saving')
      try {
        await updateDraft.mutateAsync({
          id: selectedDraftId,
          content_blocks: currentBlocks,
          scheduled_for: scheduledFor || undefined,
        })
        setSaveStatus('saved')
      } catch {
        setSaveStatus('idle')
      }
    } else if (currentBlocks.length > 0) {
      // Auto-create draft on first edit
      setSaveStatus('saving')
      try {
        const created = await createDraft.mutateAsync({
          date,
          content_blocks: currentBlocks,
        })
        setSelectedDraftId(created.id)
        setSaveStatus('saved')
      } catch {
        setSaveStatus('idle')
      }
    }
  }, 2000)
}, [selectedDraftId, date, scheduledFor, updateDraft, createDraft])
```

**Step 2: Call `triggerAutoSave()` from every mutation**

Update `updateBlock`, `deleteBlock`, `addTextBlock`, `addTopicBlock`, `addTweetBlock`, and `handleDragEnd` to call `triggerAutoSave()` after their state change. For example:

```tsx
const deleteBlock = useCallback((id: string) => {
  setBlocks((prev) => prev.filter((b) => b.id !== id))
  triggerAutoSave()
}, [triggerAutoSave])

const addTextBlock = useCallback(() => {
  setBlocks((prev) => [...prev, { id: nextBlockId(), type: 'text' as const, content: '' }])
  triggerAutoSave()
}, [triggerAutoSave])
```

For `TextBlockEditor`, update it to accept and call `onContentChange`:

```tsx
function TextBlockEditor({ block, isSent, onContentChange }: { block: DigestBlock; isSent: boolean; onContentChange: () => void }) {
  const [value, setValue] = useState(block.content || '')

  useEffect(() => {
    setValue(block.content || '')
  }, [block.content])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    block.content = e.target.value
    onContentChange()
  }

  // Auto-resize
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    }
  }, [value])

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={handleChange}
      disabled={isSent}
      placeholder="Write markdown content..."
      rows={3}
      style={{ ...markdownTextareaStyle, overflow: 'hidden', resize: 'none' }}
    />
  )
}
```

Pass `onContentChange={triggerAutoSave}` from `SortableBlock`.

**Step 3: Add save indicator in the header**

In the header, add after the "Drafts" button:

```tsx
{saveStatus === 'saving' && (
  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Saving...</span>
)}
{saveStatus === 'saved' && (
  <span style={{ fontSize: 12, color: '#4ade80' }}>Saved</span>
)}
```

**Step 4: Remove the manual "Save Draft" / "Create Draft" button**

Remove the first button in the action buttons section (the `handleSaveDraft` button). Keep "Send Test", "Send Now", and "Delete Draft".

Also remove the `handleSaveDraft` function entirely since auto-save replaces it.

**Step 5: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 6: Commit**

```bash
git add frontend/src/pages/DigestComposer.tsx
git commit -m "feat(digest): auto-save with 2s debounce, remove manual save button"
```

---

### Task 7: Add divider block support in composer

**Files:**
- Modify: `frontend/src/pages/DigestComposer.tsx`

**Step 1: Add divider block rendering in `SortableBlock`**

After the tweet block rendering section, add:

```tsx
{block.type === 'divider' && (
  <hr style={{
    border: 'none',
    borderTop: '1px solid var(--border)',
    margin: '8px 0',
  }} />
)}
```

**Step 2: Add "addDividerBlock" callback and button**

```tsx
const addDividerBlock = useCallback(() => {
  setBlocks((prev) => [...prev, { id: nextBlockId(), type: 'divider' as const }])
  triggerAutoSave()
}, [triggerAutoSave])
```

Add to the add-block buttons row:

```tsx
<button onClick={addDividerBlock} style={addBtnStyle}>
  + Divider
</button>
```

**Step 3: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/pages/DigestComposer.tsx
git commit -m "feat(digest): add divider block type to composer"
```

---

### Task 8: Add per-tweet engagement toggles in composer

**Files:**
- Modify: `frontend/src/pages/DigestComposer.tsx`

**Step 1: Add engagement toggle to standalone tweet blocks**

In the `SortableBlock` tweet rendering section, add a small toggle button after the `CompactTweet`:

```tsx
{block.type === 'tweet' && tweetData && (
  <div style={{
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)', padding: '10px 14px',
  }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: tweetData.topicColor || 'var(--accent)',
        flexShrink: 0, marginTop: 5,
      }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <CompactTweet tweet={tweetData.tweet} expanded={false} onToggleExpand={() => {}} />
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>from {tweetData.topicTitle}</span>
      </div>
    </div>
    {!isSent && (
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11, color: 'var(--text-tertiary)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={block.show_engagement || false}
          onChange={(e) => {
            onUpdateBlock(block.id, { show_engagement: e.target.checked })
            triggerAutoSave()
          }}
          style={{ margin: 0 }}
        />
        Show engagement metrics
      </label>
    )}
  </div>
)}
```

Note: `onUpdateBlock` needs to be passed down. Add it as an actual used prop in `SortableBlock` (it's already in the type signature but unused — the `onUpdateBlock` prop at line 88). Also pass `triggerAutoSave` down.

**Step 2: Add per-tweet engagement toggles to topic blocks**

In the topic block section, for each `CompactTweet`, add a small checkbox:

```tsx
{topic.tweets.map((tw) => {
  const isEngagementOn = block.tweet_overrides?.[tw.id]?.show_engagement || false
  return (
    <div key={tw.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
      <div style={{ flex: 1 }}>
        <CompactTweet tweet={tw} expanded={false} onToggleExpand={() => {}} />
      </div>
      {!isSent && (
        <input
          type="checkbox"
          checked={isEngagementOn}
          onChange={(e) => {
            const overrides = { ...(block.tweet_overrides || {}) }
            if (e.target.checked) {
              overrides[tw.id] = { show_engagement: true }
            } else {
              delete overrides[tw.id]
            }
            onUpdateBlock(block.id, { tweet_overrides: overrides })
            triggerAutoSave()
          }}
          title="Show engagement"
          style={{ margin: 0, marginTop: 8, cursor: 'pointer' }}
        />
      )}
    </div>
  )
})}
```

**Step 3: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/pages/DigestComposer.tsx
git commit -m "feat(digest): per-tweet engagement toggle in composer"
```

---

### Task 9: Add compact-with-expand to tweet previews

**Files:**
- Modify: `frontend/src/pages/DigestComposer.tsx` (`CompactTweet` component)

**Step 1: Add expand/collapse to CompactTweet**

Replace the `CompactTweet` component:

```tsx
function CompactTweet({
  tweet,
  expanded,
  onToggleExpand,
}: {
  tweet: Tweet
  expanded: boolean
  onToggleExpand: () => void
}) {
  const isLong = tweet.text.length > 120

  return (
    <div
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0',
        cursor: isLong ? 'pointer' : 'default',
      }}
      onClick={isLong ? onToggleExpand : undefined}
    >
      {tweet.author_avatar_url && (
        <img
          src={tweet.author_avatar_url}
          alt=""
          style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1 }}
        />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
          @{tweet.author_handle}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 6 }}>
          {expanded || !isLong ? tweet.text : tweet.text.slice(0, 120) + '...'}
        </span>
        {isLong && (
          <span style={{ fontSize: 11, color: 'var(--accent)', marginLeft: 4 }}>
            {expanded ? '(less)' : '(more)'}
          </span>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Add expand state tracking in SortableBlock**

Add a local state to `SortableBlock`:

```tsx
const [expandedTweets, setExpandedTweets] = useState<Set<number>>(new Set())

const toggleExpand = (tweetId: number) => {
  setExpandedTweets(prev => {
    const next = new Set(prev)
    if (next.has(tweetId)) next.delete(tweetId)
    else next.add(tweetId)
    return next
  })
}
```

Pass to `CompactTweet`:

```tsx
<CompactTweet
  tweet={tw}
  expanded={expandedTweets.has(tw.id)}
  onToggleExpand={() => toggleExpand(tw.id)}
/>
```

**Step 3: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/pages/DigestComposer.tsx
git commit -m "feat(digest): compact tweet previews with click-to-expand"
```

---

### Task 10: Smart template — topic selector + auto-populate

**Files:**
- Modify: `frontend/src/pages/DigestComposer.tsx`

**Step 1: Add TopicSelectorModal component**

Add before the main `DigestComposer` function:

```tsx
/* ---- Topic selector for new draft template ---- */
function TopicSelectorModal({
  topics,
  date,
  onConfirm,
  onClose,
}: {
  topics: TopicBundle[]
  date: string
  onConfirm: (selectedIds: Set<number>) => void
  onClose: () => void
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const toggle = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectTop3 = () => {
    const top3 = topics.slice(0, 3).map(t => t.id)
    setSelected(new Set(top3))
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', width: 420, maxHeight: '70vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
            Select featured topics
          </h3>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-tertiary)' }}>
            Selected topics become full blocks. Others go to "more on the timeline" links.
          </p>
        </div>

        <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
          <button onClick={selectTop3} style={{ ...addBtnStyle, fontSize: 12, padding: '4px 10px' }}>
            Top 3
          </button>
          <button onClick={() => setSelected(new Set(topics.map(t => t.id)))} style={{ ...addBtnStyle, fontSize: 12, padding: '4px 10px' }}>
            All
          </button>
          <button onClick={() => setSelected(new Set())} style={{ ...addBtnStyle, fontSize: 12, padding: '4px 10px' }}>
            None
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 12px' }}>
          {topics.map(t => (
            <label
              key={t.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px',
                cursor: 'pointer', borderRadius: 'var(--radius-sm)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color || 'var(--accent)', flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1 }}>{t.title}</span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                {t.tweet_count} tweet{t.tweet_count !== 1 ? 's' : ''}
              </span>
            </label>
          ))}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ ...addBtnStyle }}>Cancel</button>
          <button
            onClick={() => onConfirm(selected)}
            style={{
              background: 'var(--accent)', color: '#fff', border: 'none',
              borderRadius: 'var(--radius-md)', padding: '8px 16px', fontSize: 13,
              fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font-body)',
            }}
          >
            Create Draft
          </button>
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Add template generation function**

In the main `DigestComposer`, add a function to generate template blocks:

```tsx
const [showTopicSelector, setShowTopicSelector] = useState(false)

const generateTemplateBlocks = useCallback((selectedIds: Set<number>): DigestBlock[] => {
  const sorted = sortTopics(topics)
  const featured = sorted.filter(t => selectedIds.has(t.id))
  const rest = sorted.filter(t => !selectedIds.has(t.id))

  const formattedDate = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })

  const blocks: DigestBlock[] = []

  // Intro
  blocks.push({
    id: nextBlockId(),
    type: 'text',
    content: `${featured.length} topic${featured.length !== 1 ? 's' : ''} from ${formattedDate} tech discourse`,
  })

  // Divider
  blocks.push({ id: nextBlockId(), type: 'divider' })

  // Featured topic blocks
  for (const t of featured) {
    blocks.push({ id: nextBlockId(), type: 'topic', topic_id: t.id })
  }

  // More on the timeline (if there are non-featured topics)
  if (rest.length > 0) {
    blocks.push({ id: nextBlockId(), type: 'divider' })
    const links = rest.map((t, i) => {
      const topicNum = sorted.indexOf(t) + 1
      return `- [${t.title}](https://abridged.tech/app/${date}/${topicNum})`
    }).join('\n')
    blocks.push({
      id: nextBlockId(),
      type: 'text',
      content: `**More on the timeline**\n\n${links}`,
    })
  }

  // Divider + outro
  blocks.push({ id: nextBlockId(), type: 'divider' })
  blocks.push({
    id: nextBlockId(),
    type: 'text',
    content: 'Until next time.',
  })

  return blocks
}, [topics, date])

const handleCreateFromTemplate = useCallback((selectedIds: Set<number>) => {
  const newBlocks = generateTemplateBlocks(selectedIds)
  setBlocks(newBlocks)
  setShowTopicSelector(false)
  triggerAutoSave()
}, [generateTemplateBlocks, triggerAutoSave])
```

**Step 3: Wire up the "New Draft" button in DraftsModal to show TopicSelectorModal**

Update the `onCreate` prop passed to `DraftsModal` to set the date and show the topic selector:

```tsx
onCreate={(newDate) => {
  setDate(newDate)
  setSelectedDraftId(null)
  setBlocks([])
  setShowTopicSelector(true)
}}
```

Also add a "New Draft" button in the main UI (e.g., when there's no draft selected):

```tsx
{blocks.length === 0 && !selectedDraftId && topics.length > 0 && (
  <button
    onClick={() => setShowTopicSelector(true)}
    style={buttonStyle('var(--accent)')}
  >
    New Draft from Topics
  </button>
)}
```

**Step 4: Render TopicSelectorModal**

```tsx
{showTopicSelector && (
  <TopicSelectorModal
    topics={topics}
    date={date}
    onConfirm={handleCreateFromTemplate}
    onClose={() => setShowTopicSelector(false)}
  />
)}
```

**Step 5: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 6: Commit**

```bash
git add frontend/src/pages/DigestComposer.tsx
git commit -m "feat(digest): smart template - topic selector with Top 3, auto-populate blocks"
```

---

### Task 11: Run all tests, fix any issues, final commit

**Files:**
- Test: `backend/tests/test_digest_api.py`
- Check: `frontend/src/` (TypeScript)

**Step 1: Run backend tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_digest_api.py -v`
Expected: All PASS

**Step 2: Run full backend test suite**

Run: `backend/.venv/bin/python -m pytest backend/tests/ -q`
Expected: All PASS

**Step 3: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

**Step 4: Fix any issues found**

Address any type errors or test failures.

**Step 5: Final commit if needed**

```bash
git add -A
git commit -m "fix: resolve any remaining issues from digest composer redesign"
```
