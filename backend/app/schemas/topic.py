import datetime as _dt

from pydantic import BaseModel


class TopicCreate(BaseModel):
    title: str
    date: _dt.date
    color: str | None = None


class TopicUpdate(BaseModel):
    title: str | None = None
    date: _dt.date | None = None
    color: str | None = None
    position: int | None = None
    og_tweet_id: int | None = None


class TopicOut(BaseModel):
    id: int
    title: str
    date: _dt.date
    color: str | None
    position: int
    og_tweet_id: int | None = None
    tweet_count: int = 0
    created_at: _dt.datetime

    model_config = {"from_attributes": True}
