import pytest

from app.pipeline.clustering import identify_subtopics, simple_subtopic_split


def test_simple_subtopic_split_sentiment():
    tweets = [
        {"text": "Claude 4 benchmarks are incredible! Amazing work"},
        {"text": "So excited about Claude 4 launch, this is great"},
        {"text": "Wait, these benchmarks look manipulated and flawed"},
        {"text": "The benchmark methodology is wrong and misleading"},
        {"text": "Let me analyze the Claude 4 architecture in detail"},
    ]
    subtopics = simple_subtopic_split("Claude 4 Launch", tweets)
    assert len(subtopics) >= 2
    sentiments = {st["sentiment"] for st in subtopics}
    assert "positive" in sentiments
    assert "negative" in sentiments


def test_simple_subtopic_split_all_neutral():
    tweets = [
        {"text": "Claude 4 was released today"},
        {"text": "New model from Anthropic is out"},
    ]
    subtopics = simple_subtopic_split("Claude 4 Launch", tweets)
    assert len(subtopics) >= 1


def test_simple_subtopic_split_empty():
    subtopics = simple_subtopic_split("Empty Topic", [])
    assert len(subtopics) == 1
    assert subtopics[0]["tweet_indices"] == []


@pytest.mark.asyncio
async def test_identify_subtopics_single_tweet():
    tweets = [{"text": "Just one tweet about Claude"}]
    subtopics = await identify_subtopics("Claude", tweets)
    assert len(subtopics) == 1
    assert subtopics[0]["tweet_indices"] == [0]


@pytest.mark.asyncio
async def test_identify_subtopics_fallback():
    """Without API key, should return single sub-topic with all tweets."""
    tweets = [
        {"text": "Claude is great"},
        {"text": "Claude benchmarks are suspicious"},
    ]
    subtopics = await identify_subtopics("Claude 4", tweets)
    assert len(subtopics) >= 1
    # All tweet indices should be covered
    all_indices = set()
    for st in subtopics:
        all_indices.update(st["tweet_indices"])
    assert all_indices == {0, 1}
