# Fix Grok Context Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix Grok context to use xAI Responses API with x_search (like X's native Grok button) and render markdown output properly with X-style panel.

**Architecture:** Backend switches from Chat Completions API to Responses API with `x_search` tool so Grok can look up the actual tweet. Frontend adds `react-markdown` to render Grok's markdown response and styles the panel to match X's native Grok context UI.

**Tech Stack:** Python httpx (backend), react-markdown + remark-gfm (frontend), xAI Responses API

---

### Task 1: Update backend grok_api.py — Switch to Responses API with x_search

**Files:**
- Modify: `backend/app/services/grok_api.py` (entire file)

**Step 1: Update `fetch_grok_context` to use Responses API with x_search**

Replace the entire `fetch_grok_context` function in `backend/app/services/grok_api.py`:

```python
"""xAI Grok API client for fetching tweet context."""

from __future__ import annotations

import httpx

from app.config import settings

XAI_API_BASE = "https://api.x.ai/v1"


class XAIAPIError(Exception):
    """Raised when the xAI API returns an error or is misconfigured."""

    pass


async def fetch_grok_context(
    text: str,
    author_handle: str,
    tweet_id: str = "",
    url: str | None = None,
) -> str:
    """Call the xAI Grok API with x_search to get context about a tweet.

    Uses the Responses API with x_search tool so Grok can look up the
    actual tweet and its surrounding conversation on X.

    Returns the response text from Grok.

    Raises:
        XAIAPIError: on missing key, rate limiting, or API failure.
    """
    if not settings.xai_api_key:
        raise XAIAPIError("xAI API key is not configured")

    headers = {
        "Authorization": f"Bearer {settings.xai_api_key}",
        "Content-Type": "application/json",
    }

    tweet_url = url or f"https://x.com/{author_handle}/status/{tweet_id}"

    payload = {
        "model": "grok-3",
        "tools": [
            {
                "type": "x_search",
                "allowed_x_handles": [author_handle],
            },
        ],
        "input": [
            {
                "role": "user",
                "content": (
                    f"Provide context for this tweet: {tweet_url}\n\n"
                    f"Tweet by @{author_handle}:\n\"{text}\"\n\n"
                    "Explain what this tweet is about, why it's significant, "
                    "and what's the broader conversation or context around it."
                ),
            },
        ],
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{XAI_API_BASE}/responses",
            headers=headers,
            json=payload,
            timeout=60.0,
        )

    if response.status_code == 429:
        raise XAIAPIError("xAI API rate limit exceeded")
    if response.status_code == 401:
        raise XAIAPIError("xAI API authentication failed")
    if response.status_code not in (200, 201):
        raise XAIAPIError(f"xAI API error: HTTP {response.status_code}")

    body = response.json()

    # Responses API returns output array with message items
    try:
        for item in body["output"]:
            if item.get("type") == "message":
                for content in item.get("content", []):
                    if content.get("type") == "output_text":
                        return content["text"]
        # Fallback: try to find any text content
        raise KeyError("No output_text found")
    except (KeyError, IndexError, TypeError):
        raise XAIAPIError("Unexpected response format from xAI API")
```

**Step 2: Run existing tests to see what breaks**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_tweets_api.py::test_grok_endpoint -v`
Expected: FAIL — mock return value is a string but the function signature now has extra params

---

### Task 2: Update router to pass tweet_id and url to grok_api

**Files:**
- Modify: `backend/app/routers/tweets.py:131-153`

**Step 1: Update the `fetch_grok` endpoint**

In `backend/app/routers/tweets.py`, change line 146 from:

```python
        context = await fetch_grok_context(tweet.text, tweet.author_handle)
```

to:

```python
        context = await fetch_grok_context(
            tweet.text, tweet.author_handle, tweet.tweet_id, tweet.url
        )
```

**Step 2: Run tests to verify nothing else broke**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_tweets_api.py -v`
Expected: Tests pass (mock still patches the function, signature is backward-compatible with defaults)

**Step 3: Commit backend changes**

```bash
git add backend/app/services/grok_api.py backend/app/routers/tweets.py
git commit -m "feat: switch grok context to Responses API with x_search"
```

---

### Task 3: Update backend tests for new function signature

**Files:**
- Modify: `backend/tests/test_tweets_api.py:212-246`

**Step 1: Update the mock assertion in test_grok_endpoint**

The mock already patches `fetch_grok_context` and returns a string, which is correct. But verify the mock is being called with the new arguments. After line 225 (`assert resp.json()["grok_context"] == ...`), add a check:

```python
        mock_grok.assert_called_once_with(
            "Claude 4 is amazing",
            "karpathy",
            "grok1",
            "https://x.com/karpathy/status/123456",
        )
```

**Step 2: Run the test**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_tweets_api.py::test_grok_endpoint -v`
Expected: PASS

**Step 3: Commit**

```bash
git add backend/tests/test_tweets_api.py
git commit -m "test: verify grok endpoint passes tweet_id and url"
```

---

### Task 4: Install react-markdown and remark-gfm in frontend

**Files:**
- Modify: `frontend/package.json` (via npm install)

**Step 1: Install dependencies**

```bash
cd frontend && npm install react-markdown remark-gfm
```

**Step 2: Verify TypeScript is happy**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore: add react-markdown and remark-gfm"
```

