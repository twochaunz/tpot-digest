from datetime import datetime
from typing import Any

from pydantic import BaseModel


class TweetSave(BaseModel):
    tweet_id: str
    feed_source: str | None = None
    thread_id: str | None = None
    thread_position: int | None = None
    topic_id: int | None = None
    category: str | None = None
    saved_at: datetime | None = None


class TweetOut(BaseModel):
    id: int
    tweet_id: str
    author_handle: str
    author_display_name: str | None
    author_avatar_url: str | None
    author_verified: bool
    text: str
    media_urls: Any | None
    engagement: dict | None
    is_quote_tweet: bool
    is_reply: bool
    quoted_tweet_id: str | None
    reply_to_tweet_id: str | None
    reply_to_handle: str | None
    thread_id: str | None
    thread_position: int | None
    screenshot_path: str | None
    feed_source: str | None
    url: str | None
    created_at: datetime | None
    memo: str | None
    grok_context: str | None
    saved_at: datetime
    category: str | None = None
    status: str = "saved"

    model_config = {"from_attributes": True}


class TweetUpdate(BaseModel):
    memo: str | None = None
    saved_at: datetime | None = None


class TweetCheckRequest(BaseModel):
    tweet_ids: list[str]


class TweetAssignRequest(BaseModel):
    tweet_ids: list[int]
    topic_id: int
    category: str | None = None


class TweetUnassignRequest(BaseModel):
    tweet_ids: list[int]
    topic_id: int
