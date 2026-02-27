import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.grok_api import fetch_grok_context, GrokAPIError


@pytest.mark.asyncio
async def test_fetch_grok_context_success():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "output": [
            {
                "type": "message",
                "content": [
                    {"type": "output_text", "text": "This tweet is about AI progress..."}
                ],
            }
        ]
    }

    with patch("app.services.grok_api.settings") as mock_settings:
        mock_settings.xai_api_key = "test-api-key"

        with patch("app.services.grok_api._client") as mock_client:
            mock_client.post = AsyncMock(return_value=mock_response)

            result = await fetch_grok_context("https://x.com/user/status/123")

    assert result == "This tweet is about AI progress..."


@pytest.mark.asyncio
async def test_fetch_grok_context_no_api_key():
    with patch("app.services.grok_api.settings") as mock_settings:
        mock_settings.xai_api_key = ""
        with pytest.raises(GrokAPIError, match="XAI_API_KEY"):
            await fetch_grok_context("https://x.com/user/status/123")
