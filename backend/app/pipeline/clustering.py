from app.pipeline.llm import llm_structured_output


async def cluster_into_topics(tweets: list[dict]) -> list[dict]:
    """
    Pass 1: Group tweets into top-level topics.

    Takes a list of tweet dicts (with text, author_handle, engagement, etc.)
    Returns a list of topic dicts:
    [
        {
            "title": "Claude 4 Launch",
            "summary": "Anthropic releases Claude 4 with new benchmarks...",
            "sentiment": "mixed",
            "tweet_indices": [0, 1, 5, 8],  # indices into the input tweets list
            "tags": ["launch", "AI", "Anthropic"]
        },
        ...
    ]
    """
    if not tweets:
        return []

    # Build tweet summaries for the LLM
    tweet_summaries = []
    for i, t in enumerate(tweets):
        engagement = t.get("engagement", {})
        likes = engagement.get("likes", 0)
        retweets = engagement.get("retweets", 0)
        tweet_summaries.append(
            f"[{i}] @{t.get('author_handle', 'unknown')}: {t.get('text', '')[:280]} "
            f"(likes: {likes}, retweets: {retweets})"
        )

    tweets_text = "\n".join(tweet_summaries)

    system_prompt = """You are a tech discourse analyst. Your job is to identify trending topics from a batch of tweets.

Group the tweets into distinct topics. Each topic should represent a coherent subject that multiple tweets are discussing.

Rules:
- Only create a topic if at least 2 tweets are about it
- Focus on tech, AI, startups, and adjacent topics
- Give each topic a clear, concise title
- Provide a brief summary of the discourse
- Tag with relevant categories
- Assess overall sentiment (positive, negative, neutral, mixed)

Return valid JSON array. No explanation outside the JSON."""

    user_prompt = f"""Group these tweets into topics:

{tweets_text}

Return JSON array:
[
  {{
    "title": "Topic Title",
    "summary": "Brief description of what people are discussing",
    "sentiment": "positive|negative|neutral|mixed",
    "tweet_indices": [0, 1, 5],
    "tags": ["tag1", "tag2"]
  }}
]"""

    try:
        result = await llm_structured_output(system_prompt, user_prompt)
        if isinstance(result, list):
            return result
        return []
    except Exception:
        return []


async def cluster_with_fallback(tweets: list[dict]) -> list[dict]:
    """
    Attempt LLM clustering, fall back to simple keyword-based clustering.
    """
    result = await cluster_into_topics(tweets)
    if result:
        return result

    # Fallback: simple keyword clustering
    return simple_keyword_cluster(tweets)


def simple_keyword_cluster(tweets: list[dict]) -> list[dict]:
    """
    Simple fallback clustering based on common keywords/entities.
    Used when LLM is unavailable.
    """
    from collections import defaultdict

    # Extract common words/phrases (simple approach)
    keyword_groups: dict[str, list[int]] = defaultdict(list)

    # Common tech entities to look for
    entities = [
        "openai", "anthropic", "claude", "gpt", "gemini", "google", "meta", "llama",
        "apple", "microsoft", "nvidia", "tesla", "elon", "sam altman", "funding",
        "layoff", "launch", "benchmark", "open source", "regulation", "safety",
    ]

    for i, tweet in enumerate(tweets):
        text = tweet.get("text", "").lower()
        matched = False
        for entity in entities:
            if entity in text:
                keyword_groups[entity].append(i)
                matched = True
                break  # One topic per tweet for simplicity
        if not matched:
            keyword_groups["other"].append(i)

    # Convert to topic format (only groups with 2+ tweets)
    topics = []
    for keyword, indices in keyword_groups.items():
        if len(indices) >= 2 and keyword != "other":
            topics.append({
                "title": keyword.title(),
                "summary": f"Tweets discussing {keyword}",
                "sentiment": "neutral",
                "tweet_indices": indices,
                "tags": [keyword],
            })

    return topics
