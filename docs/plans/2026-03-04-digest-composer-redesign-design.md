# Digest Composer Redesign

**Date**: 2026-03-04

## Problem

The digest composer has several UX issues:
1. Drafts list is buried at the bottom — not discoverable, requires scrolling
2. Draft auto-loading has a race condition and doesn't reliably show existing drafts
3. Tweet blocks in the composer are too compact; tweet cards in the email use a forced dark theme with custom styling instead of looking like proper Twitter embeds
4. No smart templating — every draft starts empty, requiring manual block-by-block construction
5. Text blocks don't support markdown
6. No divider block type
7. No auto-save — manual save button required

## Design

### 1. Draft Management Modal

Remove the "All Drafts" list from the bottom of the page. Add a "Drafts" button in the header bar that opens a modal:

- Drafts grouped by status: draft → scheduled → sent
- Each row: date, topic count, status badge
- Click a draft → load it, close modal
- "New Draft" button with date picker
- On page load: auto-select today's draft if one exists (derive from query data, not broken useEffect chain)

### 2. Auto-Save

- Debounced auto-save: 2 seconds after the last change (text edit, block add/remove/reorder)
- Subtle save indicator in the header: "Saving..." → "Saved [time]"
- Auto-create draft on first change if no draft exists for the selected date
- Remove manual "Save Draft" button (auto-save replaces it)
- Keep explicit action buttons: "Send Test", "Send Now", "Delete Draft"

### 3. Smart Template for New Drafts

When creating a new draft, show a topic selector modal:

- Checkboxes for each topic on that date
- "Top 3" quick-select button (selects first 3 by position)
- On confirm, populate draft with:
  1. **Intro text block**: Pre-filled markdown, e.g. `"3 topics from March 4, 2026 tech discourse"`
  2. **Divider**
  3. **Selected topic blocks** (by position order)
  4. **Divider**
  5. **"More on the timeline" text block**: Auto-generated markdown with unselected topic titles as links, e.g. `- [Topic Title](https://abridged.tech/app/2026-03-04/3)`
  6. **Outro text block**: Placeholder closing text

The template is a starting point — fully editable after generation.

### 4. Block Editor Improvements

**New block type — Divider:**
- Renders as `<hr>` in the email
- In composer: thin horizontal line with drag handle + delete button

**Text blocks — Markdown support:**
- Textarea accepts markdown (bold, italic, links, lists)
- Email template renders markdown → HTML via a Python markdown library
- Auto-resize textarea to content height

**Tweet blocks — Compact with expand:**
- Default: compact view (avatar + handle + truncated text)
- Click to expand: full tweet text visible
- Per-tweet engagement toggle: `show_engagement` boolean, default false
- Preview iframe remains the source of truth for final rendering

**Topic blocks — Per-tweet engagement toggle:**
- Each tweet within a topic block gets a toggle for engagement metrics
- Stored as `tweet_overrides: { [tweet_id]: { show_engagement: boolean } }` on the block
- Only populated sparsely (entries only when toggled on)

### 5. Email Template Redesign

**Theme**: Neutral/adaptive — white background (#fff), dark text (#1a1a1a). No forced dark theme. Respects email client settings.

**Tweet cards** — styled like Twitter/X embeds (Substack aesthetic):
- White card, subtle border (#e1e8ed), rounded corners
- Avatar (48px) + display name (bold) + @handle (gray)
- Full tweet text
- Small X logo in corner
- "View on X →" link
- Engagement metrics: hidden by default, shown per-tweet when `show_engagement` is true

**Text blocks**: Rendered markdown as normal body text (not inside a colored box).

**Dividers**: Simple styled `<hr>`.

**"More on the timeline"**: Bulleted list of topic title links pointing to `https://abridged.tech/app/{date}/{topicNum}`.

**Footer**: Unsubscribe link (CAN-SPAM compliant).

### 6. Schema Changes

The `DigestBlock` type gains:

```typescript
DigestBlock {
  id: string
  type: 'text' | 'topic' | 'tweet' | 'divider'  // added 'divider'
  content?: string           // for text blocks (now supports markdown)
  topic_id?: number          // for topic blocks
  tweet_id?: number          // for tweet blocks
  show_engagement?: boolean  // for tweet blocks (default false)
  tweet_overrides?: Record<number, { show_engagement: boolean }>  // for topic blocks
}
```

No database migration needed — `content_blocks` is JSONB and accepts any shape.

### 7. Backend Changes

- Add `markdown` Python package for rendering markdown → HTML in email template
- Update `_build_digest_content()` to pass `show_engagement` and `tweet_overrides` through to the template
- Update `digest_email.html` Jinja2 template with new styling
- Handle `divider` block type in template rendering

### 8. Files to Modify

**Frontend:**
- `frontend/src/pages/DigestComposer.tsx` — major rewrite: draft modal, auto-save, smart template, block improvements
- `frontend/src/api/digest.ts` — update `DigestBlock` type with new fields

**Backend:**
- `backend/app/templates/digest_email.html` — complete template redesign
- `backend/app/routers/digest.py` — update `_build_digest_content()` for new block types and fields
- `backend/app/schemas/digest.py` — add `divider` type, new optional fields
- `backend/requirements.txt` or equivalent — add `markdown` package
