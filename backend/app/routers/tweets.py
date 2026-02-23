from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.assignment import TweetAssignment
from app.models.tweet import Tweet
from app.schemas.tweet import TweetAssignRequest, TweetCheckRequest, TweetOut, TweetSave, TweetUnassignRequest, TweetUpdate

router = APIRouter(prefix="/api/tweets", tags=["tweets"])


@router.post("", status_code=201)
async def save_tweet(body: TweetSave, db: AsyncSession = Depends(get_db)):
    existing = (await db.execute(
        select(Tweet).where(Tweet.tweet_id == body.tweet_id)
    )).scalar_one_or_none()
    if existing:
        out = TweetOut.model_validate(existing)
        out.status = "duplicate"
        return JSONResponse(content=out.model_dump(mode="json"), status_code=200)

    from app.services.x_api import fetch_tweet, XAPIError
    try:
        api_data = await fetch_tweet(body.tweet_id)
    except XAPIError as e:
        raise HTTPException(status_code=502, detail=str(e))

    kwargs = dict(
        tweet_id=body.tweet_id,
        author_handle=api_data["author_handle"],
        author_display_name=api_data["author_display_name"],
        author_avatar_url=api_data["author_avatar_url"],
        author_verified=api_data["author_verified"],
        text=api_data["text"],
        media_urls=api_data["media_urls"],
        engagement=api_data["engagement"],
        is_quote_tweet=api_data["is_quote_tweet"],
        is_reply=api_data["is_reply"],
        quoted_tweet_id=api_data["quoted_tweet_id"],
        reply_to_tweet_id=api_data.get("reply_to_tweet_id"),
        url=api_data["url"],
        created_at=datetime.fromisoformat(api_data["created_at"].replace("Z", "+00:00")) if api_data.get("created_at") else None,
        feed_source=body.feed_source,
        thread_id=body.thread_id,
        thread_position=body.thread_position,
    )
    if body.saved_at:
        kwargs["saved_at"] = body.saved_at
    tweet = Tweet(**kwargs)
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
    stmt = select(Tweet)

    if date:
        from sqlalchemy import func, text
        local_date = func.date(func.timezone(text("'America/Los_Angeles'"), Tweet.saved_at))
        stmt = stmt.where(local_date == date)

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
    else:
        stmt = stmt.order_by(Tweet.saved_at.desc())

    result = await db.execute(stmt)
    return result.scalars().all()


@router.delete("/{tweet_id}", status_code=204)
async def delete_tweet(tweet_id: int, db: AsyncSession = Depends(get_db)):
    tweet = await db.get(Tweet, tweet_id)
    if not tweet:
        raise HTTPException(404, "Tweet not found")
    await db.delete(tweet)
    await db.commit()


@router.patch("/{tweet_id}", response_model=TweetOut)
async def update_tweet(tweet_id: int, body: TweetUpdate, db: AsyncSession = Depends(get_db)):
    tweet = await db.get(Tweet, tweet_id)
    if not tweet:
        raise HTTPException(404, "Tweet not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(tweet, field, value)
    await db.commit()
    await db.refresh(tweet)
    return tweet


@router.post("/{tweet_id}/grok", response_model=TweetOut)
async def fetch_grok(
    tweet_id: int,
    force: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    tweet = await db.get(Tweet, tweet_id)
    if not tweet:
        raise HTTPException(404, "Tweet not found")

    if tweet.grok_context and not force:
        return tweet

    from app.services.grok_api import fetch_grok_context, XAIAPIError
    try:
        context = await fetch_grok_context(
            tweet.text, tweet.author_handle, tweet.tweet_id, tweet.url
        )
    except XAIAPIError as e:
        raise HTTPException(status_code=502, detail=str(e))

    tweet.grok_context = context
    await db.commit()
    await db.refresh(tweet)
    return tweet


@router.post("/check", status_code=200)
async def check_saved(body: TweetCheckRequest, db: AsyncSession = Depends(get_db)):
    if not body.tweet_ids:
        return {"saved": {}}
    result = await db.execute(
        select(Tweet.tweet_id, Tweet.id).where(Tweet.tweet_id.in_(body.tweet_ids))
    )
    saved = {row[0]: row[1] for row in result.all()}
    return {"saved": saved}


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
