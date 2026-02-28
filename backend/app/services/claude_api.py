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

- context — Adds factual information, news developments, confirmations, or measured perspective that helps understand the situation. The tweet informs rather than argues.
  Examples: "Confirmed via a spokesperson. OpenAI has the same red lines as Anthropic" (reporting a fact); "BREAKING: Sam Altman and OpenAI are working on a deal between Anthropic and the Pentagon" (news development)

- pushback — Opposes, criticizes, or challenges the position/action in the OG post. Includes showing real-world opposition or taking a clear side against the OG position.
  Examples: "OAI waits to see where wind blows... anthropic doesn't flinch" (critical analysis opposing the OG position); sharing video of protest art supporting the opposing side (showing physical opposition)

- hot-take — Strong, provocative opinion that adds a new angle or escalates the discourse. Goes beyond reporting or simple support/opposition — the author is making a bold claim or forward-looking warning.
  Examples: "It's extremely good that Anthropic has not backed down... in the future, there will be much more challenging situations" (strong opinion with provocative forward-looking warning)

- echo — Shares or amplifies the news without adding meaningful perspective. Essentially a retweet with minimal commentary.
  Examples: "Wow, this is huge" / "Everyone needs to see this" / a plain repost with no added take

- kek — Humor, irony, memes, or sarcastic commentary about the topic.
  Examples: "I cannot wait until the White House changes hands and all of you ghouls switch back..." (biting irony)

IMPORTANT: The OG post represents a POSITION or ACTION. Categorize each tweet based on how it engages with that position within the broader discourse. Someone opposing the OG position is pushback, not signal-boost. Someone adding facts is context, even if those facts favor one side. Someone with a strong personal opinion is a hot-take."""


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
   - Topic titles must be 10 words or less. State what happened clearly, directly, and digestibly.
   - Example good titles: "Hegseth Clashes With Anthropic Over AI Safety", "GPT-5 Benchmarks Leak Sparks Debate"
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


async def categorize_single_tweet(
    topic_title: str,
    og_text: str,
    og_grok_context: str | None,
    tweet_text: str,
    tweet_grok_context: str | None,
) -> str:
    """Categorize a single tweet relative to the topic. Returns category key."""
    og_ctx = f"\nGrok context: {og_grok_context}" if og_grok_context else ""
    tw_ctx = f"\nGrok context: {tweet_grok_context}" if tweet_grok_context else ""

    prompt = f"""You are categorizing a tweet within a topic for a daily digest.

Topic: "{topic_title}"

OG Post (the tweet that started this topic):
{og_text}
{og_ctx}

Tweet to categorize:
{tweet_text}
{tw_ctx}

{CATEGORIES_DESCRIPTION}

How does this tweet relate to the topic "{topic_title}"? Pick exactly one category.

Respond with ONLY the category key (e.g. "context", "pushback", etc.), nothing else."""

    client = _get_client()
    response = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=32,
        messages=[{"role": "user", "content": prompt}],
    )

    category = response.content[0].text.strip().lower().strip('"')
    valid = {"context", "echo", "pushback", "hot-take", "kek"}
    if category not in valid:
        logger.warning("Claude returned invalid category '%s', defaulting to 'context'", category)
        category = "context"
    return category


async def recategorize_topic(
    topic_title: str,
    og_text: str,
    og_grok_context: str | None,
    tweets: list[dict],
) -> dict[int, str]:
    """Re-categorize all tweets in a topic relative to the OG post.

    Args:
        topic_title: The topic title set by the user.
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

Topic: "{topic_title}"

OG Post (the tweet that started this topic):
{og_text}
{og_ctx}

Tweets to categorize:
{tweets_text}

{CATEGORIES_DESCRIPTION}

For each tweet, decide how it relates to the topic "{topic_title}".

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
