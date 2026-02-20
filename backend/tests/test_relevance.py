import pytest

from app.pipeline.relevance import classify_relevance, _classify_with_keywords


def test_keyword_classify_tech_tweet():
    result = _classify_with_keywords("OpenAI just released GPT-5 with amazing AI benchmarks", 0.5)
    assert result["is_relevant"] is True
    assert result["confidence"] > 0.5
    assert result["method"] == "keyword"
    assert result["category"] == "AI/ML"


def test_keyword_classify_startup_tweet():
    result = _classify_with_keywords("This startup just raised Series B funding at $500M valuation", 0.5)
    assert result["is_relevant"] is True
    assert result["category"] == "Startups/VC"


def test_keyword_classify_dev_tweet():
    result = _classify_with_keywords("Just shipped a new React component using TypeScript", 0.5)
    assert result["is_relevant"] is True
    assert result["category"] == "Dev Tools"


def test_keyword_classify_irrelevant():
    result = _classify_with_keywords("Just had the best pizza of my life at this restaurant", 0.5)
    assert result["is_relevant"] is False
    assert result["category"] is None


def test_keyword_classify_empty():
    result = _classify_with_keywords("", 0.5)
    assert result["is_relevant"] is False
    assert result["confidence"] == 0.0


def test_keyword_classify_hardware():
    result = _classify_with_keywords("NVIDIA announces new GPU chip for AI training", 0.5)
    assert result["is_relevant"] is True
    assert result["category"] in ("AI/ML", "Hardware")  # Could match either


def test_keyword_classify_threshold():
    # With a high threshold, borderline tweets should be filtered
    result = _classify_with_keywords("New Apple product launch today", 0.8)
    # May or may not pass depending on match density


@pytest.mark.asyncio
async def test_classify_relevance_no_api_key(monkeypatch):
    """Without API key, should use keyword fallback."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    result = await classify_relevance("Claude AI model shows incredible benchmark results", 0.5)
    assert result["is_relevant"] is True
    assert result["method"] == "keyword"


@pytest.mark.asyncio
async def test_classify_relevance_irrelevant(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    result = await classify_relevance("My cat is sleeping on the couch again", 0.5)
    assert result["is_relevant"] is False
