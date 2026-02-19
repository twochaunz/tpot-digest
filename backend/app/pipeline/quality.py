import math


def compute_quality_score(
    tweet: dict,
    seed_handles: set[str],
    blocked: set[str] | None = None,
    boosted: set[str] | None = None,
    relevance_threshold: float = 0.3,
) -> float:
    """
    Compute a quality score (0.0-1.0) for a tweet.

    Signals:
    1. Blocked accounts -> 0.0
    2. Boosted accounts -> 1.0
    3. Network proximity (mutual follows with seed list)
    4. Account profile scoring (follower count)
    5. Slop detection (high posting frequency -> diluted score)
    6. Engagement strength
    """
    blocked = blocked or set()
    boosted = boosted or set()

    author = tweet.get("author_handle", "")

    # Hard filters
    if author in blocked:
        return 0.0
    if author in boosted:
        return 1.0

    scores = []

    # Network proximity: how many mutual follows with seed list
    mutual_follows = tweet.get("mutual_follows", 0)
    seed_count = len(seed_handles) if seed_handles else 1
    network_score = min(mutual_follows / max(seed_count * 0.3, 1), 1.0)
    scores.append(("network", network_score, 0.35))

    # Is the author in the seed list?
    if author in seed_handles:
        scores.append(("is_seed", 1.0, 0.25))
    else:
        scores.append(("is_seed", 0.0, 0.25))

    # Follower count scoring (log scale)
    follower_count = tweet.get("follower_count", 0)
    if follower_count > 0:
        follower_score = min(math.log10(follower_count) / 6, 1.0)  # 1M followers = 1.0
    else:
        follower_score = 0.1
    scores.append(("followers", follower_score, 0.15))

    # Slop detection: high posting frequency dilutes score
    tweets_24h = tweet.get("author_tweet_count_24h", 0)
    if tweets_24h > 20:
        slop_penalty = max(1.0 - (tweets_24h - 20) / 40, 0.0)
    else:
        slop_penalty = 1.0
    scores.append(("slop", slop_penalty, 0.15))

    # Engagement strength
    engagement = tweet.get("engagement", {})
    total_engagement = sum([
        engagement.get("likes", 0),
        engagement.get("retweets", 0) * 2,
        engagement.get("replies", 0) * 3,
    ])
    if total_engagement > 0:
        engagement_score = min(math.log10(total_engagement) / 5, 1.0)  # 100K = 1.0
    else:
        engagement_score = 0.05
    scores.append(("engagement", engagement_score, 0.10))

    # Weighted average
    total = sum(score * weight for _, score, weight in scores)
    return round(total, 4)


def apply_diversity_cap(
    tweets_by_topic: list[dict],
    max_author_pct: float = 0.20,
) -> list[dict]:
    """
    Enforce diversity cap: no single author can represent more than max_author_pct
    of tweets within a topic. Remove excess tweets from over-represented authors
    (keeping their highest-scored ones).
    """
    if not tweets_by_topic:
        return []

    max_per_author = max(1, int(len(tweets_by_topic) * max_author_pct))

    # Sort by quality_score descending to keep best tweets
    sorted_tweets = sorted(
        tweets_by_topic, key=lambda t: t.get("quality_score", 0), reverse=True
    )

    author_counts: dict[str, int] = {}
    result = []

    for tweet in sorted_tweets:
        author = tweet.get("author_handle", "")
        count = author_counts.get(author, 0)
        if count < max_per_author:
            result.append(tweet)
            author_counts[author] = count + 1

    return result


async def filter_tweets(
    tweets: list[dict],
    seed_handles: set[str],
    blocked: set[str] | None = None,
    boosted: set[str] | None = None,
    relevance_threshold: float = 0.3,
) -> list[dict]:
    """
    Run tweets through the quality pipeline.
    Returns only tweets above the relevance threshold, scored and sorted.
    """
    scored = []
    for tweet in tweets:
        score = compute_quality_score(
            tweet, seed_handles, blocked, boosted, relevance_threshold
        )
        tweet["quality_score"] = score
        if score >= relevance_threshold:
            scored.append(tweet)

    # Sort by quality score descending
    scored.sort(key=lambda t: t["quality_score"], reverse=True)
    return scored