---

### Task 5: Replace raw Grok context display with styled markdown panel

**Files:**
- Modify: `frontend/src/components/TweetDetailModal.tsx:1-7` (imports) and `:425-495` (Grok context section)

**Step 1: Add imports**

At the top of `TweetDetailModal.tsx`, add after existing imports:

```typescript
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
```

**Step 2: Replace the Grok context display section**

Replace lines 425-495 (the entire `{/* 3. Grok context section */}` block) with:

```tsx
          {/* 3. Grok context section */}
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {/* Grok icon */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M2 12C2 6.48 6.48 2 12 2s10 4.48 10 10-4.48 10-10 10S2 17.52 2 12zm10-6l1.5 3.5L17 11l-3.5 1.5L12 16l-1.5-3.5L7 11l3.5-1.5L12 6z"
                    fill="currentColor"
                  />
                </svg>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                  }}
                >
                  Grok Context
                </span>
              </div>
              <button
                onClick={() => grokMutation.mutate({ id: tweet.id, force: !!grokContext })}
                disabled={grokMutation.isPending}
                style={{
                  background: grokMutation.isPending ? 'var(--bg-elevated)' : 'var(--accent-muted)',
                  border: `1px solid ${grokMutation.isPending ? 'var(--border)' : 'var(--accent)'}`,
                  borderRadius: 'var(--radius-md)',
                  color: grokMutation.isPending ? 'var(--text-tertiary)' : 'var(--accent-hover)',
                  padding: '5px 12px',
                  fontSize: 12,
                  cursor: grokMutation.isPending ? 'default' : 'pointer',
                  fontFamily: 'var(--font-body)',
                  transition: 'all 0.15s ease',
                }}
              >
                {grokMutation.isPending
                  ? 'Loading...'
                  : grokContext
                    ? 'Refresh'
                    : 'Get Grok Context'}
              </button>
            </div>

            {grokMutation.isError && (
              <div
                style={{
                  fontSize: 12,
                  color: '#ef4444',
                  marginBottom: 8,
                }}
              >
                Failed to fetch Grok context. Make sure XAI_API_KEY is configured.
              </div>
            )}

            {grokContext && (
              <div
                style={{
                  background: '#16181c',
                  border: '1px solid #2f3336',
                  borderRadius: 16,
                  padding: '16px 20px',
                  color: '#e7e9ea',
                  fontSize: 14,
                  lineHeight: 1.6,
                }}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => (
                      <h1 style={{ fontSize: 18, fontWeight: 700, color: '#e7e9ea', margin: '16px 0 8px' }}>{children}</h1>
                    ),
                    h2: ({ children }) => (
                      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e7e9ea', margin: '14px 0 6px' }}>{children}</h2>
                    ),
                    h3: ({ children }) => (
                      <h3 style={{ fontSize: 15, fontWeight: 600, color: '#e7e9ea', margin: '12px 0 4px' }}>{children}</h3>
                    ),
                    p: ({ children }) => (
                      <p style={{ margin: '0 0 10px', color: '#e7e9ea', lineHeight: 1.6 }}>{children}</p>
                    ),
                    ul: ({ children }) => (
                      <ul style={{ margin: '0 0 10px', paddingLeft: 20, color: '#e7e9ea' }}>{children}</ul>
                    ),
                    ol: ({ children }) => (
                      <ol style={{ margin: '0 0 10px', paddingLeft: 20, color: '#e7e9ea' }}>{children}</ol>
                    ),
                    li: ({ children }) => (
                      <li style={{ marginBottom: 4, lineHeight: 1.5 }}>{children}</li>
                    ),
                    strong: ({ children }) => (
                      <strong style={{ fontWeight: 700, color: '#ffffff' }}>{children}</strong>
                    ),
                    em: ({ children }) => (
                      <em style={{ color: '#9ca3af' }}>{children}</em>
                    ),
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#1d9bf0', textDecoration: 'none' }}
                        onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                        onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                      >
                        {children}
                      </a>
                    ),
                    blockquote: ({ children }) => (
                      <blockquote
                        style={{
                          borderLeft: '3px solid #1d9bf0',
                          paddingLeft: 12,
                          margin: '8px 0',
                          color: '#9ca3af',
                        }}
                      >
                        {children}
                      </blockquote>
                    ),
                    code: ({ children }) => (
                      <code
                        style={{
                          background: '#2f3336',
                          padding: '2px 6px',
                          borderRadius: 4,
                          fontSize: 13,
                          color: '#e7e9ea',
                        }}
                      >
                        {children}
                      </code>
                    ),
                  }}
                >
                  {grokContext}
                </ReactMarkdown>
              </div>
            )}
          </div>
```

**Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/src/components/TweetDetailModal.tsx
git commit -m "feat: render grok context as styled markdown matching X panel"
```

---

### Task 6: Final verification

**Step 1: Run all backend tests**

```bash
backend/.venv/bin/python -m pytest backend/tests/ -q
```
Expected: All pass

**Step 2: Run frontend TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors

**Step 3: Commit any remaining changes and verify clean state**

```bash
git status
```
