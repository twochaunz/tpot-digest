"""Multi-provider script generation service.

Routes generation calls to xAI (Grok) or Anthropic (Claude) APIs
based on the model name. Parses the response into structured JSON blocks.
"""

from __future__ import annotations

import json
import re

import httpx

from app.config import settings

XAI_API_BASE = "https://api.x.ai/v1"
ANTHROPIC_API_BASE = "https://api.anthropic.com/v1"

_grok_client = httpx.AsyncClient(timeout=httpx.Timeout(120.0))
_anthropic_client = httpx.AsyncClient(timeout=httpx.Timeout(120.0))

CATEGORY_ORDER = ["context", "kek", "signal-boost", "pushback", "hot-take"]

DEFAULT_STYLE_GUIDE = """PURPOSE:
- This is a value add — within 20 seconds the viewer should get MORE than if they read all the tweets and articles themselves
- Be interesting. Scratch an itch, don't give a full blown massage
- Not sensationalism, not boring regurgitation

STRUCTURE:
- Don't parrot the headline or tweet text — explain what's actually going on
- If the topic is obscure or super niche, give background on the OG post, the author, or any relevant parties so the viewer understands why it matters
- Let the tweets do the heavy lifting for opinions — the script sets up context, tweets show the proof

CATEGORIES ARE INTERNAL ONLY:
- The categories (context, kek, signal-boost, pushback, hot-take) are for YOUR reference to understand tweet roles — NEVER use these words in the script
- Describe reactions naturally: "people celebrated...", "critics pushed back...", "the joke that took off was...", "one spicy take stood out..."
- Reference specific people/entities when they're central to the story"""


class ScriptGeneratorError(Exception):
    pass


def _is_grok_model(model: str) -> bool:
    return model.startswith("grok-")


def _is_claude_model(model: str) -> bool:
    return model.startswith("claude-")


def build_prompt(
    topic_title: str,
    og_tweet: dict | None,
    tweets: list[dict],
    style_guide: str,
    previous_script: list[dict] | None = None,
    feedback: str | None = None,
) -> str:
    parts = [
        "You are writing a narrative summary of a tech discourse topic for a daily digest.",
        "",
        "STYLE GUIDE:",
        style_guide or DEFAULT_STYLE_GUIDE,
        "",
        f"TOPIC: {topic_title}",
    ]

    if og_tweet:
        parts.append("")
        parts.append("OG POST:")
        parts.append(f"- Text: {og_tweet.get('text', '')}")
        parts.append(f"- URL: {og_tweet.get('url', '')}")
        parts.append(f"- Tweet ID: {og_tweet.get('tweet_id', '')}")
        if og_tweet.get("grok_context"):
            parts.append(f"- Grok Context: {og_tweet['grok_context']}")

    # Group tweets by category
    by_category: dict[str, list[dict]] = {}
    for t in tweets:
        cat = t.get("category") or "uncategorized"
        by_category.setdefault(cat, []).append(t)

    parts.append("")
    parts.append("TWEETS IN THIS TOPIC (grouped by category):")

    for cat in CATEGORY_ORDER + ["uncategorized"]:
        group = by_category.get(cat, [])
        if not group:
            continue
        parts.append(f"\n[{cat}]")
        for t in group:
            parts.append(f"- Author: @{t.get('author_handle', 'unknown')}")
            parts.append(f"  Text: {t.get('text', '')}")
            parts.append(f"  Tweet ID: {t.get('tweet_id', '')}")
            if t.get("grok_context"):
                parts.append(f"  Grok Context: {t['grok_context']}")

    if previous_script and feedback:
        parts.append("")
        parts.append("PREVIOUS SCRIPT VERSION:")
        parts.append(json.dumps(previous_script))
        parts.append("")
        parts.append(f"USER FEEDBACK: {feedback}")

    parts.append("")
    parts.append("Return a JSON array of blocks. Each block is either:")
    parts.append('- {"type": "text", "text": "narrative prose"}')
    parts.append('- {"type": "tweet", "tweet_id": "123456"}')
    parts.append("")
    parts.append("INSTRUCTIONS:")
    parts.append("- Start with a hook — make the viewer immediately curious or invested")
    parts.append("- Do NOT repeat the OG tweet's text — instead explain the background and why it matters")
    parts.append("- Place tweets as evidence at natural moments in the narrative")
    parts.append("- Use the category groupings to shape flow (context first, then reactions, pushback, hot takes) but NEVER mention category names in prose")
    parts.append("- You do NOT need every tweet. Aggregate similar sentiment into natural phrases ('the consensus was...', 'critics argued...') and embed only 1-2 representative tweets as proof")
    parts.append("- Every sentence must earn its place: educate, evoke, or entertain — strip anything that doesn't")
    parts.append("- Only reference tweet_ids from the list above")
    parts.append("- Return ONLY the JSON array, no other text")

    return "\n".join(parts)


def _parse_blocks(raw: str) -> list[dict]:
    """Extract JSON array from model response, handling markdown fences."""
    text = raw.strip()
    # Strip markdown code fences if present
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if match:
        text = match.group(1).strip()
    try:
        blocks = json.loads(text)
    except json.JSONDecodeError as e:
        raise ScriptGeneratorError(f"Failed to parse model response as JSON: {e}\nRaw: {raw[:500]}")
    if not isinstance(blocks, list):
        raise ScriptGeneratorError(f"Expected JSON array, got {type(blocks).__name__}")
    return blocks


async def generate_script(model: str, prompt: str) -> list[dict]:
    """Call the chosen model and return parsed script blocks."""
    if _is_grok_model(model):
        return await _call_grok(model, prompt)
    elif _is_claude_model(model):
        return await _call_claude(model, prompt)
    else:
        raise ScriptGeneratorError(f"Unsupported model: {model}")


async def _call_grok(model: str, prompt: str) -> list[dict]:
    if not settings.xai_api_key:
        raise ScriptGeneratorError("XAI_API_KEY is not configured")

    resp = await _grok_client.post(
        f"{XAI_API_BASE}/chat/completions",
        headers={
            "Authorization": f"Bearer {settings.xai_api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
        },
    )

    if resp.status_code != 200:
        raise ScriptGeneratorError(f"Grok API returned {resp.status_code}: {resp.text}")

    data = resp.json()
    choices = data.get("choices", [])
    if not choices:
        raise ScriptGeneratorError("Grok API returned no choices")

    return _parse_blocks(choices[0]["message"]["content"])


async def _call_claude(model: str, prompt: str) -> list[dict]:
    if not settings.anthropic_api_key:
        raise ScriptGeneratorError("ANTHROPIC_API_KEY is not configured")

    resp = await _anthropic_client.post(
        f"{ANTHROPIC_API_BASE}/messages",
        headers={
            "x-api-key": settings.anthropic_api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": prompt}],
        },
    )

    if resp.status_code != 200:
        raise ScriptGeneratorError(f"Anthropic API returned {resp.status_code}: {resp.text}")

    data = resp.json()
    content_blocks = data.get("content", [])
    if not content_blocks:
        raise ScriptGeneratorError("Anthropic API returned no content")

    return _parse_blocks(content_blocks[0]["text"])
