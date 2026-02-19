from datetime import date, datetime

from pydantic import BaseModel


class TopicCreate(BaseModel):
    date: date
    title: str
    summary: str | None = None
    rank: int = 0
    lifecycle_status: str = "emerging"
    sentiment: str | None = None
    tags: dict | None = None


class TopicUpdate(BaseModel):
    title: str | None = None
    summary: str | None = None
    rank: int | None = None
    lifecycle_status: str | None = None
    sentiment: str | None = None
    tags: dict | None = None


class SubTopicCreate(BaseModel):
    title: str
    summary: str | None = None
    sentiment: str | None = None
    rank: int = 0


class SubTopicOut(BaseModel):
    id: int
    topic_id: int
    title: str
    summary: str | None
    sentiment: str | None
    rank: int

    model_config = {"from_attributes": True}


class TopicOut(BaseModel):
    id: int
    date: date
    title: str
    summary: str | None
    rank: int
    lifecycle_status: str
    sentiment: str | None
    tags: dict | None
    created_at: datetime
    subtopics: list[SubTopicOut] = []

    model_config = {"from_attributes": True}


class LinkTweetToSubTopic(BaseModel):
    tweet_id: int
    relevance_score: float = 0.0
    stance: str | None = None
