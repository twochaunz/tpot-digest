import logging
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask

import app.db as db_module
from app.db import get_db
from app.models.assignment import TweetAssignment
from app.models.topic import Topic
from app.models.tweet import Tweet
from pydantic import BaseModel
from app.schemas.tweet import TweetAssignRequest, TweetCheckRequest, TweetOut, TweetSave, TweetUnassignRequest, TweetUpdate

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/tweets", tags=["tweets"])


async def _backfill_tweet(tweet_id: int, tweet_x_id: str, topic_id: int | None, category: str | None):
    """Background task: fetch X API data and update the placeholder tweet."""
    from app.services.x_api import fetch_tweet, XAPIError

    try:
        api_data = await fetch_tweet(tweet_x_id)
    except XAPIError as e:
        logger.warning("X API backfill failed for %s: %s", tweet_x_id, e)
        return

    async with db_module.async_session() as db:
        tweet = await db.get(Tweet, tweet_id)
        if not tweet:
            return

        tweet.author_handle = api_data["author_handle"]
        tweet.author_display_name = api_data["author_display_name"]
        tweet.author_avatar_url = api_data["author_avatar_url"]
        tweet.author_verified = api_data["author_verified"]
        tweet.text = api_data["text"]
        tweet.media_urls = api_data["media_urls"]
        tweet.engagement = api_data["engagement"]
        tweet.is_quote_tweet = api_data["is_quote_tweet"]
        tweet.is_reply = api_data["is_reply"]
        tweet.quoted_tweet_id = api_data["quoted_tweet_id"]
        tweet.reply_to_tweet_id = api_data.get("reply_to_tweet_id")
        tweet.reply_to_handle = api_data.get("reply_to_handle")
        tweet.url_entities = api_data.get("url_entities")
        tweet.url = api_data["url"]
        if api_data.get("created_at"):
            tweet.created_at = datetime.fromisoformat(api_data["created_at"].replace("Z", "+00:00"))

        if topic_id:
            existing = (await db.execute(
                select(TweetAssignment).where(
                    TweetAssignment.tweet_id == tweet_id,
                    TweetAssignment.topic_id == topic_id,
                )
            )).scalar_one_or_none()
            if not existing:
                db.add(TweetAssignment(tweet_id=tweet_id, topic_id=topic_id, category=category))

        await db.commit()

    # Run AI classification pipeline
    from app.services.classifier import classify_pipeline
    try:
        await classify_pipeline(tweet_id)
    except Exception as e:
        logger.warning("Classification pipeline failed for tweet %d: %s", tweet_id, e)


@router.post("", status_code=201)
async def save_tweet(body: TweetSave, db: AsyncSession = Depends(get_db)):
    existing = (await db.execute(
        select(Tweet).where(Tweet.tweet_id == body.tweet_id)
    )).scalar_one_or_none()
    if existing:
        out = TweetOut.model_validate(existing)
        out.status = "duplicate"
        return JSONResponse(content=out.model_dump(mode="json"), status_code=200)

    # Create placeholder immediately, backfill from X API in background
    kwargs: dict = dict(
        tweet_id=body.tweet_id,
        author_handle="",
        text="",
        feed_source=body.feed_source,
        thread_id=body.thread_id,
        thread_position=body.thread_position,
    )
    if body.saved_at:
        kwargs["saved_at"] = body.saved_at
    tweet = Tweet(**kwargs)
    db.add(tweet)
    await db.commit()

    return JSONResponse(
        content={"id": tweet.id, "tweet_id": body.tweet_id, "status": "saved"},
        status_code=201,
        background=BackgroundTask(_backfill_tweet, tweet.id, body.tweet_id, body.topic_id, body.category),
    )


