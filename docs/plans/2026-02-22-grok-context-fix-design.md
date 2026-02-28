# Fix Grok Context: x_search + Markdown Rendering

## Problem

1. Grok only receives tweet text + author handle — no tweet URL, so it can't look up the actual tweet or its surrounding conversation
2. Grok's response (markdown) is rendered as raw text with `pre-wrap` instead of properly parsed HTML
3. The experience doesn't match X's native Grok context button

## Solution

Switch from the old Chat Completions API to the xAI Responses API with `x_search` tool, and render the response as properly styled markdown matching X's Grok panel.

## Backend Changes

### `backend/app/services/grok_api.py`

- **Endpoint**: `/v1/chat/completions` -> `/v1/responses`
- **Model**: `grok-3` -> `grok-4-1-fast-reasoning`
- **Tools**: Add `x_search` tool with author handle in `allowed_x_handles`
- **Prompt**: Include tweet URL (`https://x.com/{author_handle}/status/{tweet_id}`) and ask Grok to provide context
- **Response parsing**: Extract text from Responses API format (`output` array with `message` items) instead of `choices[0].message.content`

New function signature:
```python
async def fetch_grok_context(text: str, author_handle: str, tweet_id: str, url: str | None) -> str
```

### `backend/app/routers/tweets.py`

- Pass `tweet.tweet_id` and `tweet.url` to `fetch_grok_context()`

## Frontend Changes

### New dependency: `react-markdown` + `remark-gfm`

### `frontend/src/components/TweetDetailModal.tsx`

- Replace raw `<div>{grokContext}</div>` with `<ReactMarkdown>` component
- Style with custom component overrides matching X's Grok context panel:
  - Dark panel background (#16181c)
  - Clean sans-serif typography
  - Proper heading sizes, styled lists, bold text, links
  - Subtle border and rounded corners
  - Line-height 1.6 for readability

## Testing

- Update `backend/tests/test_tweets_api.py` mock to match new Responses API format
- Verify markdown rendering in browser
