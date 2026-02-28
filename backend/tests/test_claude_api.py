import json
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from app.services.claude_api import classify_tweet, recategorize_topic, TopicCandidate


@pytest.fixture
def mock_anthropic():
    """Mock the Anthropic client."""
    with patch("app.services.claude_api._get_client") as mock:
        client = MagicMock()
        mock.return_value = client
        yield client


@pytest.mark.asyncio
async def test_classify_tweet_returns_suggestion(mock_anthropic):
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=json.dumps({
        "topic_id": 42,
        "new_topic_title": None,
        "category": "pushback",
        "related_topic_id": None,
        "confidence": 0.85,
    }))]

    mock_anthropic.messages.create = AsyncMock(return_value=mock_response)

    result = await classify_tweet(
        tweet_text="This is a terrible take and here's why...",
        grok_context="User is responding to a viral post about AI safety.",
        candidates=[
            TopicCandidate(
                topic_id=42,
                title="AI Safety Debate",
                date="2026-02-27",
                og_text="We need to pause AI development now.",
                og_grok_context="Post went viral with 10K+ retweets.",
                category_summary="2 context, 1 echo",
                similarity=0.82,
            )
        ],
    )

    assert result["topic_id"] == 42
    assert result["category"] == "pushback"
    assert result["confidence"] == 0.85


@pytest.mark.asyncio
async def test_classify_tweet_suggests_new_topic(mock_anthropic):
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=json.dumps({
        "topic_id": None,
        "new_topic_title": "GPT-5 Launch Rumors",
        "category": "hot-take",
        "related_topic_id": None,
        "confidence": 0.70,
    }))]

    mock_anthropic.messages.create = AsyncMock(return_value=mock_response)

    result = await classify_tweet(
        tweet_text="GPT-5 is coming next month, mark my words.",
        grok_context="Speculation about OpenAI's next model release.",
        candidates=[],
    )

    assert result["topic_id"] is None
    assert result["new_topic_title"] == "GPT-5 Launch Rumors"
    assert result["category"] == "hot-take"


@pytest.mark.asyncio
async def test_recategorize_topic(mock_anthropic):
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=json.dumps({
        "categories": {
            "101": "context",
            "102": "pushback",
            "103": "echo",
        }
    }))]

    mock_anthropic.messages.create = AsyncMock(return_value=mock_response)

    result = await recategorize_topic(
        topic_title="AI Safety Debate",
        og_text="Original controversial take about AI.",
        og_grok_context="Post by prominent AI researcher.",
        tweets=[
            {"id": 101, "text": "Here's some data on this...", "grok_context": None},
            {"id": 102, "text": "This is wrong because...", "grok_context": None},
            {"id": 103, "text": "RT this is so important", "grok_context": None},
        ],
    )

    assert result == {101: "context", 102: "pushback", 103: "echo"}
