"""Twitter API client for fetching tweet data via twitterapi.io."""

from __future__ import annotations

import html
import logging
from datetime import datetime, timezone

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

API_BASE = "https://api.twitterapi.io/twitter"

_client = httpx.AsyncClient(timeout=httpx.Timeout(15.0))


class XAPIError(Exception):
    """Raised when the Twitter API returns an error or is misconfigured."""

    pass


async def fetch_tweet(tweet_id: str) -> dict:
    """Fetch a tweet by ID from twitterapi.io and return normalized data.

    Returns a dict with keys:
        author_handle, author_display_name, author_avatar_url, author_verified,
        text, url, media_urls, engagement, is_quote_tweet, is_reply,
        quoted_tweet_id, reply_to_tweet_id, created_at

    Raises:
        XAPIError: on missing token, rate limiting, auth failure, or tweet not found.
    """
    if not settings.twitter_api_io_key:
        raise XAPIError("TWITTER_API_IO_KEY is not configured")

    headers = {"X-API-Key": settings.twitter_api_io_key}

    print(f"[TwitterAPI.io] GET /tweets?tweet_ids={tweet_id}", flush=True)
    response = await _client.get(
        f"{API_BASE}/tweets",
        params={"tweet_ids": tweet_id},
        headers=headers,
    )

    if response.status_code == 429:
        raise XAPIError("Twitter API rate limit exceeded")
    if response.status_code == 401:
        raise XAPIError("Twitter API authentication failed")
    if response.status_code not in (200, 201):
        raise XAPIError(f"Twitter API error: HTTP {response.status_code}")

    body = response.json()
    tweets = body.get("tweets", [])

    if not tweets:
        raise XAPIError(f"Tweet {tweet_id} not found")

    data = tweets[0]
    return _normalize_tweet(data)


def _normalize_tweet(data: dict) -> dict:
    """Convert a twitterapi.io tweet object to our normalized format."""
    author = data.get("author") or {}
    author_handle = author.get("userName", "")

    # Media from extendedEntities
    media_urls = _extract_media(data.get("extendedEntities") or {})

    # Quote tweet
    quoted_tweet = data.get("quoted_tweet")
    is_quote_tweet = bool(quoted_tweet)
    quoted_tweet_id = quoted_tweet.get("id") if quoted_tweet else None

    # Reply info
    is_reply = bool(data.get("isReply"))
    reply_to_tweet_id = data.get("inReplyToId") or None
    reply_to_handle = data.get("inReplyToUsername") or None

    # URL entities
    url_entities = _extract_url_entities(
        (data.get("entities") or {}).get("urls", [])
    )

    # Article title (X Articles)
    article_title = None
    article_data = data.get("article")
    if article_data and isinstance(article_data, dict):
        article_title = article_data.get("title")

    # Fallback: twitterapi.io doesn't return article data, detect from URL entities
    if not article_title and url_entities:
        for ue in url_entities:
            target = ue.get("unwound_url") or ue.get("expanded_url") or ""
            if "/i/article/" in target:
                article_title = "Article"
                break

    # Parse created_at from Twitter format to ISO
    created_at = _parse_twitter_date(data.get("createdAt", ""))

    # Build included_tweets from quoted tweet
    included_tweets: list[dict] = []
    if quoted_tweet:
        included_tweets.append(_normalize_tweet(quoted_tweet))
        # Set the tweet_id field expected by _persist_quoted_tweet
        included_tweets[-1]["tweet_id"] = quoted_tweet.get("id", "")

    tweet_id = data.get("id", "")

    return {
        "author_handle": author_handle,
        "author_display_name": author.get("name", ""),
        "author_avatar_url": author.get("profilePicture", ""),
        "author_verified": (
            author.get("isBlueVerified", False)
            or bool(author.get("verifiedType"))
        ),
        "text": html.unescape(data.get("text", "")),
        "url": data.get("url") or f"https://x.com/{author_handle}/status/{tweet_id}",
        "media_urls": media_urls,
        "engagement": {
            "likes": data.get("likeCount", 0),
            "retweets": data.get("retweetCount", 0),
            "replies": data.get("replyCount", 0),
        },
        "is_quote_tweet": is_quote_tweet,
        "is_reply": is_reply,
        "quoted_tweet_id": quoted_tweet_id,
        "reply_to_tweet_id": reply_to_tweet_id,
        "reply_to_handle": reply_to_handle,
        "url_entities": url_entities,
        "article_title": article_title,
        "lang": data.get("lang"),
        "created_at": created_at,
        "included_tweets": included_tweets,
    }


def _extract_media(extended_entities: dict) -> list[dict] | None:
    """Extract structured media objects from extendedEntities.media."""
    media_list = extended_entities.get("media")
    if not media_list:
        return None

    result = []
    for media in media_list:
        media_type = media.get("type", "photo")
        url = media.get("media_url_https", "")

        # For video, use the preview image as the URL
        # (video_info.variants has the actual video URLs)
        if media_type == "video" or media_type == "animated_gif":
            url = media.get("media_url_https", "")

        if not url:
            continue

        info = media.get("original_info", {})
        result.append({
            "type": media_type,
            "url": url,
            "width": info.get("width") or media.get("sizes", {}).get("large", {}).get("w"),
            "height": info.get("height") or media.get("sizes", {}).get("large", {}).get("h"),
        })
    return result if result else None


def _extract_url_entities(urls: list[dict]) -> list[dict] | None:
    """Extract URL entity data for frontend display (expanded URLs, link cards)."""
    if not urls:
        return None
    result = []
    for u in urls:
        entry: dict = {
            "url": u.get("url", ""),
            "expanded_url": u.get("expanded_url", ""),
            "display_url": u.get("display_url", ""),
        }
        if u.get("title"):
            entry["title"] = u["title"]
        if u.get("description"):
            entry["description"] = u["description"]
        if u.get("images"):
            entry["images"] = u["images"]
        if u.get("unwound_url"):
            entry["unwound_url"] = u["unwound_url"]
        result.append(entry)
    return result if result else None


def _parse_twitter_date(date_str: str) -> str:
    """Parse Twitter's date format to ISO 8601.

    Input: 'Thu Apr 28 00:56:58 +0000 2022'
    Output: '2022-04-28T00:56:58+00:00'
    """
    if not date_str:
        return ""
    try:
        dt = datetime.strptime(date_str, "%a %b %d %H:%M:%S %z %Y")
        return dt.isoformat()
    except ValueError:
        # Already ISO or unknown format, return as-is
        return date_str
