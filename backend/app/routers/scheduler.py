from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.topic import SubTopicTweet
from app.models.tweet import Tweet

router = APIRouter(prefix="/api/scheduler", tags=["scheduler"])


class SchedulerStatus(BaseModel):
    running: bool
    next_run_time: Optional[str] = None
    mode: str = "on_demand"


class PipelineConfigResponse(BaseModel):
    mode: str = "on_demand"
    unclustered_count: int


@router.get("/status", response_model=SchedulerStatus)
async def get_scheduler_status():
    """Return pipeline status.

    With the Chrome extension architecture, scraping is no longer scheduled.
    Tweets are ingested on-demand via the extension, and clustering is
    triggered manually through /api/ingest/cluster.
    """
    return SchedulerStatus(
        running=False,
        next_run_time=None,
        mode="on_demand",
    )


@router.post("/trigger", status_code=202)
async def trigger_pipeline(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Trigger the clustering pipeline for unclustered tweets."""
    from app.scheduler import process_pipeline

    # Get unclustered tweets
    assigned_ids = select(SubTopicTweet.tweet_id).subquery()
    stmt = select(Tweet).where(Tweet.id.not_in(select(assigned_ids)))
    result = await db.execute(stmt)
    unclustered = result.scalars().all()

    if not unclustered:
        return {"message": "No unclustered tweets to process"}

    # Convert to dicts for the pipeline
    tweet_dicts = [
        {
            "tweet_id": t.tweet_id,
            "author_handle": t.author_handle,
            "text": t.text,
            "media_urls": t.media_urls,
            "article_urls": t.article_urls,
            "engagement": t.engagement,
            "is_retweet": t.is_retweet,
            "is_quote_tweet": t.is_quote_tweet,
            "quoted_tweet_id": t.quoted_tweet_id,
            "feed_source": t.feed_source,
        }
        for t in unclustered
    ]

    background_tasks.add_task(process_pipeline, tweet_dicts, db)
    return {"message": f"Pipeline triggered for {len(unclustered)} unclustered tweets"}
