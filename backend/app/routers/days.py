from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.assignment import TweetAssignment
from app.models.topic import Topic
from app.models.tweet import Tweet
from app.schemas.day_bundle import DayBundle, TopicBundle
from app.schemas.tweet import TweetOut

router = APIRouter(prefix="/api/days", tags=["days"])


@router.get("/{day}/bundle", response_model=DayBundle)
async def get_day_bundle(day: date, db: AsyncSession = Depends(get_db)):
    la = ZoneInfo("America/Los_Angeles")
    day_start = datetime.combine(day, time.min, tzinfo=la).astimezone(timezone.utc)
    day_end = datetime.combine(day, time.max, tzinfo=la).astimezone(timezone.utc)

    # 1. Fetch all topics for this date
    topic_rows = (await db.execute(
        select(Topic).where(Topic.date == day).order_by(Topic.position)
    )).scalars().all()

    # 2. Fetch ALL tweets for this date in one query
    all_tweets = (await db.execute(
        select(Tweet)
        .where(Tweet.saved_at >= day_start, Tweet.saved_at <= day_end)
        .order_by(Tweet.saved_at.desc(), Tweet.id.desc())
    )).scalars().all()

    # 3. Fetch all assignments for these tweets in one query
    tweet_ids = [t.id for t in all_tweets]
    assignments: list[TweetAssignment] = []
    if tweet_ids:
        assignments = (await db.execute(
            select(TweetAssignment).where(TweetAssignment.tweet_id.in_(tweet_ids))
        )).scalars().all()

    # Build lookup: tweet_id -> list of (topic_id, category)
    assign_map: dict[int, list[tuple[int, str | None]]] = {}
    for a in assignments:
        assign_map.setdefault(a.tweet_id, []).append((a.topic_id, a.category))

    # Build topic bundles
    assigned_tweet_ids: set[int] = set()
    topics: list[TopicBundle] = []
    for topic in topic_rows:
        topic_tweets: list[TweetOut] = []
        for tweet in all_tweets:
            for topic_id, category in assign_map.get(tweet.id, []):
                if topic_id == topic.id:
                    out = TweetOut.model_validate(tweet)
                    out.category = category
                    topic_tweets.append(out)
                    assigned_tweet_ids.add(tweet.id)
                    break
        tb = TopicBundle.model_validate(topic)
        tb.tweet_count = len(topic_tweets)
        tb.tweets = topic_tweets
        topics.append(tb)

    # Unsorted = tweets not assigned to any topic
    unsorted = [
        TweetOut.model_validate(t) for t in all_tweets
        if t.id not in assigned_tweet_ids
    ]

    return DayBundle(topics=topics, unsorted=unsorted)
