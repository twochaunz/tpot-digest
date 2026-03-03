"""Digest draft endpoints: CRUD, preview, send-test, send, process-scheduled."""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_admin
from app.config import settings
from app.db import get_db
from app.models.assignment import TweetAssignment
from app.models.digest_draft import DigestDraft
from app.models.subscriber import Subscriber
from app.models.topic import Topic
from app.models.tweet import Tweet
from app.schemas.digest import (
    DigestDraftCreate,
    DigestDraftOut,
    DigestDraftUpdate,
    DigestPreview,
    DigestSendTestRequest,
)
from app.services.email import render_digest_email, send_digest_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/digest", tags=["digest"], dependencies=[Depends(require_admin)])


def _format_date(d) -> str:
    """Format a date as 'March 1, 2026'."""
    return d.strftime("%B %-d, %Y")


async def _build_digest_content(draft: DigestDraft, db: AsyncSession) -> list[dict]:
    """Build list of block dicts for rendering from content_blocks."""
    result_blocks = []

    for block in (draft.content_blocks or []):
        block_type = block.get("type")

        if block_type == "text":
            content = block.get("content")
            if content:
                result_blocks.append({"type": "text", "content": content})

        elif block_type == "topic":
            topic_id = block.get("topic_id")
            if not topic_id:
                continue

            topic = await db.get(Topic, topic_id)
            if not topic:
                continue

            # Fetch assigned tweets for this topic
            stmt = (
                select(Tweet)
                .join(TweetAssignment, TweetAssignment.tweet_id == Tweet.id)
                .where(TweetAssignment.topic_id == topic_id)
                .order_by(Tweet.saved_at)
            )
            rows = await db.execute(stmt)
            tweet_rows = rows.scalars().all()

            tweet_dicts = []
            for tw in tweet_rows:
                tweet_dicts.append({
                    "author_handle": tw.author_handle,
                    "author_display_name": tw.author_display_name,
                    "author_avatar_url": tw.author_avatar_url,
                    "text": tw.text,
                    "engagement": tw.engagement,
                    "url": tw.url,
                })

            result_blocks.append({
                "type": "topic",
                "title": topic.title,
                "tweets": tweet_dicts,
            })

        elif block_type == "tweet":
            tweet_id = block.get("tweet_id")
            if not tweet_id:
                continue

            tw = await db.get(Tweet, tweet_id)
            if not tw:
                continue

            result_blocks.append({
                "type": "tweet",
                "author_handle": tw.author_handle,
                "author_display_name": tw.author_display_name,
                "author_avatar_url": tw.author_avatar_url,
                "text": tw.text,
                "engagement": tw.engagement,
                "url": tw.url,
            })

    return result_blocks


@router.post("/drafts", response_model=DigestDraftOut, status_code=201)
async def create_draft(body: DigestDraftCreate, db: AsyncSession = Depends(get_db)):
    """Create a new digest draft."""
    draft = DigestDraft(
        date=body.date,
        content_blocks=[b.model_dump() for b in body.content_blocks],
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)
    return draft


@router.get("/drafts", response_model=list[DigestDraftOut])
async def list_drafts(status: str | None = None, db: AsyncSession = Depends(get_db)):
    """List all digest drafts, optionally filtered by status."""
    stmt = select(DigestDraft).order_by(DigestDraft.created_at.desc())
    if status:
        stmt = stmt.where(DigestDraft.status == status)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/drafts/{draft_id}", response_model=DigestDraftOut)
async def get_draft(draft_id: int, db: AsyncSession = Depends(get_db)):
    """Get a single digest draft."""
    draft = await db.get(DigestDraft, draft_id)
    if not draft:
        raise HTTPException(404, "Draft not found")
    return draft


@router.patch("/drafts/{draft_id}", response_model=DigestDraftOut)
async def update_draft(draft_id: int, body: DigestDraftUpdate, db: AsyncSession = Depends(get_db)):
    """Update a digest draft."""
    draft = await db.get(DigestDraft, draft_id)
    if not draft:
        raise HTTPException(404, "Draft not found")
    if draft.status == "sent":
        raise HTTPException(400, "Cannot edit a sent draft")

    data = body.model_dump(exclude_unset=True)

    if "scheduled_for" in data and data["scheduled_for"] is not None:
        draft.status = "scheduled"

    if "content_blocks" in data and data["content_blocks"] is not None:
        draft.content_blocks = [b if isinstance(b, dict) else b.model_dump() for b in data["content_blocks"]]
        data.pop("content_blocks")

    for field, value in data.items():
        setattr(draft, field, value)

    await db.commit()
    await db.refresh(draft)
    return draft


