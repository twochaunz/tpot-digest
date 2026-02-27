"""Claude API client for tweet classification and topic categorization."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from functools import lru_cache

import anthropic

from app.config import settings

logger = logging.getLogger(__name__)

CATEGORIES_DESCRIPTION = """Categories (pick exactly one):
- context — adds background info, explains, provides data or evidence about the OG post
- signal-boost — amplifies, agrees with, or supports the OG post
- pushback — disagrees with, challenges, or counters the OG post
- hot-take — strong or provocative opinion related to the OG post
- kek — humor, memes, jokes, or ironic commentary about the OG post"""


@dataclass
class TopicCandidate:
    topic_id: int
    title: str
    date: str
    og_text: str
    og_grok_context: str | None
    category_summary: str
    similarity: float


@lru_cache(maxsize=1)
def _get_client() -> anthropic.AsyncAnthropic:
    return anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)


async def classify_tweet(
    tweet_text: str,
    grok_context: str | None,
    candidates: list[TopicCandidate],
) -> dict:
    """Classify a tweet into a topic and category.

    Returns dict with keys: topic_id, new_topic_title, category,
    related_topic_id, confidence.
    """
    # Build candidate descriptions
    if candidates:
        candidate_lines = []
        for c in candidates:
            og_snippet = c.og_text[:280] if c.og_text else "(no OG text)"
            ctx_snippet = f"\n    Grok context: {c.og_grok_context[:200]}" if c.og_grok_context else ""
            candidate_lines.append(
                f"  - Topic ID {c.topic_id}: \"{c.title}\" ({c.date})\n"
                f"    OG post: {og_snippet}{ctx_snippet}\n"
                f"    Current tweets: {c.category_summary}\n"
                f"    Similarity: {c.similarity:.2f}"
            )
        candidates_text = "Candidate topics (ranked by similarity):\n" + "\n".join(candidate_lines)
    else:
        candidates_text = "No candidate topics found. This may need a new topic."

    grok_line = f"\nGrok context about this tweet:\n{grok_context}" if grok_context else ""

    prompt = f"""You are classifying a tweet for a daily digest of Twitter/X discourse.

Tweet text:
{tweet_text}
{grok_line}

{candidates_text}

{CATEGORIES_DESCRIPTION}

Decide:
1. Which topic does this tweet belong to? Pick the best matching topic_id, or suggest a new topic title if none fit.
2. What category best describes how this tweet relates to that topic's OG post?
3. If this relates to a topic from a previous day (cross-day continuation), note the related_topic_id.

Respond with ONLY valid JSON (no markdown, no explanation):
{{"topic_id": <int or null>, "new_topic_title": <string or null>, "category": "<category key>", "related_topic_id": <int or null>, "confidence": <float 0-1>}}"""

    client = _get_client()
    response = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=256,
        messages=[{"role": "user", "content": prompt}],
    )

    text = response.content[0].text.strip()
    # Strip markdown fences if present
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

    return json.loads(text)


async def recategorize_topic(
    og_text: str,
    og_grok_context: str | None,
    tweets: list[dict],
) -> dict[int, str]:
    """Re-categorize all tweets in a topic relative to the OG post.

    Args:
        og_text: The OG post text.
        og_grok_context: Grok context for the OG post.
        tweets: List of dicts with keys: id, text, grok_context.

    Returns:
        Dict mapping tweet_id -> category key.
    """
    og_ctx = f"\nGrok context: {og_grok_context}" if og_grok_context else ""

    tweet_lines = []
    for t in tweets:
        ctx = f" (context: {t['grok_context'][:150]})" if t.get("grok_context") else ""
        tweet_lines.append(f"  - Tweet {t['id']}: {t['text'][:280]}{ctx}")
    tweets_text = "\n".join(tweet_lines)

    prompt = f"""You are categorizing tweets within a topic for a daily digest.

OG Post (the anchor — all tweets are reactions to this):
{og_text}
{og_ctx}

Tweets to categorize:
{tweets_text}

{CATEGORIES_DESCRIPTION}

For each tweet, decide how it relates to the OG post.

Respond with ONLY valid JSON (no markdown):
{{"categories": {{"<tweet_id>": "<category key>", ...}}}}"""

    client = _get_client()
    response = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
    )

    text = response.content[0].text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

    data = json.loads(text)
    return {int(k): v for k, v in data["categories"].items()}
