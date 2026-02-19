import json
import os

import httpx


async def llm_structured_output(system_prompt: str, user_prompt: str) -> dict | list:
    """
    Call an LLM and parse structured JSON from the response.
    Uses Anthropic Claude API by default.
    Falls back to a simple heuristic if no API key is configured.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")

    if not api_key:
        # Return empty result if no API key (for testing/development)
        return []

    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 4096,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_prompt}],
            },
            timeout=60.0,
        )
        response.raise_for_status()
        result = response.json()
        text = result["content"][0]["text"]

        # Extract JSON from response (handle markdown code blocks)
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]

        return json.loads(text.strip())
