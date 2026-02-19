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


async def identify_subtopics(topic_title: str, topic_tweets: list[dict]) -> list[dict]:
    """
    Pass 2: Within a topic, identify distinct narrative threads.

    Returns:
    [
        {
            "title": "Hype & excitement",
            "summary": "People celebrating the launch...",
            "sentiment": "positive",
            "tweet_indices": [0, 2],
            "stance": "supportive"
        },
        {
            "title": "Benchmark manipulation accusations",
            "summary": "Critics questioning the validity...",
            "sentiment": "negative",
            "tweet_indices": [3, 4],
            "stance": "critical"
        }
    ]
    """
    if len(topic_tweets) < 2:
        # Not enough tweets to split into sub-topics
        return [{
            "title": topic_title,
            "summary": topic_tweets[0].get("text", "") if topic_tweets else "",
            "sentiment": "neutral",
            "tweet_indices": list(range(len(topic_tweets))),
            "stance": "neutral",
        }]

    tweet_summaries = []
    for i, t in enumerate(topic_tweets):
        tweet_summaries.append(
            f"[{i}] @{t.get('author_handle', 'unknown')}: {t.get('text', '')[:280]}"
        )

    tweets_text = "\n".join(tweet_summaries)

    system_prompt = """You are analyzing sub-conversations within a trending tech topic.

Given tweets about a specific topic, identify the distinct narrative threads or angles people are taking.

Rules:
- Each sub-topic should represent a different take, angle, or aspect of the main topic
- Assign a stance to each sub-topic (supportive, critical, neutral, analytical, humorous)
- Every tweet must be assigned to exactly one sub-topic
- Minimum 1 sub-topic, but try to find real distinctions
- Assess sentiment per sub-topic

Return valid JSON array only."""

    user_prompt = f"""Topic: "{topic_title}"

Tweets:
{tweets_text}

Identify the distinct sub-conversations. Return JSON array:
[
  {{
    "title": "Sub-topic title",
    "summary": "What this angle is about",
    "sentiment": "positive|negative|neutral|mixed",
    "tweet_indices": [0, 2],
    "stance": "supportive|critical|neutral|analytical|humorous"
  }}
]"""

    try:
        result = await llm_structured_output(system_prompt, user_prompt)
        if isinstance(result, list) and result:
            return result
    except Exception:
        pass

    # Fallback: return single sub-topic with all tweets
    return [{
        "title": topic_title,
        "summary": f"All tweets about {topic_title}",
        "sentiment": "neutral",
        "tweet_indices": list(range(len(topic_tweets))),
        "stance": "neutral",
    }]


def simple_subtopic_split(topic_title: str, topic_tweets: list[dict]) -> list[dict]:
    """
    Simple fallback: split tweets by sentiment indicators.
    Looks for positive vs negative language.
    """
    positive_words = {"amazing", "great", "love", "incredible", "exciting", "awesome", "best", "impressive", "revolutionary"}
    negative_words = {"bad", "terrible", "worse", "manipulated", "flawed", "wrong", "misleading", "fake", "concerned", "worried"}

    positive_indices = []
    negative_indices = []
    neutral_indices = []

    for i, tweet in enumerate(topic_tweets):
        text = tweet.get("text", "").lower()
        pos_count = sum(1 for w in positive_words if w in text)
        neg_count = sum(1 for w in negative_words if w in text)

        if pos_count > neg_count:
            positive_indices.append(i)
        elif neg_count > pos_count:
            negative_indices.append(i)
        else:
            neutral_indices.append(i)

    subtopics = []
    if positive_indices:
        subtopics.append({
            "title": f"{topic_title} - Positive reception",
            "summary": f"Positive takes on {topic_title}",
            "sentiment": "positive",
            "tweet_indices": positive_indices,
            "stance": "supportive",
        })
    if negative_indices:
        subtopics.append({
            "title": f"{topic_title} - Criticism",
            "summary": f"Critical takes on {topic_title}",
            "sentiment": "negative",
            "tweet_indices": negative_indices,
            "stance": "critical",
        })
    if neutral_indices:
        subtopics.append({
            "title": f"{topic_title} - Analysis",
            "summary": f"Analytical takes on {topic_title}",
            "sentiment": "neutral",
            "tweet_indices": neutral_indices,
            "stance": "analytical",
        })

    if not subtopics:
        subtopics.append({
            "title": topic_title,
            "summary": f"All tweets about {topic_title}",
            "sentiment": "neutral",
            "tweet_indices": list(range(len(topic_tweets))),
            "stance": "neutral",
        })

    return subtopics
