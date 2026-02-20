from pydantic import BaseModel


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


class IngestResponse(BaseModel):
    id: int
    tweet_id: str
    author_handle: str
    status: str  # "saved" | "duplicate"

    model_config = {"from_attributes": True}


class BatchIngestRequest(BaseModel):
    tweets: list[TweetIngest]


class BatchIngestResponse(BaseModel):
    results: list[IngestResponse]
    saved_count: int
    duplicate_count: int


class ClusterTriggerResponse(BaseModel):
    status: str  # "started" | "no_tweets"
    unclustered_count: int
