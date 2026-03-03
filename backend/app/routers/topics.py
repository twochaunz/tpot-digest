from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import require_admin
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.assignment import TweetAssignment
from app.models.topic import Topic
from app.models.tweet import Tweet
from app.schemas.topic import TopicCreate, TopicOut, TopicUpdate
from app.services.grok_api import fetch_grok_context, GrokAPIError
from app.services.smart_title import smart_title_case, _fallback_title_case as title_case

router = APIRouter(prefix="/api/topics", tags=["topics"])


TOPIC_COLORS = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
    '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7',
]


@router.post("", response_model=TopicOut, status_code=201)
async def create_topic(body: TopicCreate, db: AsyncSession = Depends(get_db), _admin=Depends(require_admin)):
    color = body.color
    if not color:
        count = (await db.execute(
            select(func.count()).select_from(Topic).where(Topic.date == body.date)
        )).scalar() or 0
        color = TOPIC_COLORS[count % len(TOPIC_COLORS)]

    # Fetch unsorted tweets for this date as context for smart title casing
    unsorted_stmt = (
        select(Tweet.text)
        .outerjoin(TweetAssignment, TweetAssignment.tweet_id == Tweet.id)
        .where(
            func.date(Tweet.saved_at) == body.date,
            TweetAssignment.id.is_(None),
        )
        .order_by(Tweet.saved_at.desc())
        .limit(5)
    )
    tweet_rows = (await db.execute(unsorted_stmt)).scalars().all()
    tweet_texts = [t for t in tweet_rows if t]

    smart_title = await smart_title_case(body.title, tweet_texts)
    topic = Topic(title=smart_title, date=body.date, color=color)
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
async def update_topic(topic_id: int, body: TopicUpdate, db: AsyncSession = Depends(get_db), _admin=Depends(require_admin)):
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

        # Generate topic embedding for similarity search
        from app.services.embeddings import embed_text
        embed_source = f"{topic.title} {tweet.text or ''} {tweet.grok_context or ''}"
        topic.embedding = embed_text(embed_source)

    # When date changes, move all assigned tweets to the new date
    if "date" in data and data["date"] != topic.date:
        from datetime import datetime, timezone
        new_date = data["date"]
        new_saved_at = datetime(new_date.year, new_date.month, new_date.day, 12, 0, 0, tzinfo=timezone.utc)
        assigned = (await db.execute(
            select(TweetAssignment.tweet_id).where(TweetAssignment.topic_id == topic_id)
        )).scalars().all()
        if assigned:
            tweet_rows = (await db.execute(
                select(Tweet).where(Tweet.id.in_(assigned))
            )).scalars().all()
            for tw in tweet_rows:
                tw.saved_at = new_saved_at

    for field, value in data.items():
        setattr(topic, field, value)

    # Re-embed if title changes and we have an OG tweet
    if "title" in data and topic.og_tweet_id:
        og = await db.get(Tweet, topic.og_tweet_id)
        if og:
            from app.services.embeddings import embed_text
            embed_source = f"{topic.title} {og.text or ''} {og.grok_context or ''}"
            topic.embedding = embed_text(embed_source)

    await db.commit()
    await db.refresh(topic)
    return topic


@router.post("/{topic_id}/recategorize", status_code=200)
async def recategorize_topic(topic_id: int, db: AsyncSession = Depends(get_db), _admin=Depends(require_admin)):
    """Re-categorize all uncategorized tweets in a topic using Claude."""
    topic = await db.get(Topic, topic_id)
    if not topic:
        raise HTTPException(404, "Topic not found")
    if not topic.og_tweet_id:
        raise HTTPException(400, "Topic has no OG tweet set")
    from starlette.responses import JSONResponse
    from starlette.background import BackgroundTask
    from app.services.classifier import recategorize_topic_tweets
    return JSONResponse(
        content={"status": "recategorizing", "topic_id": topic_id},
        background=BackgroundTask(recategorize_topic_tweets, topic_id),
    )


@router.post("/recategorize-date", status_code=200)
async def recategorize_date(date: date = Query(...), db: AsyncSession = Depends(get_db), _admin=Depends(require_admin)):
    """Re-categorize all tweets in all topics for a given date."""
    result = await db.execute(select(Topic).where(Topic.date == date, Topic.og_tweet_id.isnot(None)))
    topics = result.scalars().all()
    if not topics:
        return {"status": "no topics with OG tweets", "count": 0}
    from starlette.responses import JSONResponse
    from starlette.background import BackgroundTask
    from app.services.classifier import recategorize_topic_tweets

    async def _recategorize_all():
        for t in topics:
            await recategorize_topic_tweets(t.id)

    return JSONResponse(
        content={"status": "recategorizing", "count": len(topics)},
        background=BackgroundTask(_recategorize_all),
    )


@router.post("/fix-title-case", status_code=200)
async def fix_all_title_case(db: AsyncSession = Depends(get_db), _admin=Depends(require_admin)):
    """One-time: apply title case to all existing topics."""
    result = await db.execute(select(Topic))
    topics = result.scalars().all()
    updated = 0
    for topic in topics:
        new_title = title_case(topic.title)
        if new_title != topic.title:
            topic.title = new_title
            updated += 1
    await db.commit()
    return {"updated": updated, "total": len(topics)}


@router.delete("/{topic_id}", status_code=204)
async def delete_topic(topic_id: int, db: AsyncSession = Depends(get_db), _admin=Depends(require_admin)):
    topic = await db.get(Topic, topic_id)
    if not topic:
        raise HTTPException(404, "Topic not found")
    await db.delete(topic)
    await db.commit()
