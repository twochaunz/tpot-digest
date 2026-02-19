from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.topic import LifecycleStatus, SubTopic, SubTopicTweet, Topic
from app.schemas.topic import (
    LinkTweetToSubTopic,
    SubTopicCreate,
    SubTopicOut,
    TopicCreate,
    TopicOut,
    TopicUpdate,
)

router = APIRouter(prefix="/api/topics", tags=["topics"])

# Secondary router for subtopic-level endpoints (different prefix)
subtopics_router = APIRouter(prefix="/api/subtopics", tags=["topics"])


@router.get("", response_model=list[TopicOut])
async def list_topics(
    date: date = Query(..., description="Filter topics by date (YYYY-MM-DD)"),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Topic).where(Topic.date == date).order_by(Topic.rank)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{topic_id}", response_model=TopicOut)
async def get_topic(topic_id: int, db: AsyncSession = Depends(get_db)):
    topic = await db.get(Topic, topic_id)
    if not topic:
        raise HTTPException(404, "Topic not found")
    return topic


@router.post("", response_model=TopicOut, status_code=201)
async def create_topic(body: TopicCreate, db: AsyncSession = Depends(get_db)):
    topic = Topic(
        date=body.date,
        title=body.title,
        summary=body.summary,
        rank=body.rank,
        lifecycle_status=LifecycleStatus(body.lifecycle_status),
        sentiment=body.sentiment,
        tags=body.tags,
    )
    db.add(topic)
    await db.commit()
    await db.refresh(topic)
    return topic


@router.patch("/{topic_id}", response_model=TopicOut)
async def update_topic(topic_id: int, body: TopicUpdate, db: AsyncSession = Depends(get_db)):
    topic = await db.get(Topic, topic_id)
    if not topic:
        raise HTTPException(404, "Topic not found")
    updates = body.model_dump(exclude_unset=True)
    if "lifecycle_status" in updates and updates["lifecycle_status"] is not None:
        updates["lifecycle_status"] = LifecycleStatus(updates["lifecycle_status"])
    for field, value in updates.items():
        setattr(topic, field, value)
    await db.commit()
    await db.refresh(topic)
    return topic


@router.post("/{topic_id}/subtopics", response_model=SubTopicOut, status_code=201)
async def create_subtopic(topic_id: int, body: SubTopicCreate, db: AsyncSession = Depends(get_db)):
    topic = await db.get(Topic, topic_id)
    if not topic:
        raise HTTPException(404, "Topic not found")
    subtopic = SubTopic(
        topic_id=topic_id,
        title=body.title,
        summary=body.summary,
        sentiment=body.sentiment,
        rank=body.rank,
    )
    db.add(subtopic)
    await db.commit()
    await db.refresh(subtopic)
    return subtopic


@subtopics_router.post("/{subtopic_id}/tweets", status_code=201)
async def link_tweet_to_subtopic(
    subtopic_id: int, body: LinkTweetToSubTopic, db: AsyncSession = Depends(get_db),
):
    subtopic = await db.get(SubTopic, subtopic_id)
    if not subtopic:
        raise HTTPException(404, "SubTopic not found")
    link = SubTopicTweet(
        subtopic_id=subtopic_id,
        tweet_id=body.tweet_id,
        relevance_score=body.relevance_score,
        stance=body.stance,
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return {
        "id": link.id,
        "subtopic_id": link.subtopic_id,
        "tweet_id": link.tweet_id,
        "relevance_score": link.relevance_score,
        "stance": link.stance,
    }
