import logging

from fastapi import APIRouter, Depends
from sqlalchemy import distinct, func, select

from app.auth import require_admin
from app.db import get_db
from app.models.digest_draft import DigestDraft
from app.models.digest_send_log import DigestSendLog
from app.models.email_event import EmailEvent
from app.models.subscriber import Subscriber

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/analytics",
    tags=["analytics"],
    dependencies=[Depends(require_admin)],
)


@router.get("/overview")
async def get_overview(db=Depends(get_db)):
    sub_count = await db.execute(
        select(func.count()).select_from(Subscriber).where(
            Subscriber.unsubscribed_at.is_(None)
        )
    )
    subscriber_count = sub_count.scalar() or 0

    last_draft_q = await db.execute(
        select(DigestDraft)
        .where(DigestDraft.status == "sent")
        .order_by(DigestDraft.sent_at.desc())
        .limit(1)
    )
    last_draft = last_draft_q.scalars().first()

    last_digest = None
    if last_draft:
        recipients = last_draft.recipient_count or 0
        clicks = 0
        if recipients > 0:
            click_count = await db.execute(
                select(func.count())
                .where(EmailEvent.draft_id == last_draft.id)
                .where(EmailEvent.event_type == "clicked")
            )
            clicks = click_count.scalar() or 0

        last_digest = {
            "draft_id": last_draft.id,
            "date": str(last_draft.date),
            "subject": last_draft.subject,
            "recipients": recipients,
            "clicks": clicks,
            "click_rate": round(clicks / recipients * 100, 1) if recipients else 0,
            "sent_at": last_draft.sent_at.isoformat() if last_draft.sent_at else None,
        }

    return {"subscriber_count": subscriber_count, "last_digest": last_digest}


@router.get("/digests")
async def get_digest_analytics(db=Depends(get_db)):
    drafts_q = await db.execute(
        select(DigestDraft)
        .where(DigestDraft.status == "sent")
        .order_by(DigestDraft.sent_at.desc())
    )
    drafts = drafts_q.scalars().all()

    results = []
    for draft in drafts:
        recipients = draft.recipient_count or 0
        click_q = await db.execute(
            select(func.count())
            .where(EmailEvent.draft_id == draft.id)
            .where(EmailEvent.event_type == "clicked")
        )
        clicks = click_q.scalar() or 0

        results.append({
            "draft_id": draft.id,
            "date": str(draft.date),
            "subject": draft.subject,
            "recipients": recipients,
            "clicks": clicks,
            "click_rate": round(clicks / recipients * 100, 1) if recipients else 0,
            "sent_at": draft.sent_at.isoformat() if draft.sent_at else None,
        })

    return results


@router.get("/digests/{draft_id}")
async def get_digest_detail(draft_id: int, db=Depends(get_db)):
    link_q = await db.execute(
        select(EmailEvent.link_url, func.count().label("count"))
        .where(EmailEvent.draft_id == draft_id)
        .where(EmailEvent.event_type == "clicked")
        .where(EmailEvent.link_url.isnot(None))
        .group_by(EmailEvent.link_url)
        .order_by(func.count().desc())
        .limit(20)
    )
    top_links = [{"url": row.link_url, "count": row.count} for row in link_q]

    logs_q = await db.execute(
        select(DigestSendLog)
        .where(DigestSendLog.draft_id == draft_id)
        .where(DigestSendLog.status == "sent")
    )
    logs = logs_q.scalars().all()

    subscribers = []
    for log in logs:
        events_q = await db.execute(
            select(EmailEvent.event_type)
            .where(EmailEvent.draft_id == draft_id)
            .where(EmailEvent.subscriber_id == log.subscriber_id)
        )
        event_types = {row[0] for row in events_q}

        subscribers.append({
            "email": log.email,
            "subscriber_id": log.subscriber_id,
            "delivered": "delivered" in event_types,
            "clicked": "clicked" in event_types,
        })

    return {"top_links": top_links, "subscribers": subscribers}


@router.get("/subscribers")
async def get_subscriber_analytics(db=Depends(get_db)):
    subs_q = await db.execute(
        select(Subscriber).where(Subscriber.unsubscribed_at.is_(None))
    )
    subs = subs_q.scalars().all()

    results = []
    for sub in subs:
        sent_q = await db.execute(
            select(func.count(distinct(DigestSendLog.draft_id)))
            .where(DigestSendLog.subscriber_id == sub.id)
            .where(DigestSendLog.status == "sent")
        )
        digests_received = sent_q.scalar() or 0

        clicks_q = await db.execute(
            select(func.count())
            .where(EmailEvent.subscriber_id == sub.id)
            .where(EmailEvent.event_type == "clicked")
        )
        total_clicks = clicks_q.scalar() or 0

        last_click_q = await db.execute(
            select(func.max(EmailEvent.event_at))
            .where(EmailEvent.subscriber_id == sub.id)
            .where(EmailEvent.event_type == "clicked")
        )
        last_clicked = last_click_q.scalar()

        results.append({
            "email": sub.email,
            "subscriber_id": sub.id,
            "subscribed_at": sub.subscribed_at.isoformat() if sub.subscribed_at else None,
            "digests_received": digests_received,
            "click_rate": round(total_clicks / digests_received * 100, 1) if digests_received else 0,
            "last_clicked": last_clicked.isoformat() if last_clicked else None,
        })

    return results
