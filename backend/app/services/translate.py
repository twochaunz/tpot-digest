"""Translation service using Kimi via OpenRouter."""

from __future__ import annotations

import httpx

from app.config import settings

OPENROUTER_BASE = "https://openrouter.ai/api/v1"
KIMI_MODEL = "moonshotai/kimi-k2"

_client = httpx.AsyncClient(timeout=httpx.Timeout(30.0))


class TranslationError(Exception):
    pass


async def translate_text(text: str) -> str:
    """Translate text to English using Kimi via OpenRouter.

    Returns the translated text.
    """
    if not settings.openrouter_api_key:
        raise TranslationError("OpenRouter API key is not configured")

    response = await _client.post(
        f"{OPENROUTER_BASE}/chat/completions",
        headers={
            "Authorization": f"Bearer {settings.openrouter_api_key}",
        },
        json={
            "model": KIMI_MODEL,
            "max_tokens": 1024,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a translator. Translate the given text to English. "
                    "Output ONLY the translation, nothing else. "
                    "Preserve the tone and style of the original.",
                },
                {"role": "user", "content": text},
            ],
        },
    )

    if response.status_code != 200:
        raise TranslationError(f"OpenRouter error: HTTP {response.status_code}")

    body = response.json()
    choices = body.get("choices", [])
    if not choices:
        raise TranslationError("No response from translation model")

    return choices[0]["message"]["content"].strip()
