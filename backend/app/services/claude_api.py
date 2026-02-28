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

- context — NEUTRAL factual reporting only. Breaking news, confirmations, data. The author is not taking a side — they are reporting what happened.
  Examples: "Confirmed via a spokesperson. OpenAI has the same red lines as Anthropic" (neutral confirmation); "BREAKING: Sam Altman and OpenAI are working on a deal between Anthropic and the Pentagon, per WSJ" (straight news report)
  NOT context: any tweet where the author's framing shows they oppose or support the OG position

- pushback — The author opposes, criticizes, or sides AGAINST the OG post's position/action. This includes critical analysis, showing real-world opposition, or any framing that clearly disapproves of what the OG poster did or stands for.
  Examples: "OAI waits to see where wind blows... anthropic doesn't flinch, get lots of credit" (the framing praises Anthropic and criticizes OAI — this is pushback against the OG position, NOT neutral context); sharing video of chalk art/protests supporting the opposing side (showing people oppose the OG position)
  Key test: Does the author's tone, framing, or content show they disagree with the OG position? If yes, it's pushback.

- hot-take — Strong, provocative opinion that adds a NEW ANGLE or escalates the discourse. The author isn't just opposing or supporting — they're making a bold claim, prediction, or reframing the debate.
  Examples: "It's extremely good that Anthropic has not backed down... in the future, there will be much more challenging situations" (bold opinion + provocative future warning that reframes the stakes)

- echo — Shares or amplifies without adding perspective. Minimal commentary, essentially a retweet.
  Examples: "Wow, this is huge" / "Everyone needs to see this" / a plain repost

- kek — Humor, irony, memes, sarcastic commentary.
  Examples: "I cannot wait until the White House changes hands and all of you ghouls switch back..." (biting irony)

CRITICAL DISTINCTION between context and pushback: If a tweet contains facts BUT the author's framing, word choice, or presentation takes a side against the OG position, it is PUSHBACK, not context. Context is strictly neutral reporting. Most opinion-laden tweets are either pushback or hot-take, not context."""


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

OG Post (the tweet that started this topic — its author's stance/action is the reference point):
{og_text}
{og_ctx}

IMPORTANT: Use the topic title AND Grok context to understand the OG author's position/action. The OG tweet text alone may be short or ambiguous — the Grok context explains what actually happened. Categories like "pushback" are relative to the OG author's position/action, not the topic in general.

Tweet to categorize:
{tweet_text}
{tw_ctx}

{CATEGORIES_DESCRIPTION}

Given the OG author's position/action in topic "{topic_title}", what category best describes this tweet?

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
