from datetime import datetime

from pydantic import BaseModel


class TweetCreate(BaseModel):
    tweet_id: str
    author_handle: str
    text: str
    media_urls: dict | None = None
    article_urls: dict | None = None
    posted_at: datetime | None = None
    engagement: dict | None = None
    is_retweet: bool = False
    is_quote_tweet: bool = False
    quoted_tweet_id: str | None = None
    feed_source: str | None = None


class TweetOut(BaseModel):
    id: int
    tweet_id: str
    author_handle: str
    text: str
    media_urls: dict | None
    article_urls: dict | None
    posted_at: datetime | None
    scraped_at: datetime
    engagement: dict | None
    engagement_velocity: float | None
    is_retweet: bool
    is_quote_tweet: bool
    quality_score: float | None
    feed_source: str | None

    model_config = {"from_attributes": True}


class TweetFromUrl(BaseModel):
    url: str
