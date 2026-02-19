from typing import Optional

from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel

from app.scheduler import scheduler, scrape_job
from app.config import settings

router = APIRouter(prefix="/api/scheduler", tags=["scheduler"])


class SchedulerStatus(BaseModel):
    running: bool
    next_run_time: Optional[str] = None
    scrape_interval_hours: int


class SchedulerConfigUpdate(BaseModel):
    scrape_interval_hours: Optional[int] = None
    scrape_max_scrolls: Optional[int] = None


class SchedulerConfigResponse(BaseModel):
    scrape_interval_hours: int
    scrape_max_scrolls: int


@router.get("/status", response_model=SchedulerStatus)
async def get_scheduler_status():
    """Return whether the scheduler is running and the next scheduled run time."""
    next_run: Optional[str] = None
    if scheduler.running:
        job = scheduler.get_job("scrape_feed")
        if job and job.next_run_time:
            next_run = job.next_run_time.isoformat()

    return SchedulerStatus(
        running=scheduler.running,
        next_run_time=next_run,
        scrape_interval_hours=settings.scrape_interval_hours,
    )


@router.post("/trigger", status_code=202)
async def trigger_scrape(background_tasks: BackgroundTasks):
    """Manually trigger a scrape job (runs in background)."""
    background_tasks.add_task(scrape_job)
    return {"message": "Scrape job triggered"}


@router.patch("/config", response_model=SchedulerConfigResponse)
async def update_scheduler_config(body: SchedulerConfigUpdate):
    """Update scrape interval and/or max scrolls configuration."""
    if body.scrape_interval_hours is not None:
        settings.scrape_interval_hours = body.scrape_interval_hours
        # Reschedule the job with the new interval if the scheduler is running
        if scheduler.running:
            scheduler.reschedule_job(
                "scrape_feed",
                trigger="interval",
                hours=body.scrape_interval_hours,
            )

    if body.scrape_max_scrolls is not None:
        settings.scrape_max_scrolls = body.scrape_max_scrolls

    return SchedulerConfigResponse(
        scrape_interval_hours=settings.scrape_interval_hours,
        scrape_max_scrolls=settings.scrape_max_scrolls,
    )
