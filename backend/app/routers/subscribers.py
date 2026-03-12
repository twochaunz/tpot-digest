"""Subscriber endpoints: subscribe, unsubscribe, admin list/count."""

import logging
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_admin
from app.db import get_db
from app.models.subscriber import Subscriber
from app.models.unsubscribe_event import UnsubscribeEvent
from app.schemas.subscriber import (
    SubscribeRequest,
    SubscribeResponse,
    SubscriberOut,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/subscribers", tags=["subscribers"])


@router.post("", status_code=201)
async def subscribe(body: SubscribeRequest, db: AsyncSession = Depends(get_db)):
    """Subscribe an email address. Public endpoint."""
    result = await db.execute(select(Subscriber).where(Subscriber.email == body.email))
    existing = result.scalar_one_or_none()

    if existing:
        # Re-subscribe: clear unsubscribed_at if previously unsubscribed
        if existing.unsubscribed_at is not None:
            existing.unsubscribed_at = None
            await db.commit()
            # Send welcome email to re-subscriber if immediate mode
            try:
                from app.routers.digest import _get_or_create_settings, _send_welcome_emails
                digest_settings = await _get_or_create_settings(db)
                if digest_settings.welcome_send_mode == "immediate":
                    await db.refresh(existing)
                    await _send_welcome_emails([existing], db)
            except Exception:
                logger.exception("Failed to send welcome email to re-subscriber")
            return JSONResponse(
                content=SubscribeResponse(message="Re-subscribed", re_subscribed=True).model_dump(),
                status_code=200,
            )
        return JSONResponse(
            content=SubscribeResponse(message="Already subscribed", already_registered=True).model_dump(),
            status_code=200,
        )

    unsubscribe_token = secrets.token_hex(32)

    subscriber = Subscriber(
        email=body.email,
        unsubscribe_token=unsubscribe_token,
    )
    db.add(subscriber)
    await db.commit()

    # Send welcome email if immediate mode
    sent_immediately = False
    try:
        from app.routers.digest import _get_or_create_settings, _send_welcome_emails
        digest_settings = await _get_or_create_settings(db)
        if digest_settings.welcome_send_mode == "immediate":
            await db.refresh(subscriber)
            await _send_welcome_emails([subscriber], db)
            sent_immediately = True
    except Exception:
        logger.exception("Failed to send welcome email")

    return JSONResponse(
        content=SubscribeResponse(message="Subscribed", sent_immediately=sent_immediately).model_dump(),
        status_code=201,
    )


@router.get("/unsubscribe", response_class=HTMLResponse)
async def unsubscribe(token: str, digest: int | None = None, db: AsyncSession = Depends(get_db)):
    """Unsubscribe via token link. Optional digest param tracks which email triggered it."""
    result = await db.execute(select(Subscriber).where(Subscriber.unsubscribe_token == token))
    subscriber = result.scalar_one_or_none()
    if not subscriber:
        raise HTTPException(404, "Invalid unsubscribe link")

    # Idempotency: only create event when transitioning from subscribed → unsubscribed
    if subscriber.unsubscribed_at is None:
        subscriber.unsubscribed_at = datetime.now(timezone.utc)
        event = UnsubscribeEvent(
            subscriber_id=subscriber.id,
            draft_id=digest,
            unsubscribed_at=subscriber.unsubscribed_at,
        )
        db.add(event)
        await db.commit()

    return HTMLResponse("""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Unsubscribed</title></head>
<body style="background:#000;color:#e7e9ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;">
<div style="text-align:center;max-width:400px;">
  <h1 style="font-size:24px;margin-bottom:8px;">Unsubscribed</h1>
  <p style="color:#71767b;">You've been unsubscribed from the digest. You can close this page.</p>
</div>
</body></html>""")


@router.get("", response_model=list[SubscriberOut], dependencies=[Depends(require_admin)])
async def list_subscribers(db: AsyncSession = Depends(get_db)):
    """List all subscribers. Admin only."""
    result = await db.execute(select(Subscriber).order_by(Subscriber.subscribed_at.desc()))
    return result.scalars().all()


@router.get("/count", dependencies=[Depends(require_admin)])
async def subscriber_count(db: AsyncSession = Depends(get_db)):
    """Count active (not unsubscribed) subscribers. Admin only."""
    result = await db.execute(
        select(func.count())
        .select_from(Subscriber)
        .where(
            Subscriber.unsubscribed_at.is_(None),
        )
    )
    count = result.scalar() or 0
    return {"count": count}
