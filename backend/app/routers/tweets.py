import base64
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.models.assignment import TweetAssignment
from app.models.tweet import Tweet
from app.schemas.tweet import TweetAssignRequest, TweetOut, TweetSave, TweetUnassignRequest

router = APIRouter(prefix="/api/tweets", tags=["tweets"])


def _save_screenshot(tweet_id: str, b64: str) -> str:
    today = date.today().strftime("%Y%m%d")
    dir_path = Path(settings.data_dir) / today / "screenshots"
    dir_path.mkdir(parents=True, exist_ok=True)
    file_path = dir_path / f"tweet_{tweet_id}.png"
    file_path.write_bytes(base64.b64decode(b64))
    return str(file_path.relative_to(settings.data_dir))


@router.post("", status_code=201)
async def save_tweet(body: TweetSave, db: AsyncSession = Depends(get_db)):
    existing = (await db.execute(
        select(Tweet).where(Tweet.tweet_id == body.tweet_id)
    )).scalar_one_or_none()
    if existing:
        out = TweetOut.model_validate(existing)
        out.status = "duplicate"
        return JSONResponse(content=out.model_dump(mode="json"), status_code=200)

    screenshot_path = _save_screenshot(body.tweet_id, body.screenshot_base64)

    tweet = Tweet(
        tweet_id=body.tweet_id,
        author_handle=body.author_handle,
        author_display_name=body.author_display_name,
        text=body.text,
        media_urls={"urls": body.media_urls} if body.media_urls else None,
        engagement=body.engagement,
        is_quote_tweet=body.is_quote_tweet,
        is_reply=body.is_reply,
        quoted_tweet_id=body.quoted_tweet_id,
        reply_to_tweet_id=body.reply_to_tweet_id,
        reply_to_handle=body.reply_to_handle,
        thread_id=body.thread_id,
        thread_position=body.thread_position,
        screenshot_path=screenshot_path,
        feed_source=body.feed_source,
    )
    db.add(tweet)
    await db.flush()

    if body.topic_id:
        assignment = TweetAssignment(
            tweet_id=tweet.id, topic_id=body.topic_id, category_id=body.category_id
        )
        db.add(assignment)

    await db.commit()
    await db.refresh(tweet)
    return JSONResponse(
        content=TweetOut.model_validate(tweet).model_dump(mode="json"),
        status_code=201,
    )


@router.get("", response_model=list[TweetOut])
async def list_tweets(
    date: date | None = Query(None),
    topic_id: int | None = Query(None),
    category_id: int | None = Query(None),
    unassigned: bool = Query(False),
    q: str | None = Query(None),
    thread_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Tweet).order_by(Tweet.saved_at.desc())

    if date:
        from sqlalchemy import cast, Date as SQLDate
        stmt = stmt.where(cast(Tweet.saved_at, SQLDate) == date)

    if topic_id:
        assigned_ids = select(TweetAssignment.tweet_id).where(TweetAssignment.topic_id == topic_id)
        if category_id:
            assigned_ids = assigned_ids.where(TweetAssignment.category_id == category_id)
        stmt = stmt.where(Tweet.id.in_(assigned_ids))

    if unassigned:
        all_assigned = select(TweetAssignment.tweet_id)
        stmt = stmt.where(Tweet.id.not_in(all_assigned))

    if q:
        stmt = stmt.where(Tweet.text.ilike(f"%{q}%"))

    if thread_id:
        stmt = stmt.where(Tweet.thread_id == thread_id).order_by(Tweet.thread_position)

    result = await db.execute(stmt)
    return result.scalars().all()


@router.delete("/{tweet_id}", status_code=204)
async def delete_tweet(tweet_id: int, db: AsyncSession = Depends(get_db)):
    tweet = await db.get(Tweet, tweet_id)
    if not tweet:
        raise HTTPException(404, "Tweet not found")
    await db.delete(tweet)
    await db.commit()


@router.post("/assign", status_code=200)
async def assign_tweets(body: TweetAssignRequest, db: AsyncSession = Depends(get_db)):
    for tid in body.tweet_ids:
        existing = (await db.execute(
            select(TweetAssignment).where(
                TweetAssignment.tweet_id == tid,
                TweetAssignment.topic_id == body.topic_id,
            )
        )).scalar_one_or_none()
        if existing:
            existing.category_id = body.category_id
        else:
            db.add(TweetAssignment(
                tweet_id=tid, topic_id=body.topic_id, category_id=body.category_id
            ))
    await db.commit()
    return {"assigned": len(body.tweet_ids)}


@router.post("/unassign", status_code=200)
async def unassign_tweets(body: TweetUnassignRequest, db: AsyncSession = Depends(get_db)):
    for tid in body.tweet_ids:
        existing = (await db.execute(
            select(TweetAssignment).where(
                TweetAssignment.tweet_id == tid,
                TweetAssignment.topic_id == body.topic_id,
            )
        )).scalar_one_or_none()
        if existing:
            await db.delete(existing)
    await db.commit()
    return {"unassigned": len(body.tweet_ids)}
