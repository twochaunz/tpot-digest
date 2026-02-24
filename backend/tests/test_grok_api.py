import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.grok_api import fetch_grok_context, GrokAPIError


@pytest.mark.asyncio
async def test_fetch_grok_context_success():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "choices": [{"message": {"content": "This tweet is about AI progress..."}}]
    }

    with patch("app.services.grok_api.settings") as mock_settings:
        mock_settings.xai_api_key = "test-api-key"

        with patch("app.services.grok_api.httpx.AsyncClient") as MockClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.post.return_value = mock_response
            MockClient.return_value.__aenter__ = AsyncMock(
                return_value=mock_client_instance
            )
            MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await fetch_grok_context("https://x.com/user/status/123")

    assert result == "This tweet is about AI progress..."


@pytest.mark.asyncio
async def test_fetch_grok_context_no_api_key():
    with patch("app.services.grok_api.settings") as mock_settings:
        mock_settings.xai_api_key = ""
        with pytest.raises(GrokAPIError, match="XAI_API_KEY"):
            await fetch_grok_context("https://x.com/user/status/123")
