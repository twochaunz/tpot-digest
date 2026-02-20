from datetime import datetime

from pydantic import BaseModel


class TweetSave(BaseModel):
    tweet_id: str
    author_handle: str
    author_display_name: str | None = None
    text: str = ""
    media_urls: list[str] | None = None
    engagement: dict | None = None
    is_quote_tweet: bool = False
    is_reply: bool = False
    quoted_tweet_id: str | None = None
    reply_to_tweet_id: str | None = None
    reply_to_handle: str | None = None
    thread_id: str | None = None
    thread_position: int | None = None
    screenshot_base64: str | None = None
    screenshot_error: str | None = None
    feed_source: str | None = None
    topic_id: int | None = None
    category_id: int | None = None


class TweetOut(BaseModel):
    id: int
    tweet_id: str
    author_handle: str
    author_display_name: str | None
    text: str
    media_urls: dict | None
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
    saved_at: datetime
    status: str = "saved"

    model_config = {"from_attributes": True}


class TweetAssignRequest(BaseModel):
    tweet_ids: list[int]
    topic_id: int
    category_id: int | None = None


class TweetUnassignRequest(BaseModel):
    tweet_ids: list[int]
    topic_id: int
