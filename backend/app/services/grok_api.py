"""xAI Grok API client for fetching tweet context via x_search."""

from __future__ import annotations

import httpx

from app.config import settings

XAI_API_BASE = "https://api.x.ai/v1"

_client = httpx.AsyncClient(timeout=httpx.Timeout(60.0))


class GrokAPIError(Exception):
    """Raised when the Grok API returns an error or is misconfigured."""
    pass


async def fetch_grok_context(tweet_url: str) -> str:
    """Call Grok Responses API with x_search to get context about a tweet.

    Uses the x_search tool so Grok can actually see the post, its replies,
    and surrounding discourse on X — like pressing the Grok button on a post.

    Args:
        tweet_url: Full URL to the tweet (e.g. https://x.com/user/status/123)

    Returns:
        The Grok response text.
    """
    if not settings.xai_api_key:
        raise GrokAPIError("XAI_API_KEY is not configured")

    resp = await _client.post(
        f"{XAI_API_BASE}/responses",
        headers={
            "Authorization": f"Bearer {settings.xai_api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": "grok-4-1-fast-reasoning",
            "input": [
                {
                    "role": "system",
                    "content": (
                        "You summarize X posts for a video producer who covers tech Twitter daily. "
                        "Your summaries help them quickly understand what a post is about and why it matters, "
                        "so they can decide how to talk about it on camera. "
                        "Be direct, specific, and opinionated. No hedging, no filler."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Summarize this X post: {tweet_url}\n\n"
                        "Cover these in order:\n"
                        "1. **What happened** — What is this post saying or announcing? One or two sentences max.\n"
                        "2. **Who** — Who posted it and who are they? Why do they matter in this context? Skip if obvious.\n"
                        "3. **Backstory** — What led to this post? Any prior drama, announcements, or events?\n"
                        "4. **Discourse** — How are people reacting in replies and quotes? Any notable takes, ratio, pushback, or memes?\n"
                        "5. **Why it matters** — Why should anyone care? What's the bigger picture?\n\n"
                        "Use short bullet points under each heading. Skip any section that doesn't apply. "
                        "If it's a shitpost or meme, just say what the joke is and why it's funny."
                    ),
                }
            ],
            "tools": [
                {
                    "type": "x_search",
                }
            ],
        },
    )

    if resp.status_code != 200:
        raise GrokAPIError(f"Grok API returned {resp.status_code}: {resp.text}")

    data = resp.json()

    # Responses API: output is an array, find the message item
    for item in data.get("output", []):
        if item.get("type") == "message":
            for content in item.get("content", []):
                if content.get("type") == "output_text":
                    return content["text"]

    raise GrokAPIError("Grok API returned no text output")
