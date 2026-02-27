import html
from datetime import datetime
from typing import Any

from pydantic import BaseModel, field_validator


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
    url_entities: Any | None
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
    ai_topic_id: int | None = None
    ai_category: str | None = None
    ai_related_topic_id: int | None = None
    ai_topic_title: str | None = None
    ai_override: bool = False

    model_config = {"from_attributes": True}

    @field_validator("text", mode="before")
    @classmethod
    def unescape_text(cls, v: str) -> str:
        return html.unescape(v) if v else v


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
