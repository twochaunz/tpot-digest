import re
from datetime import datetime


def parse_tweet_data(raw: dict) -> dict:
    """Normalize raw DOM-extracted tweet data into a structured dict."""
    return {
        "tweet_id": raw.get("tweet_id", ""),
        "author_handle": raw.get("author_handle", "").lstrip("@"),
        "author_display_name": raw.get("author_display_name", ""),
        "text": raw.get("text", ""),
        "media_urls": raw.get("media_urls", []),
        "article_urls": extract_urls(raw.get("text", "")),
        "engagement": {
            "likes": parse_count(raw.get("likes", "0")),
            "retweets": parse_count(raw.get("retweets", "0")),
            "replies": parse_count(raw.get("replies", "0")),
        },
        "is_retweet": raw.get("is_retweet", False),
        "is_quote_tweet": raw.get("is_quote_tweet", False),
        "quoted_tweet_id": raw.get("quoted_tweet_id"),
        "posted_at": raw.get("posted_at"),
    }


def parse_count(value: str) -> int:
    """Parse engagement counts like '1.2K', '3.4M', '500'."""
    if not value:
        return 0
    value = str(value).strip().replace(",", "")
    multipliers = {"K": 1000, "M": 1000000, "B": 1000000000}
    for suffix, mult in multipliers.items():
        if value.upper().endswith(suffix):
            return int(float(value[:-1]) * mult)
    try:
        return int(value)
    except ValueError:
        return 0


def extract_urls(text: str) -> list[str]:
    """Extract URLs from tweet text."""
    url_pattern = r'https?://[^\s<>"{}|\\^`\[\]]+'
    return re.findall(url_pattern, text)
