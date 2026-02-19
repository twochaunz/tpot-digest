import pytest

from app.pipeline.quality import (
    apply_diversity_cap,
    compute_quality_score,
    filter_tweets,
)


def test_blocked_account_gets_zero():
    tweet = {"author_handle": "spammer"}
    score = compute_quality_score(tweet, set(), blocked={"spammer"})
    assert score == 0.0


def test_boosted_account_gets_one():
    tweet = {"author_handle": "trusted_source"}
    score = compute_quality_score(tweet, set(), boosted={"trusted_source"})
    assert score == 1.0


def test_seed_account_gets_high_score():
    tweet = {
        "author_handle": "karpathy",
        "follower_count": 500000,
        "engagement": {"likes": 1000, "retweets": 200, "replies": 50},
    }
    score = compute_quality_score(tweet, {"karpathy", "sama"})
    assert score > 0.5


def test_unknown_account_low_score():
    tweet = {
        "author_handle": "random_nobody",
        "follower_count": 10,
        "engagement": {"likes": 2},
    }
    score = compute_quality_score(tweet, {"karpathy", "sama"})
    assert score < 0.3


def test_network_proximity_boosts_score():
    tweet_no_mutuals = {
        "author_handle": "user1",
        "mutual_follows": 0,
        "follower_count": 1000,
    }
    tweet_with_mutuals = {
        "author_handle": "user2",
        "mutual_follows": 5,
        "follower_count": 1000,
    }
    seed = {"a", "b", "c", "d", "e"}
    score_no = compute_quality_score(tweet_no_mutuals, seed)
    score_yes = compute_quality_score(tweet_with_mutuals, seed)
    assert score_yes > score_no


def test_slop_detection_dilutes_score():
    tweet_normal = {
        "author_handle": "user1",
        "author_tweet_count_24h": 5,
        "follower_count": 10000,
    }
    tweet_slop = {
        "author_handle": "user2",
        "author_tweet_count_24h": 50,
        "follower_count": 10000,
    }
    seed = set()
    score_normal = compute_quality_score(tweet_normal, seed)
    score_slop = compute_quality_score(tweet_slop, seed)
    assert score_normal > score_slop


def test_diversity_cap():
    tweets = [
        {"author_handle": "alice", "quality_score": 0.9},
        {"author_handle": "alice", "quality_score": 0.8},
        {"author_handle": "alice", "quality_score": 0.7},
        {"author_handle": "bob", "quality_score": 0.85},
        {"author_handle": "charlie", "quality_score": 0.6},
    ]
    result = apply_diversity_cap(tweets, max_author_pct=0.20)
    alice_count = sum(1 for t in result if t["author_handle"] == "alice")
    assert alice_count == 1  # max 20% of 5 = 1


def test_diversity_cap_empty():
    assert apply_diversity_cap([]) == []


@pytest.mark.asyncio
async def test_filter_tweets():
    tweets = [
        {
            "author_handle": "karpathy",
            "follower_count": 500000,
            "engagement": {"likes": 5000},
        },
        {"author_handle": "spammer", "follower_count": 100},
    ]
    result = await filter_tweets(tweets, {"karpathy"}, blocked={"spammer"})
    assert len(result) >= 1
    assert all(t["author_handle"] != "spammer" for t in result)
