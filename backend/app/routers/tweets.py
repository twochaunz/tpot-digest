import logging
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import require_admin
from fastapi.responses import JSONResponse
from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask

import app.db as db_module
from app.db import get_db
from app.models.assignment import TweetAssignment
from app.models.topic import Topic
from app.models.tweet import Tweet
from app.schemas.tweet import TweetAssignRequest, TweetCheckRequest, TweetOut, TweetSave, TweetUnassignRequest, TweetUpdate

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/tweets", tags=["tweets"])


async def _persist_quoted_tweet(db, quoted_tweet_id: str, included_tweets: list[dict] | None = None):
    """Persist a quoted tweet if not already in DB.

    Uses pre-fetched data from included_tweets (already returned by the X API
    in the parent tweet's response) to avoid redundant API calls.
    """
    # Already in DB?
    existing = (await db.execute(
        select(Tweet).where(Tweet.tweet_id == quoted_tweet_id)
    )).scalars().first()
    if existing:
        return

    # Look for the quoted tweet in the included data from the parent response
    qt_data = None
    if included_tweets:
        for inc in included_tweets:
            if inc.get("tweet_id") == quoted_tweet_id:
                qt_data = inc
                break

    if not qt_data:
        # Fallback: fetch from API if not in includes (shouldn't normally happen)
        from app.services.x_api import fetch_tweet, XAPIError
        try:
            qt_data = await fetch_tweet(quoted_tweet_id)
        except XAPIError as e:
            logger.warning("Could not fetch quoted tweet %s: %s", quoted_tweet_id, e)
            return

    qt = Tweet(
        tweet_id=quoted_tweet_id,
        author_handle=qt_data.get("author_handle", ""),
        author_display_name=qt_data.get("author_display_name", ""),
        author_avatar_url=qt_data.get("author_avatar_url", ""),
        author_verified=qt_data.get("author_verified", False),
        text=qt_data.get("text", ""),
        url=qt_data.get("url", f"https://x.com/i/status/{quoted_tweet_id}"),
        media_urls=qt_data.get("media_urls"),
        engagement=qt_data.get("engagement"),
        is_quote_tweet=qt_data.get("is_quote_tweet", False),
        is_reply=qt_data.get("is_reply", False),
        quoted_tweet_id=qt_data.get("quoted_tweet_id"),
        reply_to_tweet_id=qt_data.get("reply_to_tweet_id"),
        reply_to_handle=qt_data.get("reply_to_handle"),
        url_entities=qt_data.get("url_entities"),
        article_title=qt_data.get("article_title"),
        feed_source="quoted_fetch",
    )
    if qt_data.get("created_at"):
        qt.created_at = datetime.fromisoformat(qt_data["created_at"].replace("Z", "+00:00"))
    db.add(qt)


async def _post_save_tasks(tweet_id: int, tweet_x_id: str, topic_id: int | None, category: str | None, api_data: dict | None):
    """Background task: persist quoted tweets, handle topic assignment, auto-categorize."""
    async with db_module.async_session() as db:
        if topic_id:
            existing = (await db.execute(
                select(TweetAssignment).where(
                    TweetAssignment.tweet_id == tweet_id,
                    TweetAssignment.topic_id == topic_id,
                )
            )).scalar_one_or_none()
            if not existing:
                db.add(TweetAssignment(tweet_id=tweet_id, topic_id=topic_id, category=category))

        # Persist quoted tweet(s) so digest preview never needs X API
        if api_data and api_data.get("quoted_tweet_id"):
            await _persist_quoted_tweet(db, api_data["quoted_tweet_id"], api_data.get("included_tweets"))

        await db.commit()

    # If assigned to a topic without explicit category, auto-categorize
    if topic_id and not category:
        from app.services.classifier import categorize_assigned_tweet
        try:
            await categorize_assigned_tweet(tweet_id, topic_id)
        except Exception as e:
            logger.warning("Auto-categorization failed for tweet %d: %s", tweet_id, e)


