"""X API v2 client for fetching tweet data."""

from __future__ import annotations

import html
import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

X_API_BASE = "https://api.x.com/2"

_client = httpx.AsyncClient(timeout=httpx.Timeout(10.0))

TWEET_FIELDS = "text,note_tweet,created_at,public_metrics,entities,referenced_tweets,lang"
EXPANSIONS = "author_id,attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id"
USER_FIELDS = "profile_image_url,verified,verified_type,name,username"
MEDIA_FIELDS = "url,preview_image_url,type,width,height"


class XAPIError(Exception):
    """Raised when the X API returns an error or is misconfigured."""

    pass


async def fetch_tweet(tweet_id: str) -> dict:
    """Fetch a tweet by ID from the X API v2 and return normalized data.

    Returns a dict with keys:
        author_handle, author_display_name, author_avatar_url, author_verified,
        text, url, media_urls, engagement, is_quote_tweet, is_reply,
        quoted_tweet_id, reply_to_tweet_id, created_at

    Raises:
        XAPIError: on missing token, rate limiting, auth failure, or tweet not found.
    """
    if not settings.x_api_bearer_token:
        raise XAPIError("X API bearer token is not configured")

    params = {
        "tweet.fields": TWEET_FIELDS,
        "expansions": EXPANSIONS,
        "user.fields": USER_FIELDS,
        "media.fields": MEDIA_FIELDS,
    }
    headers = {
        "Authorization": f"Bearer {settings.x_api_bearer_token}",
    }

    logger.info("X API call: GET /tweets/%s", tweet_id)
    response = await _client.get(
        f"{X_API_BASE}/tweets/{tweet_id}",
        params=params,
        headers=headers,
    )

    # Handle HTTP-level errors
    if response.status_code == 429:
        raise XAPIError("X API rate limit exceeded")
    if response.status_code == 401:
        raise XAPIError("X API authentication failed")
    if response.status_code not in (200, 201):
        raise XAPIError(f"X API error: HTTP {response.status_code}")

    body = response.json()

    # Handle missing data (tweet not found or deleted)
    if "data" not in body:
        raise XAPIError(f"Tweet {tweet_id} not found")

    data = body["data"]
    includes = body.get("includes", {})

    # Extract author from includes.users
    author = _find_author(data.get("author_id"), includes.get("users", []))

    # Extract media URLs from includes.media
    media_urls = _extract_media_urls(
        data.get("attachments", {}).get("media_keys", []),
        includes.get("media", []),
    )

    # Extract referenced tweet info
    referenced = data.get("referenced_tweets", [])
    quoted_tweet_id = None
    reply_to_tweet_id = None
    is_quote_tweet = False
    is_reply = False

    for ref in referenced:
        if ref["type"] == "quoted":
            is_quote_tweet = True
            quoted_tweet_id = ref["id"]
        elif ref["type"] == "replied_to":
            is_reply = True
            reply_to_tweet_id = ref["id"]

    # Extract reply-to handle from included tweets + users
    reply_to_handle = None
    if reply_to_tweet_id:
        included_tweets = includes.get("tweets", [])
        for t in included_tweets:
            if t.get("id") == reply_to_tweet_id:
                reply_author = _find_author(t.get("author_id"), includes.get("users", []))
                if reply_author:
                    reply_to_handle = reply_author.get("username")
                break

    # Extract URL entities (from note_tweet for long tweets, else from regular entities)
    note_tweet = data.get("note_tweet", {})
    entities = note_tweet.get("entities", {}) if note_tweet.get("text") else data.get("entities", {})
    url_entities = _extract_url_entities(entities.get("urls", []))

    author_handle = author.get("username", "") if author else ""

    metrics = data.get("public_metrics", {})

    # Extract article title (X Articles / long-form posts)
    article_title = None
    article_data = data.get("article")
    if article_data and isinstance(article_data, dict):
        article_title = article_data.get("title")

    # Build normalized data for included/quoted tweets (avoids redundant API calls)
    included_tweets_data: list[dict] = []
    for inc_tweet in includes.get("tweets", []):
        inc_id = inc_tweet.get("id", "")
        # Skip the reply-to tweet, we only want quoted tweets
        if inc_id == reply_to_tweet_id:
            continue
        inc_author = _find_author(inc_tweet.get("author_id"), includes.get("users", []))
        inc_handle = inc_author.get("username", "") if inc_author else ""
        inc_metrics = inc_tweet.get("public_metrics", {})
        inc_media_urls = _extract_media_urls(
            inc_tweet.get("attachments", {}).get("media_keys", []),
            includes.get("media", []),
        )
        inc_note = inc_tweet.get("note_tweet", {})
        inc_entities = inc_note.get("entities", {}) if inc_note.get("text") else inc_tweet.get("entities", {})
        inc_ref = inc_tweet.get("referenced_tweets", [])
        inc_quoted_id = None
        inc_is_quote = False
        inc_is_reply = False
        inc_reply_to = None
        for r in inc_ref:
            if r["type"] == "quoted":
                inc_is_quote = True
                inc_quoted_id = r["id"]
            elif r["type"] == "replied_to":
                inc_is_reply = True
                inc_reply_to = r["id"]
        included_tweets_data.append({
            "tweet_id": inc_id,
            "author_handle": inc_handle,
            "author_display_name": inc_author.get("name", "") if inc_author else "",
            "author_avatar_url": inc_author.get("profile_image_url", "") if inc_author else "",
            "author_verified": (inc_author.get("verified", False) or bool(inc_author.get("verified_type"))) if inc_author else False,
            "text": html.unescape(inc_note.get("text") or inc_tweet.get("text", "")),
            "url": f"https://x.com/{inc_handle}/status/{inc_id}" if inc_handle else f"https://x.com/i/status/{inc_id}",
            "media_urls": inc_media_urls,
            "engagement": {
                "likes": inc_metrics.get("like_count", 0),
                "retweets": inc_metrics.get("retweet_count", 0),
                "replies": inc_metrics.get("reply_count", 0),
            },
            "is_quote_tweet": inc_is_quote,
            "is_reply": inc_is_reply,
            "quoted_tweet_id": inc_quoted_id,
            "reply_to_tweet_id": inc_reply_to,
            "url_entities": _extract_url_entities(inc_entities.get("urls", [])),
            "created_at": inc_tweet.get("created_at", ""),
        })

    return {
        "author_handle": author_handle,
        "author_display_name": author.get("name", "") if author else "",
        "author_avatar_url": author.get("profile_image_url", "") if author else "",
        "author_verified": (author.get("verified", False) or bool(author.get("verified_type"))) if author else False,
        "text": html.unescape(data.get("note_tweet", {}).get("text") or data.get("text", "")),
        "url": f"https://x.com/{author_handle}/status/{tweet_id}" if author_handle else f"https://x.com/i/status/{tweet_id}",
        "media_urls": media_urls,
        "engagement": {
            "likes": metrics.get("like_count", 0),
            "retweets": metrics.get("retweet_count", 0),
            "replies": metrics.get("reply_count", 0),
        },
        "is_quote_tweet": is_quote_tweet,
        "is_reply": is_reply,
        "quoted_tweet_id": quoted_tweet_id,
        "reply_to_tweet_id": reply_to_tweet_id,
        "reply_to_handle": reply_to_handle,
        "url_entities": url_entities,
        "article_title": article_title,
        "lang": data.get("lang"),
        "created_at": data.get("created_at", ""),
        "included_tweets": included_tweets_data,
    }


def _find_author(author_id: str | None, users: list[dict]) -> dict | None:
    """Find the author user object from the includes.users list."""
    if not author_id or not users:
        return None
    for user in users:
        if user.get("id") == author_id:
            return user
    return None


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
        # Link card metadata (title, description, image)
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


def _extract_media_urls(media_keys: list[str], media_list: list[dict]) -> list[dict] | None:
    """Extract structured media objects matching the given media keys."""
    if not media_keys or not media_list:
        return None

    media_by_key = {m["media_key"]: m for m in media_list}
    result = []
    for key in media_keys:
        media = media_by_key.get(key)
        if media:
            url = media.get("url") or media.get("preview_image_url", "")
            if url:
                result.append({
                    "type": media.get("type", "photo"),
                    "url": url,
                    "width": media.get("width"),
                    "height": media.get("height"),
                })
    return result if result else None
