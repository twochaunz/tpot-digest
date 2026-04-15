"""Tests for the Twitter API service (fetch_tweet via twitterapi.io)."""

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.services.x_api import XAPIError, fetch_tweet


# Full twitterapi.io response with author, media, metrics, and quoted tweet
FULL_API_RESPONSE = {
    "tweets": [
        {
            "type": "tweet",
            "id": "123456",
            "url": "https://x.com/karpathy/status/123456",
            "text": "Check out this amazing demo! https://t.co/abc",
            "createdAt": "Thu Feb 20 15:30:00 +0000 2026",
            "lang": "en",
            "likeCount": 5000,
            "retweetCount": 1200,
            "replyCount": 300,
            "quoteCount": 50,
            "viewCount": 100000,
            "bookmarkCount": 200,
            "isReply": False,
            "inReplyToId": None,
            "inReplyToUsername": None,
            "conversationId": "123456",
            "isQuote": True,
            "author": {
                "type": "user",
                "userName": "karpathy",
                "name": "Andrej Karpathy",
                "id": "999",
                "profilePicture": "https://pbs.twimg.com/profile/karpathy.jpg",
                "isBlueVerified": True,
                "verifiedType": None,
            },
            "extendedEntities": {
                "media": [
                    {
                        "type": "photo",
                        "media_url_https": "https://pbs.twimg.com/media/photo1.jpg",
                        "original_info": {"width": 1200, "height": 800},
                    }
                ]
            },
            "entities": {"hashtags": [], "urls": [], "user_mentions": []},
            "quoted_tweet": {
                "type": "tweet",
                "id": "111",
                "url": "https://x.com/someone/status/111",
                "text": "Original tweet",
                "createdAt": "Wed Feb 19 10:00:00 +0000 2026",
                "likeCount": 100,
                "retweetCount": 10,
                "replyCount": 5,
                "isReply": False,
                "author": {
                    "userName": "someone",
                    "name": "Someone",
                    "profilePicture": "",
                    "isBlueVerified": False,
                },
                "extendedEntities": {},
                "entities": {},
            },
            "retweeted_tweet": None,
        }
    ],
    "status": "success",
    "msg": "success",
    "code": 0,
}

# Response when tweet is not found (empty tweets array)
NOT_FOUND_RESPONSE = {
    "tweets": [],
    "status": "success",
    "msg": "success",
    "code": 0,
}

# Minimal response: no media, no quoted tweet, unverified author
MINIMAL_RESPONSE = {
    "tweets": [
        {
            "type": "tweet",
            "id": "789",
            "url": "https://x.com/regularuser/status/789",
            "text": "Just a simple tweet",
            "createdAt": "Sat Feb 21 10:00:00 +0000 2026",
            "lang": "en",
            "likeCount": 3,
            "retweetCount": 0,
            "replyCount": 1,
            "quoteCount": 0,
            "viewCount": 50,
            "bookmarkCount": 0,
            "isReply": False,
            "inReplyToId": None,
            "inReplyToUsername": None,
            "conversationId": "789",
            "author": {
                "type": "user",
                "userName": "regularuser",
                "name": "Regular User",
                "id": "555",
                "profilePicture": "https://pbs.twimg.com/profile/default.jpg",
                "isBlueVerified": False,
                "verifiedType": None,
            },
            "extendedEntities": {},
            "entities": {"hashtags": [], "urls": [], "user_mentions": []},
            "quoted_tweet": None,
            "retweeted_tweet": None,
        }
    ],
    "status": "success",
    "msg": "success",
    "code": 0,
}


def _mock_response(status_code: int, json_data: dict) -> httpx.Response:
    """Create a mock httpx.Response."""
    return httpx.Response(
        status_code=status_code,
        json=json_data,
        request=httpx.Request("GET", "https://api.twitterapi.io/twitter/tweets"),
    )


@pytest.mark.asyncio
async def test_fetch_tweet_success():
    """Full response with author, media, metrics, and quoted tweet."""
    mock_response = _mock_response(200, FULL_API_RESPONSE)

    with patch("app.services.x_api.settings") as mock_settings:
        mock_settings.twitter_api_io_key = "test-api-key"

        with patch("app.services.x_api._client") as mock_client:
            mock_client.get = AsyncMock(return_value=mock_response)

            result = await fetch_tweet("123456")

    assert result["author_handle"] == "karpathy"
    assert result["author_display_name"] == "Andrej Karpathy"
    assert result["author_avatar_url"] == "https://pbs.twimg.com/profile/karpathy.jpg"
    assert result["author_verified"] is True
    assert result["text"] == "Check out this amazing demo! https://t.co/abc"
    assert result["url"] == "https://x.com/karpathy/status/123456"
    assert result["media_urls"] == [
        {
            "type": "photo",
            "url": "https://pbs.twimg.com/media/photo1.jpg",
            "width": 1200,
            "height": 800,
        }
    ]
    assert result["engagement"] == {
        "likes": 5000,
        "retweets": 1200,
        "replies": 300,
    }
    assert result["is_quote_tweet"] is True
    assert result["quoted_tweet_id"] == "111"
    assert result["is_reply"] is False
    assert result["reply_to_tweet_id"] is None
    assert result["created_at"] == "2026-02-20T15:30:00+00:00"


@pytest.mark.asyncio
async def test_fetch_tweet_not_found():
    """Empty tweets array should raise XAPIError."""
    mock_response = _mock_response(200, NOT_FOUND_RESPONSE)

    with patch("app.services.x_api.settings") as mock_settings:
        mock_settings.twitter_api_io_key = "test-api-key"

        with patch("app.services.x_api._client") as mock_client:
            mock_client.get = AsyncMock(return_value=mock_response)

            with pytest.raises(XAPIError, match="not found"):
                await fetch_tweet("999999999")


@pytest.mark.asyncio
async def test_fetch_tweet_rate_limited():
    """429 response should raise XAPIError with 'rate limit'."""
    mock_response = _mock_response(429, {"error": "Too Many Requests"})

    with patch("app.services.x_api.settings") as mock_settings:
        mock_settings.twitter_api_io_key = "test-api-key"

        with patch("app.services.x_api._client") as mock_client:
            mock_client.get = AsyncMock(return_value=mock_response)

            with pytest.raises(XAPIError, match="rate limit"):
                await fetch_tweet("123456")


@pytest.mark.asyncio
async def test_fetch_tweet_no_token():
    """Empty API key should raise XAPIError with 'not configured'."""
    with patch("app.services.x_api.settings") as mock_settings:
        mock_settings.twitter_api_io_key = ""

        with pytest.raises(XAPIError, match="not configured"):
            await fetch_tweet("123456")


@pytest.mark.asyncio
async def test_fetch_tweet_minimal_response():
    """Tweet with no media, no quoted tweet, unverified author."""
    mock_response = _mock_response(200, MINIMAL_RESPONSE)

    with patch("app.services.x_api.settings") as mock_settings:
        mock_settings.twitter_api_io_key = "test-api-key"

        with patch("app.services.x_api._client") as mock_client:
            mock_client.get = AsyncMock(return_value=mock_response)

            result = await fetch_tweet("789")

    assert result["author_handle"] == "regularuser"
    assert result["author_display_name"] == "Regular User"
    assert result["author_verified"] is False
    assert result["text"] == "Just a simple tweet"
    assert result["media_urls"] is None
    assert result["is_quote_tweet"] is False
    assert result["is_reply"] is False
    assert result["quoted_tweet_id"] is None
    assert result["reply_to_tweet_id"] is None
    assert result["created_at"] == "2026-02-21T10:00:00+00:00"
