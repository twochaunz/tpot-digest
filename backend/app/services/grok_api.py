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
