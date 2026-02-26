from pydantic import BaseModel

from app.schemas.topic import TopicOut
from app.schemas.tweet import TweetOut


class TopicBundle(TopicOut):
    tweets: list[TweetOut] = []


class DayBundle(BaseModel):
    topics: list[TopicBundle] = []
    unsorted: list[TweetOut] = []
