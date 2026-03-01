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
                        f"Explain this X post to me: {tweet_url}\n\n"
                        "## Guidelines for an excellent response\n"
                        "- Include only context, backstory, or world events that are directly relevant "
                        "and surprising, informative, educational, or entertaining.\n"
                        "- Avoid stating the obvious or simple reactions.\n"
                        "- Provide truthful and based insights, challenging mainstream narratives "
                        "if necessary, but remain objective.\n"
                        "- Incorporate relevant scientific studies, data, or evidence to support "
                        "your analysis; prioritize peer-reviewed research and be critical of sources "
                        "to avoid bias.\n\n"
                        "## Source credibility — STRICT\n"
                        "- ONLY cite or reference reputable, established sources: major news outlets, "
                        "official government/institutional accounts, verified journalists, recognized "
                        "domain experts, peer-reviewed research, or official press releases.\n"
                        "- DO NOT cite random tweets, low-follower accounts, nobody accounts, "
                        "unverified personal opinions, engagement-farming posts, or tweets with "
                        "negligible interactions (few likes/retweets).\n"
                        "- If the only available sources on a claim are unverified tweets or "
                        "anonymous accounts, explicitly flag the claim as unverified rather than "
                        "presenting it as fact.\n"
                        "- Prefer primary sources (official statements, documents, data) over "
                        "secondary commentary.\n\n"
                        "## Formatting\n"
                        "- Write your response as 5 short bullet points. Do not use nested bullet points.\n"
                        "- Prioritize conciseness; Ensure each bullet point conveys a single, crucial idea.\n"
                        "- Use simple, information-rich sentences. Avoid purple prose.\n"
                        "- Exclude post/thread IDs and concluding summaries."
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