@router.delete("/drafts/{draft_id}", status_code=204)
async def delete_draft(draft_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a digest draft."""
    draft = await db.get(DigestDraft, draft_id)
    if not draft:
        raise HTTPException(404, "Draft not found")
    if draft.status == "sent":
        raise HTTPException(400, "Cannot delete a sent draft")
    await db.delete(draft)
    await db.commit()


@router.get("/drafts/{draft_id}/preview", response_model=DigestPreview)
async def preview_draft(draft_id: int, db: AsyncSession = Depends(get_db)):
    """Render a preview of the digest email."""
    draft = await db.get(DigestDraft, draft_id)
    if not draft:
        raise HTTPException(404, "Draft not found")

    blocks = await _build_digest_content(draft, db)
    date_str = _format_date(draft.date)
    subject = f"abridged -- {date_str}"

    html = render_digest_email(
        date_str=date_str,
        blocks=blocks,
        unsubscribe_url="{{unsubscribe_url}}",
    )

    # Count active subscribers
    count_result = await db.execute(
        select(Subscriber)
        .where(
            Subscriber.unsubscribed_at.is_(None),
        )
    )
    recipient_count = len(count_result.scalars().all())

    return DigestPreview(subject=subject, html=html, recipient_count=recipient_count)


@router.post("/drafts/{draft_id}/send-test")
async def send_test(draft_id: int, body: DigestSendTestRequest | None = None, db: AsyncSession = Depends(get_db)):
    """Send a test digest to the admin email only."""
    draft = await db.get(DigestDraft, draft_id)
    if not draft:
        raise HTTPException(404, "Draft not found")

    to_email = (body.email if body and body.email else None) or settings.admin_email
    if not to_email:
        raise HTTPException(400, "No admin_email configured and no email provided")

    blocks = await _build_digest_content(draft, db)
    date_str = _format_date(draft.date)
    subject = f"[TEST] abridged -- {date_str}"

    html = render_digest_email(
        date_str=date_str,
        blocks=blocks,
        unsubscribe_url="#",
    )

    result = send_digest_email(to_email, subject, html)
    return {"sent_to": to_email, "result": result}


@router.post("/drafts/{draft_id}/send")
async def send_digest(draft_id: int, db: AsyncSession = Depends(get_db)):
    """Send the digest to all active subscribers and mark as sent."""
    draft = await db.get(DigestDraft, draft_id)
    if not draft:
        raise HTTPException(404, "Draft not found")
    if draft.status == "sent":
        raise HTTPException(400, "Draft already sent")

    # Fetch active subscribers
    result = await db.execute(
        select(Subscriber).where(
            Subscriber.unsubscribed_at.is_(None),
        )
    )
    subscribers = result.scalars().all()

    blocks = await _build_digest_content(draft, db)
    date_str = _format_date(draft.date)
    subject = f"abridged -- {date_str}"

    sent_count = 0
    for sub in subscribers:
        unsubscribe_url = f"https://abridged.tech/api/subscribers/unsubscribe?token={sub.unsubscribe_token}"
        html = render_digest_email(
            date_str=date_str,
            blocks=blocks,
            unsubscribe_url=unsubscribe_url,
        )
        email_result = send_digest_email(sub.email, subject, html, unsubscribe_url=unsubscribe_url)
        if email_result:
            sent_count += 1

    draft.status = "sent"
    draft.sent_at = datetime.now(timezone.utc)
    draft.recipient_count = sent_count
    await db.commit()

    return {"sent_count": sent_count, "total_subscribers": len(subscribers)}


@router.post("/process-scheduled")
async def process_scheduled(db: AsyncSession = Depends(get_db)):
    """Process all scheduled drafts where scheduled_for <= now. Designed for cron."""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(DigestDraft).where(
            DigestDraft.status == "scheduled",
            DigestDraft.scheduled_for <= now,
        )
    )
    drafts = result.scalars().all()

    processed = []
    for draft in drafts:
        # Fetch active subscribers
        sub_result = await db.execute(
            select(Subscriber).where(
                Subscriber.unsubscribed_at.is_(None),
            )
        )
        subscribers = sub_result.scalars().all()

        blocks = await _build_digest_content(draft, db)
        date_str = _format_date(draft.date)
        subject = f"abridged -- {date_str}"

        sent_count = 0
        for sub in subscribers:
            unsubscribe_url = f"https://abridged.tech/api/subscribers/unsubscribe?token={sub.unsubscribe_token}"
            html = render_digest_email(
                date_str=date_str,
                blocks=blocks,
                unsubscribe_url=unsubscribe_url,
            )
            email_result = send_digest_email(sub.email, subject, html, unsubscribe_url=unsubscribe_url)
            if email_result:
                sent_count += 1

        draft.status = "sent"
        draft.sent_at = datetime.now(timezone.utc)
        draft.recipient_count = sent_count
        processed.append({"draft_id": draft.id, "sent_count": sent_count})

    await db.commit()
    return {"processed": len(processed), "details": processed}