@router.get("", response_model=list[TweetOut])
async def list_tweets(
    date: date | None = Query(None),
    topic_id: int | None = Query(None),
    category: str | None = Query(None),
    unassigned: bool = Query(False),
    q: str | None = Query(None),
    thread_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    if topic_id:
        # Join with TweetAssignment to get category
        stmt = select(Tweet, TweetAssignment.category).join(
            TweetAssignment, TweetAssignment.tweet_id == Tweet.id
        ).where(TweetAssignment.topic_id == topic_id)

        if category:
            stmt = stmt.where(TweetAssignment.category == category)
    else:
        stmt = select(Tweet)

    if date:
        la = ZoneInfo('America/Los_Angeles')
        day_start = datetime.combine(date, time.min, tzinfo=la).astimezone(timezone.utc)
        day_end = datetime.combine(date, time.max, tzinfo=la).astimezone(timezone.utc)
        stmt = stmt.where(Tweet.saved_at >= day_start, Tweet.saved_at <= day_end)

    if unassigned:
        stmt = stmt.where(
            ~exists(
                select(TweetAssignment.tweet_id)
                .where(TweetAssignment.tweet_id == Tweet.id)
            )
        )

    if q:
        stmt = stmt.where(Tweet.text.ilike(f"%{q}%"))

    if thread_id:
        stmt = stmt.where(Tweet.thread_id == thread_id).order_by(Tweet.thread_position)
    else:
        stmt = stmt.order_by(Tweet.saved_at.desc(), Tweet.id.desc())

    result = await db.execute(stmt)

    if topic_id:
        tweets = []
        for row in result.all():
            tweet_obj = row[0]
            cat = row[1]
            tweet_out = TweetOut.model_validate(tweet_obj)
            tweet_out.category = cat
            tweets.append(tweet_out)
        return tweets
    else:
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

    from app.services.grok_api import fetch_grok_context, GrokAPIError
    try:
        tweet_url = tweet.url or f"https://x.com/{tweet.author_handle}/status/{tweet.tweet_id}"
        context = await fetch_grok_context(tweet_url)
    except GrokAPIError as e:
        raise HTTPException(status_code=502, detail=str(e))

    tweet.grok_context = context
    await db.commit()
    await db.refresh(tweet)
    return tweet


@router.post("/{tweet_id}/refetch", response_model=TweetOut)
async def refetch_tweet(tweet_id: int, db: AsyncSession = Depends(get_db)):
    tweet = await db.get(Tweet, tweet_id)
    if not tweet:
        raise HTTPException(404, "Tweet not found")

    from app.services.x_api import fetch_tweet, XAPIError
    try:
        api_data = await fetch_tweet(tweet.tweet_id)
    except XAPIError as e:
        raise HTTPException(status_code=502, detail=str(e))

    tweet.author_handle = api_data["author_handle"]
    tweet.author_display_name = api_data["author_display_name"]
    tweet.author_avatar_url = api_data["author_avatar_url"]
    tweet.author_verified = api_data["author_verified"]
    tweet.text = api_data["text"]
    tweet.media_urls = api_data["media_urls"]
    tweet.engagement = api_data["engagement"]
    tweet.url = api_data["url"]
    tweet.is_quote_tweet = api_data["is_quote_tweet"]
    tweet.is_reply = api_data["is_reply"]
    tweet.quoted_tweet_id = api_data.get("quoted_tweet_id")
    tweet.reply_to_tweet_id = api_data.get("reply_to_tweet_id")
    tweet.reply_to_handle = api_data.get("reply_to_handle")
    tweet.url_entities = api_data.get("url_entities")
    if api_data.get("created_at"):
        tweet.created_at = datetime.fromisoformat(api_data["created_at"].replace("Z", "+00:00"))

    await db.commit()
    await db.refresh(tweet)
    return tweet


@router.post("/refetch-all", status_code=200)
async def refetch_all_tweets(db: AsyncSession = Depends(get_db)):
    """Refetch all tweets from X API to update text/engagement/media."""
    import asyncio
    from app.services.x_api import fetch_tweet, XAPIError

    tweets = (await db.execute(select(Tweet))).scalars().all()
    updated = 0
    failed = 0
    for tweet in tweets:
        try:
            api_data = await fetch_tweet(tweet.tweet_id)
            tweet.text = api_data["text"]
            tweet.author_handle = api_data["author_handle"]
            tweet.author_display_name = api_data["author_display_name"]
            tweet.author_avatar_url = api_data["author_avatar_url"]
            tweet.author_verified = api_data["author_verified"]
            tweet.media_urls = api_data["media_urls"]
            tweet.engagement = api_data["engagement"]
            tweet.url = api_data["url"]
            tweet.is_quote_tweet = api_data["is_quote_tweet"]
            tweet.is_reply = api_data["is_reply"]
            tweet.quoted_tweet_id = api_data.get("quoted_tweet_id")
            tweet.reply_to_tweet_id = api_data.get("reply_to_tweet_id")
            tweet.reply_to_handle = api_data.get("reply_to_handle")
            tweet.url_entities = api_data.get("url_entities")
            if api_data.get("created_at"):
                tweet.created_at = datetime.fromisoformat(api_data["created_at"].replace("Z", "+00:00"))
            updated += 1
        except (XAPIError, Exception):
            failed += 1
        # Rate limit: small delay between requests
        await asyncio.sleep(0.5)

    await db.commit()
    return {"updated": updated, "failed": failed, "total": len(tweets)}


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
            existing.category = body.category
        else:
            db.add(TweetAssignment(
                tweet_id=tid, topic_id=body.topic_id, category=body.category
            ))
        if body.category:
            tweet = await db.get(Tweet, tid)
            if tweet:
                tweet.ai_override = True
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


class AcceptSuggestionBody(BaseModel):
    title: str | None = None


@router.post("/{tweet_id}/accept-suggestion", status_code=200)
async def accept_suggestion(
    tweet_id: int,
    body: AcceptSuggestionBody | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Accept AI suggestion: assign tweet to suggested topic with category."""
    tweet = await db.get(Tweet, tweet_id)
    if not tweet:
        raise HTTPException(404, "Tweet not found")
    if not tweet.ai_topic_id and not tweet.ai_new_topic_title:
        raise HTTPException(400, "No AI suggestion for this tweet")

    category = tweet.ai_category

    if tweet.ai_topic_id:
        topic_id = tweet.ai_topic_id
        # If user edited the title, update the existing topic
        if body and body.title:
            topic = await db.get(Topic, topic_id)
            if topic:
                topic.title = body.title
    else:
        # Create new topic from AI suggestion (use user edit if provided)
        title = (body.title if body and body.title else tweet.ai_new_topic_title)
        new_topic = Topic(
            title=title,
            date=tweet.saved_at.date(),
            og_tweet_id=tweet_id,
        )
        db.add(new_topic)
        await db.flush()
        topic_id = new_topic.id

    # Create assignment
    existing = (await db.execute(
        select(TweetAssignment).where(
            TweetAssignment.tweet_id == tweet_id,
            TweetAssignment.topic_id == topic_id,
        )
    )).scalar_one_or_none()
    if existing:
        existing.category = category
    else:
        db.add(TweetAssignment(tweet_id=tweet_id, topic_id=topic_id, category=category))

    # Clear suggestion fields
    tweet.ai_topic_id = None
    tweet.ai_category = None
    tweet.ai_new_topic_title = None
    tweet.ai_related_topic_id = None
    await db.commit()

    return JSONResponse(
        content={"assigned_topic_id": topic_id, "category": category},
        background=BackgroundTask(_recategorize_after_accept, topic_id),
    )


@router.post("/{tweet_id}/dismiss-suggestion", status_code=200)
async def dismiss_suggestion(tweet_id: int, db: AsyncSession = Depends(get_db)):
    """Dismiss AI suggestion: clear suggestion fields."""
    tweet = await db.get(Tweet, tweet_id)
    if not tweet:
        raise HTTPException(404, "Tweet not found")

    tweet.ai_topic_id = None
    tweet.ai_category = None
    tweet.ai_new_topic_title = None
    tweet.ai_related_topic_id = None
    await db.commit()
    return {"dismissed": True}


async def _recategorize_after_accept(topic_id: int):
    """Background: re-categorize all tweets in topic after a new one is accepted."""
    from app.services.classifier import recategorize_topic_tweets
    await recategorize_topic_tweets(topic_id)
