"""Tests for the X API service (fetch_tweet)."""

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.services.x_api import XAPIError, fetch_tweet


# Full X API v2 response with author, media, metrics, and quoted tweet
FULL_API_RESPONSE = {
    "data": {
        "id": "123456",
        "text": "Check out this amazing demo! https://t.co/abc",
        "created_at": "2026-02-20T15:30:00.000Z",
        "public_metrics": {
            "like_count": 5000,
            "retweet_count": 1200,
            "reply_count": 300,
            "quote_count": 50,
        },
        "author_id": "999",
        "attachments": {"media_keys": ["media_1"]},
        "referenced_tweets": [{"type": "quoted", "id": "111"}],
    },
    "includes": {
        "users": [
            {
                "id": "999",
                "name": "Andrej Karpathy",
                "username": "karpathy",
                "profile_image_url": "https://pbs.twimg.com/profile/karpathy.jpg",
                "verified": True,
            }
        ],
        "media": [
            {
                "media_key": "media_1",
                "type": "photo",
                "url": "https://pbs.twimg.com/media/photo1.jpg",
                "width": 1200,
                "height": 800,
            }
        ],
    },
}

# Response when tweet is not found (errors array, no data)
NOT_FOUND_RESPONSE = {
    "errors": [
        {
            "value": "999999999",
            "detail": "Could not find tweet with id: [999999999].",
            "title": "Not Found Error",
            "resource_type": "tweet",
            "parameter": "id",
            "type": "https://api.twitter.com/2/problems/resource-not-found",
        }
    ]
}

# Minimal response: no media, no referenced_tweets, unverified author
MINIMAL_RESPONSE = {
    "data": {
        "id": "789",
        "text": "Just a simple tweet",
        "created_at": "2026-02-21T10:00:00.000Z",
        "public_metrics": {
            "like_count": 3,
            "retweet_count": 0,
            "reply_count": 1,
            "quote_count": 0,
        },
        "author_id": "555",
    },
    "includes": {
        "users": [
            {
                "id": "555",
                "name": "Regular User",
                "username": "regularuser",
                "profile_image_url": "https://pbs.twimg.com/profile/default.jpg",
            }
        ],
    },
}


def _mock_response(status_code: int, json_data: dict) -> httpx.Response:
    """Create a mock httpx.Response."""
    return httpx.Response(
        status_code=status_code,
        json=json_data,
        request=httpx.Request("GET", "https://api.x.com/2/tweets/123456"),
    )


@pytest.mark.asyncio
async def test_fetch_tweet_success():
    """Full response with author, media, metrics, and quoted tweet."""
    mock_response = _mock_response(200, FULL_API_RESPONSE)

    with patch("app.services.x_api.settings") as mock_settings:
        mock_settings.x_api_bearer_token = "test-bearer-token"

        with patch("app.services.x_api.httpx.AsyncClient") as MockClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.get.return_value = mock_response
            MockClient.return_value.__aenter__ = AsyncMock(
                return_value=mock_client_instance
            )
            MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await fetch_tweet("123456")

    assert result["author_handle"] == "karpathy"
    assert result["author_display_name"] == "Andrej Karpathy"
    assert result["author_avatar_url"] == "https://pbs.twimg.com/profile/karpathy.jpg"
    assert result["author_verified"] is True
    assert result["text"] == "Check out this amazing demo! https://t.co/abc"
    assert result["url"] == "https://x.com/karpathy/status/123456"
    assert result["media_urls"] == ["https://pbs.twimg.com/media/photo1.jpg"]
    assert result["engagement"] == {
        "like_count": 5000,
        "retweet_count": 1200,
        "reply_count": 300,
        "quote_count": 50,
    }
    assert result["is_quote_tweet"] is True
    assert result["quoted_tweet_id"] == "111"
    assert result["is_reply"] is False
    assert result["reply_to_tweet_id"] is None
    assert result["created_at"] == "2026-02-20T15:30:00.000Z"


@pytest.mark.asyncio
async def test_fetch_tweet_not_found():
    """Response with errors array and no data key should raise XAPIError."""
    mock_response = _mock_response(200, NOT_FOUND_RESPONSE)

    with patch("app.services.x_api.settings") as mock_settings:
        mock_settings.x_api_bearer_token = "test-bearer-token"

        with patch("app.services.x_api.httpx.AsyncClient") as MockClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.get.return_value = mock_response
            MockClient.return_value.__aenter__ = AsyncMock(
                return_value=mock_client_instance
            )
            MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

            with pytest.raises(XAPIError, match="not found"):
                await fetch_tweet("999999999")


@pytest.mark.asyncio
async def test_fetch_tweet_rate_limited():
    """429 response should raise XAPIError with 'rate limit'."""
    mock_response = _mock_response(429, {"title": "Too Many Requests"})

    with patch("app.services.x_api.settings") as mock_settings:
        mock_settings.x_api_bearer_token = "test-bearer-token"

        with patch("app.services.x_api.httpx.AsyncClient") as MockClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.get.return_value = mock_response
            MockClient.return_value.__aenter__ = AsyncMock(
                return_value=mock_client_instance
            )
            MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

            with pytest.raises(XAPIError, match="rate limit"):
                await fetch_tweet("123456")


@pytest.mark.asyncio
async def test_fetch_tweet_no_token():
    """Empty bearer token should raise XAPIError with 'not configured'."""
    with patch("app.services.x_api.settings") as mock_settings:
        mock_settings.x_api_bearer_token = ""

        with pytest.raises(XAPIError, match="not configured"):
            await fetch_tweet("123456")


@pytest.mark.asyncio
async def test_fetch_tweet_minimal_response():
    """Tweet with no media, no referenced_tweets, unverified author."""
    mock_response = _mock_response(200, MINIMAL_RESPONSE)

    with patch("app.services.x_api.settings") as mock_settings:
        mock_settings.x_api_bearer_token = "test-bearer-token"

        with patch("app.services.x_api.httpx.AsyncClient") as MockClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.get.return_value = mock_response
            MockClient.return_value.__aenter__ = AsyncMock(
                return_value=mock_client_instance
            )
            MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await fetch_tweet("789")

    assert result["author_handle"] == "regularuser"
    assert result["author_display_name"] == "Regular User"
    assert result["author_verified"] is False
    assert result["text"] == "Just a simple tweet"
    assert result["media_urls"] == []
    assert result["is_quote_tweet"] is False
    assert result["is_reply"] is False
    assert result["quoted_tweet_id"] is None
    assert result["reply_to_tweet_id"] is None
    assert result["created_at"] == "2026-02-21T10:00:00.000Z"
