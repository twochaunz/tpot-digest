import re
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.tweet import Tweet
from app.schemas.tweet import TweetCreate, TweetFromUrl, TweetOut

router = APIRouter(prefix="/api/tweets", tags=["tweets"])

# Matches both https://x.com/{handle}/status/{id} and https://twitter.com/{handle}/status/{id}
_TWEET_URL_RE = re.compile(
    r"^https?://(?:www\.)?(?:x\.com|twitter\.com)/([^/]+)/status/(\d+)"
)


@router.get("", response_model=list[TweetOut])
async def list_tweets(
    date: date | None = Query(None, description="Filter by scraped_at date (YYYY-MM-DD)"),
    author: str | None = Query(None, description="Filter by author_handle"),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Tweet)
    if date is not None:
        day_start = datetime(date.year, date.month, date.day, tzinfo=timezone.utc)
        day_end = datetime(date.year, date.month, date.day, 23, 59, 59, 999999, tzinfo=timezone.utc)
        stmt = stmt.where(Tweet.scraped_at >= day_start, Tweet.scraped_at <= day_end)
    if author is not None:
        stmt = stmt.where(Tweet.author_handle == author)
    stmt = stmt.order_by(Tweet.id.desc())
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{tweet_id}", response_model=TweetOut)
async def get_tweet(tweet_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Tweet).where(Tweet.tweet_id == tweet_id))
    tweet = result.scalar_one_or_none()
    if tweet is None:
        raise HTTPException(404, "Tweet not found")
    return tweet


@router.post("", response_model=TweetOut, status_code=201)
async def create_tweet(body: TweetCreate, db: AsyncSession = Depends(get_db)):
    tweet = Tweet(
        tweet_id=body.tweet_id,
        author_handle=body.author_handle,
        text=body.text,
        media_urls=body.media_urls,
        article_urls=body.article_urls,
        posted_at=body.posted_at,
        engagement=body.engagement,
        is_retweet=body.is_retweet,
        is_quote_tweet=body.is_quote_tweet,
        quoted_tweet_id=body.quoted_tweet_id,
        feed_source=body.feed_source,
    )
    db.add(tweet)
    await db.commit()
    await db.refresh(tweet)
    return tweet


@router.post("/from-url", response_model=TweetOut, status_code=201)
async def create_tweet_from_url(body: TweetFromUrl, db: AsyncSession = Depends(get_db)):
    match = _TWEET_URL_RE.match(body.url)
    if not match:
        raise HTTPException(400, "Invalid tweet URL. Expected https://x.com/{handle}/status/{id} or https://twitter.com/{handle}/status/{id}")
    handle = match.group(1)
    tid = match.group(2)

    tweet = Tweet(
        tweet_id=tid,
        author_handle=handle,
        text="[Pending scrape]",
    )
    db.add(tweet)
    await db.commit()
    await db.refresh(tweet)
    return tweet
