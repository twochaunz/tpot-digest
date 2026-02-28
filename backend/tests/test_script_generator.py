import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.script_generator import generate_script, build_prompt, ScriptGeneratorError


@pytest.mark.asyncio
async def test_generate_script_grok():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "choices": [{"message": {"content": '[{"type":"text","text":"SpaceX acquired xAI."},{"type":"tweet","tweet_id":"123"}]'}}]
    }

    with patch("app.services.script_generator.settings") as mock_settings:
        mock_settings.xai_api_key = "test-key"
        mock_settings.anthropic_api_key = ""

        with patch("app.services.script_generator._grok_client") as mock_client:
            mock_client.post = AsyncMock(return_value=mock_response)

            result = await generate_script(
                model="grok-4-1-fast-reasoning",
                prompt="test prompt",
            )

    assert len(result) == 2
    assert result[0]["type"] == "text"
    assert result[1]["type"] == "tweet"
    assert result[1]["tweet_id"] == "123"


@pytest.mark.asyncio
async def test_generate_script_claude():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "content": [{"type": "text", "text": '[{"type":"text","text":"SpaceX acquired xAI."}]'}]
    }

    with patch("app.services.script_generator.settings") as mock_settings:
        mock_settings.xai_api_key = ""
        mock_settings.anthropic_api_key = "test-key"

        with patch("app.services.script_generator._anthropic_client") as mock_client:
            mock_client.post = AsyncMock(return_value=mock_response)

            result = await generate_script(
                model="claude-opus-4-6",
                prompt="test prompt",
            )

    assert len(result) == 1
    assert result[0]["type"] == "text"


@pytest.mark.asyncio
async def test_generate_script_no_api_key_grok():
    with patch("app.services.script_generator.settings") as mock_settings:
        mock_settings.xai_api_key = ""
        with pytest.raises(ScriptGeneratorError, match="XAI_API_KEY"):
            await generate_script(model="grok-3", prompt="test")


@pytest.mark.asyncio
async def test_generate_script_no_api_key_claude():
    with patch("app.services.script_generator.settings") as mock_settings:
        mock_settings.anthropic_api_key = ""
        with pytest.raises(ScriptGeneratorError, match="ANTHROPIC_API_KEY"):
            await generate_script(model="claude-sonnet-4-6", prompt="test")


@pytest.mark.asyncio
async def test_generate_script_unsupported_model():
    with pytest.raises(ScriptGeneratorError, match="Unsupported model"):
        await generate_script(model="unknown-model", prompt="test")


def test_build_prompt():
    topic_title = "SpaceX Acquired xAI"
    og_tweet = {"text": "Breaking: SpaceX acquires xAI", "url": "https://x.com/user/status/1", "grok_context": "Major merger news", "tweet_id": "1"}
    tweets = [
        {"tweet_id": "2", "author_handle": "user2", "text": "This is huge", "category": "echo", "grok_context": "Excitement"},
        {"tweet_id": "3", "author_handle": "user3", "text": "Not sure about this", "category": "pushback", "grok_context": "Skepticism"},
    ]
    style_guide = "Be concise and objective."

    prompt = build_prompt(topic_title, og_tweet, tweets, style_guide)

    assert "SpaceX Acquired xAI" in prompt
    assert "Breaking: SpaceX acquires xAI" in prompt
    assert "tweet_id" in prompt
    assert "echo" in prompt
    assert "Be concise and objective." in prompt


def test_build_prompt_with_feedback():
    prompt = build_prompt(
        topic_title="Test",
        og_tweet=None,
        tweets=[],
        style_guide="",
        previous_script=[{"type": "text", "text": "old version"}],
        feedback="make it better",
    )
    assert "PREVIOUS SCRIPT VERSION" in prompt
    assert "make it better" in prompt


def test_build_prompt_includes_og_tweet_block_requirement():
    prompt = build_prompt(
        topic_title="Test",
        og_tweet={"text": "OG text", "url": "https://x.com/u/status/99", "tweet_id": "99"},
        tweets=[],
        style_guide="",
    )
    assert 'You MUST include the OG tweet' in prompt
    assert '"tweet_id": "99"' in prompt


def test_build_prompt_no_og_tweet_block_requirement():
    prompt = build_prompt(
        topic_title="Test",
        og_tweet=None,
        tweets=[],
        style_guide="",
    )
    assert 'You MUST include the OG tweet' not in prompt


def test_parse_blocks_with_markdown_fences():
    """Test that _parse_blocks handles markdown code fences."""
    from app.services.script_generator import _parse_blocks

    raw = '```json\n[{"type":"text","text":"hello"}]\n```'
    result = _parse_blocks(raw)
    assert len(result) == 1
    assert result[0]["text"] == "hello"
