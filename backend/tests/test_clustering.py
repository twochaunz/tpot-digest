import pytest

from app.pipeline.clustering import cluster_with_fallback, simple_keyword_cluster


def test_simple_keyword_cluster_groups_by_entity():
    tweets = [
        {"text": "Claude 4 just launched! Amazing benchmarks"},
        {"text": "Claude is the best model for coding tasks"},
        {"text": "OpenAI announces new funding round"},
        {"text": "OpenAI raises another $5B at $300B valuation"},
        {"text": "Random unrelated tweet about cooking"},
    ]
    topics = simple_keyword_cluster(tweets)
    assert len(topics) >= 2
    titles = [t["title"].lower() for t in topics]
    assert any("claude" in t for t in titles)
    assert any("openai" in t for t in titles)


def test_simple_keyword_cluster_min_2_tweets():
    tweets = [
        {"text": "Something about Claude"},
        {"text": "Something completely different"},
    ]
    topics = simple_keyword_cluster(tweets)
    # "Claude" only has 1 tweet, shouldn't create a topic
    assert len(topics) == 0


def test_simple_keyword_cluster_empty():
    assert simple_keyword_cluster([]) == []


@pytest.mark.asyncio
async def test_cluster_with_fallback_uses_keyword_when_no_api():
    """Without an API key, should fall back to keyword clustering."""
    tweets = [
        {"text": "Claude is amazing for coding"},
        {"text": "I love using Claude for writing"},
        {"text": "GPT-5 benchmarks are wild"},
        {"text": "OpenAI GPT-5 is a game changer"},
    ]
    topics = await cluster_with_fallback(tweets)
    assert len(topics) >= 1


@pytest.mark.asyncio
async def test_cluster_with_fallback_empty():
    topics = await cluster_with_fallback([])
    assert topics == []
