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


def _tweet_out_with_category(tweet: Tweet, category: str | None) -> TweetOut:
    out = TweetOut.model_validate(tweet)
    out.category = category
    return out


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

    # Build lookups: topic_id -> [(tweet, category)], and set of all assigned tweet ids
    tweet_by_id = {t.id: t for t in all_tweets}
    topic_tweets_map: dict[int, list[tuple[Tweet, str | None]]] = {t.id: [] for t in topic_rows}
    assigned_tweet_ids: set[int] = set()
    for a in assignments:
        tweet = tweet_by_id.get(a.tweet_id)
        if tweet and a.topic_id in topic_tweets_map:
            topic_tweets_map[a.topic_id].append((tweet, a.category))
            assigned_tweet_ids.add(a.tweet_id)

    # Build topic bundles
    topics: list[TopicBundle] = []
    for topic in topic_rows:
        topic_tweets = [
            _tweet_out_with_category(tw, cat)
            for tw, cat in topic_tweets_map[topic.id]
        ]
        tb = TopicBundle.model_validate(topic)
        tb.tweet_count = len(topic_tweets)
        tb.tweets = topic_tweets
        topics.append(tb)

    # Build topic title lookup for AI suggestion labels
    topic_title_map = {t.id: t.title for t in topic_rows}

    # Unsorted = tweets not assigned to any topic
    unsorted = []
    for t in all_tweets:
        if t.id not in assigned_tweet_ids:
            out = TweetOut.model_validate(t)
            if out.ai_topic_id:
                if out.ai_topic_id in topic_title_map:
                    out.ai_topic_title = topic_title_map[out.ai_topic_id]
                else:
                    # Topic might be from a different day
                    topic = await db.get(Topic, out.ai_topic_id)
                    if topic:
                        out.ai_topic_title = topic.title
                        topic_title_map[topic.id] = topic.title
            elif out.ai_new_topic_title:
                out.ai_topic_title = out.ai_new_topic_title
            unsorted.append(out)

    return DayBundle(topics=topics, unsorted=unsorted)
