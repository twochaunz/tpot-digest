from typing import Literal

from pydantic import BaseModel, field_validator


class TweetIngest(BaseModel):
    tweet_id: str
    author_handle: str
    author_display_name: str | None = None
    text: str
    media_urls: list[str] | None = None
    article_urls: list[str] | None = None
    engagement: dict | None = None
    is_retweet: bool = False
    is_quote_tweet: bool = False
    quoted_tweet_id: str | None = None
    screenshot_base64: str
    feed_source: str | None = None

    @field_validator("screenshot_base64")
    @classmethod
    def strip_data_url_prefix(cls, v: str) -> str:
        if "," in v[:64]:
            return v.split(",", 1)[1]
        return v


class IngestResponse(BaseModel):
    id: int
    tweet_id: str
    author_handle: str
    status: Literal["saved", "duplicate"]

    model_config = {"from_attributes": True}


class BatchIngestRequest(BaseModel):
    tweets: list[TweetIngest]


class BatchIngestResponse(BaseModel):
    results: list[IngestResponse]
    saved_count: int
    duplicate_count: int


class ClusterTriggerResponse(BaseModel):
    status: Literal["started", "no_tweets"]
    unclustered_count: int
