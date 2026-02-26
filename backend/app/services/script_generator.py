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
- Give the viewer MORE than reading the tweets themselves — in under 30 seconds per topic
- Not sensationalism. Not embellishment. Not boring regurgitation. Just the story, told efficiently.

WRITING RULES:
- Get to the point immediately. No wind-up clauses, no scene-setting, no throat-clearing before the actual information.
  BAD: "San Francisco's AI startup scene just got a wild spotlight in Harper's Magazine, where writer Sam Kriss dives into the world of highly agentic founders"
  GOOD: "Writer Sam Kriss made waves in tech profiling the personalities and chaos fueling SF's AI startups."
- Be specific. Say what someone actually did or what specifically happened — not vague adjectives about them.
  BAD: "eccentric, hyper-driven tech bros betting it all on artificial intelligence"
  GOOD: "a founder whose obsessive PC build rapidly grew his infamy in tech"
- Do NOT editorialize unless a tweet is about to back it up. Statements like "this isn't just another tech puff piece" or "these aren't your typical stereotypes — they're raw and chaotic" are the script inserting its own opinion. That's the tweets' job, not the script's.
- Every sentence must add new information. If a sentence just restates, summarizes, or evaluates what was already said, cut it. If the useful parts can be folded into an adjacent sentence, do that instead of giving it its own sentence.
- No decorative closers. Don't wrap topics with sweeping statements like "painting a picture of an industry teetering between genius and grift." Just move on.
- Don't parrot the headline or tweet text — paraphrase naturally and explain what's actually going on.
- Don't ask rhetorical questions.
- Don't give the viewer exercises like "Imagine a world...". If comparing, reference real things — previous day topics or known sentiment in tech with a reputable source.
- If the topic is obscure or niche, give brief background on the OG post, author, or relevant parties so the viewer understands why it matters.
- Let the tweets do the heavy lifting for opinions — the script sets up context, tweets show the proof.

CATEGORY USAGE:
- The categories (context, kek, signal-boost, pushback, hot-take) are for YOUR reference to understand tweet roles
- NEVER use "signal-boost" or "kek" in the script — these are internal labels only
- You CAN use "context", "pushback", and "hot take" in prose when it's natural (e.g. "the pushback was immediate...", "one hot take stood out...")
- Describe reactions naturally: "people celebrated...", "critics pushed back...", "people had crazy reactions to..."
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
        "You are writing a short, direct script for a tech discourse topic in a daily video digest.",
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
    parts.append('- Open with a direct statement — who did what, or what happened. One clause, no buildup.')
    parts.append('  BAD: "The timeline was in turmoil after a bombshell dropped from..."')
    parts.append('  GOOD: "OpenAI launched o3." / "Writer Sam Kriss made waves in tech profiling SF\'s AI startup chaos."')
    parts.append("- Do NOT repeat the OG tweet's text. Paraphrase naturally.")
    parts.append("- Place tweets as evidence — they prove what the script claims.")
    parts.append("- Use category groupings to guide flow (context first, then reactions, pushback, hot takes) but don't force category names where they don't fit naturally. Change order if it tells a better story.")
    parts.append("- You do NOT need every tweet. Aggregate similar sentiment into short phrases ('the consensus was...', 'critics argued...') and embed only 2-3 representative tweets.")
    parts.append("- Every sentence should inform, clarify, or set up a tweet. Cut anything that doesn't.")
    parts.append('- Only reference tweet_ids from the list above, except for real comparisons tech people would know.')
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
