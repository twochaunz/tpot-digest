"""xAI Grok API client for fetching tweet context."""

from __future__ import annotations

import httpx

from app.config import settings

XAI_API_BASE = "https://api.x.ai/v1"


class XAIAPIError(Exception):
    """Raised when the xAI API returns an error or is misconfigured."""

    pass


async def fetch_grok_context(text: str, author_handle: str) -> str:
    """Call the xAI Grok API to get context about a tweet.

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

    payload = {
        "model": "grok-3",
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are Grok, analyzing a tweet. Provide context: "
                    "what is this about, why is it significant, "
                    "what's the broader conversation."
                ),
            },
            {
                "role": "user",
                "content": f"Tweet by @{author_handle}:\n\n{text}",
            },
        ],
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{XAI_API_BASE}/chat/completions",
            headers=headers,
            json=payload,
            timeout=30.0,
        )

    if response.status_code == 429:
        raise XAIAPIError("xAI API rate limit exceeded")
    if response.status_code == 401:
        raise XAIAPIError("xAI API authentication failed")
    if response.status_code not in (200, 201):
        raise XAIAPIError(f"xAI API error: HTTP {response.status_code}")

    body = response.json()

    try:
        return body["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        raise XAIAPIError("Unexpected response format from xAI API")
