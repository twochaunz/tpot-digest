from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.assignment import TweetAssignment
from app.models.topic import Topic
from app.models.tweet import Tweet
from app.schemas.topic import TopicCreate, TopicOut, TopicUpdate
from app.services.grok_api import fetch_grok_context, GrokAPIError

router = APIRouter(prefix="/api/topics", tags=["topics"])

TOPIC_COLORS = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
    '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7',
]


@router.post("", response_model=TopicOut, status_code=201)
async def create_topic(body: TopicCreate, db: AsyncSession = Depends(get_db)):
    color = body.color
    if not color:
        count_result = await db.execute(select(Topic).where(Topic.date == body.date))
        count = len(count_result.scalars().all())
        color = TOPIC_COLORS[count % len(TOPIC_COLORS)]
    topic = Topic(title=body.title, date=body.date, color=color)
    db.add(topic)
    await db.commit()
    await db.refresh(topic)
    return topic


@router.get("", response_model=list[TopicOut])
async def list_topics(
    date: date = Query(..., description="Filter by date"),
    db: AsyncSession = Depends(get_db),
):
    tweet_count = func.count(TweetAssignment.tweet_id).label("tweet_count")
    stmt = (
        select(Topic, tweet_count)
        .outerjoin(TweetAssignment, TweetAssignment.topic_id == Topic.id)
        .where(Topic.date == date)
        .group_by(Topic.id)
        .order_by(tweet_count.desc(), Topic.position)
    )
    result = await db.execute(stmt)
    rows = result.all()
    topics = []
    for topic, count in rows:
        out = TopicOut.model_validate(topic)
        out.tweet_count = count
        topics.append(out)
    return topics


@router.patch("/{topic_id}", response_model=TopicOut)
async def update_topic(topic_id: int, body: TopicUpdate, db: AsyncSession = Depends(get_db)):
    topic = await db.get(Topic, topic_id)
    if not topic:
        raise HTTPException(404, "Topic not found")

    data = body.model_dump(exclude_unset=True)

    # Handle og_tweet_id: validate tweet exists, auto-assign if needed
    if "og_tweet_id" in data and data["og_tweet_id"] is not None:
        tweet_id = data["og_tweet_id"]
        tweet = await db.get(Tweet, tweet_id)
        if not tweet:
            raise HTTPException(404, "Tweet not found")
        # Check if assigned to this topic; if not, auto-assign
        existing = (await db.execute(
            select(TweetAssignment).where(
                TweetAssignment.tweet_id == tweet_id,
                TweetAssignment.topic_id == topic_id,
            )
        )).scalar_one_or_none()
        if not existing:
            db.add(TweetAssignment(tweet_id=tweet_id, topic_id=topic_id))

        # Auto-fetch Grok context if empty
        if not tweet.grok_context and tweet.url:
            try:
                tweet.grok_context = await fetch_grok_context(tweet.url)
            except GrokAPIError:
                pass  # Non-blocking: OG is set even if Grok fails

    for field, value in data.items():
        setattr(topic, field, value)

    await db.commit()
    await db.refresh(topic)
    return topic


@router.delete("/{topic_id}", status_code=204)
async def delete_topic(topic_id: int, db: AsyncSession = Depends(get_db)):
    topic = await db.get(Topic, topic_id)
    if not topic:
        raise HTTPException(404, "Topic not found")
    await db.delete(topic)
    await db.commit()
