import base64
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.models.tweet import Tweet
from app.models.screenshot import Screenshot
from app.schemas.ingest import (
    BatchIngestRequest,
    BatchIngestResponse,
    IngestResponse,
    TweetIngest,
)

router = APIRouter(prefix="/api/ingest", tags=["ingest"])


def _save_screenshot(tweet_id: str, screenshot_b64: str) -> str:
    """Decode base64 PNG and save to filesystem. Returns relative file path."""
    today = date.today().strftime("%Y%m%d")
    dir_path = Path(settings.data_dir) / today / "screenshots"
    dir_path.mkdir(parents=True, exist_ok=True)
    file_path = dir_path / f"tweet_{tweet_id}.png"
    file_path.write_bytes(base64.b64decode(screenshot_b64))
    return str(file_path.relative_to(settings.data_dir))


async def _ingest_one(body: TweetIngest, db: AsyncSession) -> IngestResponse:
    """Ingest a single tweet. Returns saved or duplicate status."""
    result = await db.execute(
        select(Tweet).where(Tweet.tweet_id == body.tweet_id)
    )
    existing = result.scalar_one_or_none()
    if existing:
        return IngestResponse(
            id=existing.id,
            tweet_id=existing.tweet_id,
            author_handle=existing.author_handle,
            status="duplicate",
        )

    file_path = _save_screenshot(body.tweet_id, body.screenshot_base64)

    tweet = Tweet(
        tweet_id=body.tweet_id,
        author_handle=body.author_handle,
        text=body.text,
        media_urls={"urls": body.media_urls} if body.media_urls else None,
        article_urls={"urls": body.article_urls} if body.article_urls else None,
        engagement=body.engagement,
        is_retweet=body.is_retweet,
        is_quote_tweet=body.is_quote_tweet,
        quoted_tweet_id=body.quoted_tweet_id,
        feed_source=body.feed_source,
    )
    db.add(tweet)
    await db.flush()

    screenshot = Screenshot(
        tweet_id=tweet.id,
        file_path=file_path,
    )
    db.add(screenshot)
    await db.commit()
    await db.refresh(tweet)

    return IngestResponse(
        id=tweet.id,
        tweet_id=tweet.tweet_id,
        author_handle=tweet.author_handle,
        status="saved",
    )


@router.post("", response_model=IngestResponse)
async def ingest_tweet(body: TweetIngest, db: AsyncSession = Depends(get_db)):
    result = await _ingest_one(body, db)
    status_code = 201 if result.status == "saved" else 200
    return JSONResponse(content=result.model_dump(), status_code=status_code)


@router.post("/batch", response_model=BatchIngestResponse)
async def ingest_batch(body: BatchIngestRequest, db: AsyncSession = Depends(get_db)):
    results = []
    for tweet in body.tweets:
        result = await _ingest_one(tweet, db)
        results.append(result)
    return BatchIngestResponse(
        results=results,
        saved_count=sum(1 for r in results if r.status == "saved"),
        duplicate_count=sum(1 for r in results if r.status == "duplicate"),
    )
