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
                    "role": "user",
                    "content": (
                        f"Analyze this X post: {tweet_url}\n\n"
                        "Give me the context behind this post as if I pressed the Grok button next to it on X. "
                        "What is this about? What's the backstory? What are people saying in the replies and quotes? "
                        "Who are the key people involved and why does it matter?\n\n"
                        "Keep it concise — bullet points, no fluff."
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