@router.post("", status_code=201)
async def save_tweet(body: TweetSave, db: AsyncSession = Depends(get_db), _admin=Depends(require_admin)):
    from app.services.x_api import fetch_tweet, XAPIError

    existing = (await db.execute(
        select(Tweet).where(Tweet.tweet_id == body.tweet_id)
    )).scalar_one_or_none()
    if existing:
        out = TweetOut.model_validate(existing)
        out.status = "duplicate"
        return JSONResponse(content=out.model_dump(mode="json"), status_code=200)

    # Fetch tweet data from X API synchronously so we never save blank placeholders
    api_data = None
    try:
        api_data = await fetch_tweet(body.tweet_id)
    except XAPIError as e:
        print(f"[save_tweet] X API fetch failed for {body.tweet_id}: {e}", flush=True)

    if api_data:
        kwargs: dict = dict(
            tweet_id=body.tweet_id,
            author_handle=api_data["author_handle"],
            author_display_name=api_data["author_display_name"],
            author_avatar_url=api_data["author_avatar_url"],
            author_verified=api_data["author_verified"],
            text=api_data["text"],
            media_urls=api_data["media_urls"],
            engagement=api_data["engagement"],
            url=api_data["url"],
            is_quote_tweet=api_data["is_quote_tweet"],
            is_reply=api_data["is_reply"],
            quoted_tweet_id=api_data.get("quoted_tweet_id"),
            reply_to_tweet_id=api_data.get("reply_to_tweet_id"),
            reply_to_handle=api_data.get("reply_to_handle"),
            url_entities=api_data.get("url_entities"),
            article_title=api_data.get("article_title"),
            lang=api_data.get("lang"),
            feed_source=body.feed_source,
            thread_id=body.thread_id,
            thread_position=body.thread_position,
        )
        if api_data.get("created_at"):
            kwargs["created_at"] = datetime.fromisoformat(api_data["created_at"].replace("Z", "+00:00"))
    else:
        # Fallback placeholder if X API is down
        kwargs = dict(
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

    status = "saved" if api_data else "pending"

    # Background: persist quoted tweet, topic assignment, auto-categorization
    bg = BackgroundTask(_post_save_tasks, tweet.id, body.tweet_id, body.topic_id, body.category, api_data)

    return JSONResponse(
        content={"id": tweet.id, "tweet_id": body.tweet_id, "status": status},
        status_code=201,
        background=bg,
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

    # Exclude quoted-tweet-only records from the feed
    stmt = stmt.where(
        (Tweet.feed_source.is_(None)) | (Tweet.feed_source != "quoted_fetch")
    )

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
async def delete_tweet(tweet_id: int, db: AsyncSession = Depends(get_db), _admin=Depends(require_admin)):
    tweet = await db.get(Tweet, tweet_id)
    if not tweet:
        raise HTTPException(404, "Tweet not found")
    await db.delete(tweet)
    await db.commit()


@router.patch("/{tweet_id}", response_model=TweetOut)
async def update_tweet(tweet_id: int, body: TweetUpdate, db: AsyncSession = Depends(get_db), _admin=Depends(require_admin)):
    tweet = await db.get(Tweet, tweet_id)
    if not tweet:
        raise HTTPException(404, "Tweet not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(tweet, field, value)
    await db.commit()
    await db.refresh(tweet)
    return tweet


@router.post("/{tweet_id}/translate", response_model=TweetOut)
async def translate_tweet(
    tweet_id: int,
    force: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    _admin=Depends(require_admin),
):
    tweet = await db.get(Tweet, tweet_id)
    if not tweet:
        raise HTTPException(404, "Tweet not found")

    if tweet.translated_text and not force:
        return tweet

    import re
    from app.services.translate import translate_text, TranslationError
    # Strip t.co links before translating — they're not translatable content
    text = re.sub(r'\s*https://t\.co/\w+', '', tweet.text or '').strip()
    if not text:
        raise HTTPException(400, "Tweet has no translatable text")
    try:
        tweet.translated_text = await translate_text(text)
    except TranslationError as e:
        raise HTTPException(status_code=502, detail=str(e))

    await db.commit()
    await db.refresh(tweet)
    return tweet


@router.post("/{tweet_id}/grok", response_model=TweetOut)
async def fetch_grok(
    tweet_id: int,
    force: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    _admin=Depends(require_admin),
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
async def refetch_tweet(tweet_id: int, db: AsyncSession = Depends(get_db), _admin=Depends(require_admin)):
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
    tweet.article_title = api_data.get("article_title")
    tweet.lang = api_data.get("lang")
    if api_data.get("created_at"):
        tweet.created_at = datetime.fromisoformat(api_data["created_at"].replace("Z", "+00:00"))

    await db.commit()
    await db.refresh(tweet)
    return tweet


@router.post("/refetch-all", status_code=200)
async def refetch_all_tweets(db: AsyncSession = Depends(get_db), _admin=Depends(require_admin)):
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
            tweet.article_title = api_data.get("article_title")
            if api_data.get("created_at"):
                tweet.created_at = datetime.fromisoformat(api_data["created_at"].replace("Z", "+00:00"))
            updated += 1
        except (XAPIError, Exception):
            failed += 1
        # Rate limit: twitterapi.io free tier allows 1 req per 5 seconds
        await asyncio.sleep(5.5)

    await db.commit()
    return {"updated": updated, "failed": failed, "total": len(tweets)}


@router.post("/check", status_code=200)
async def check_saved(body: TweetCheckRequest, db: AsyncSession = Depends(get_db)):
    if not body.tweet_ids:
        return {"saved": {}}
    result = await db.execute(
        select(Tweet.tweet_id, Tweet.id).where(
            Tweet.tweet_id.in_(body.tweet_ids),
            (Tweet.feed_source.is_(None)) | (Tweet.feed_source != "quoted_fetch"),
        )
    )
    saved = {row[0]: row[1] for row in result.all()}
    return {"saved": saved}


@router.post("/assign", status_code=200)
async def assign_tweets(body: TweetAssignRequest, db: AsyncSession = Depends(get_db), _admin=Depends(require_admin)):
    tweets_to_categorize: list[int] = []
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
        else:
            tweets_to_categorize.append(tid)
    await db.commit()

    bg = None
    if tweets_to_categorize:
        bg = BackgroundTask(_categorize_after_assign, tweets_to_categorize, body.topic_id)

    return JSONResponse(
        content={"assigned": len(body.tweet_ids)},
        background=bg,
    )


@router.post("/unassign", status_code=200)
async def unassign_tweets(body: TweetUnassignRequest, db: AsyncSession = Depends(get_db), _admin=Depends(require_admin)):
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


async def _categorize_after_assign(tweet_ids: list[int], topic_id: int):
    """Background: auto-categorize tweets assigned without explicit category."""
    from app.services.classifier import categorize_assigned_tweet
    for tid in tweet_ids:
        try:
            await categorize_assigned_tweet(tid, topic_id)
        except Exception as e:
            logger.warning("Auto-categorization failed for tweet %d: %s", tid, e)
