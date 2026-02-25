"""xAI Grok API client for fetching tweet context."""

from __future__ import annotations

import httpx

from app.config import settings

XAI_API_BASE = "https://api.x.ai/v1"


class GrokAPIError(Exception):
    """Raised when the Grok API returns an error or is misconfigured."""
    pass


async def fetch_grok_context(tweet_url: str) -> str:
    """Call Grok API to get context about a tweet.

    Args:
        tweet_url: Full URL to the tweet (e.g. https://x.com/user/status/123)

    Returns:
        The Grok response text.
    """
    if not settings.xai_api_key:
        raise GrokAPIError("XAI_API_KEY is not configured")

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{XAI_API_BASE}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.xai_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "grok-4-1-fast-reasoning",
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            f"Explain this X post: {tweet_url}\n\n"
                            "- Include relevant context, backstory, and discourse happening around this post\n"
                            "- Cover sentiment: how are people reacting? Any sarcasm, ratio, pushback?\n"
                            "- Note any parent tweet/thread context if this is a reply or quote tweet\n"
                            "- Who are the key figures involved and why does that matter?\n"
                            "- Keep it concise — bullet points, no fluff"
                        ),
                    }
                ],
            },
        )

    if resp.status_code != 200:
        raise GrokAPIError(f"Grok API returned {resp.status_code}: {resp.text}")

    data = resp.json()
    choices = data.get("choices", [])
    if not choices:
        raise GrokAPIError("Grok API returned no choices")

    return choices[0]["message"]["content"]
