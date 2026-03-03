"""Subscriber endpoints: subscribe, unsubscribe, confirm, check, admin list/count."""

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask

from app.auth import require_admin
from app.db import get_db
from app.models.subscriber import Subscriber
from app.schemas.subscriber import (
    SubscribeRequest,
    SubscribeResponse,
    SubscriberOut,
    SubscriptionCheck,
)
from app.services.email import send_confirmation_email

router = APIRouter(prefix="/api/subscribers", tags=["subscribers"])

_COOKIE_NAME = "digest_sub"
_COOKIE_MAX_AGE = 365 * 24 * 60 * 60  # 1 year


@router.post("", status_code=201)
async def subscribe(body: SubscribeRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """Subscribe an email address. Public endpoint."""
    # Check for existing subscriber
    result = await db.execute(select(Subscriber).where(Subscriber.email == body.email))
    existing = result.scalar_one_or_none()

    is_https = request.headers.get("x-forwarded-proto") == "https" or request.url.scheme == "https"

    if existing:
        # Already registered -- return 200
        resp = JSONResponse(
            content=SubscribeResponse(message="Already subscribed", already_registered=True).model_dump(),
            status_code=200,
        )
        resp.set_cookie(
            key=_COOKIE_NAME,
            value=existing.cookie_token,
            httponly=True,
            secure=is_https,
            samesite="lax",
            max_age=_COOKIE_MAX_AGE,
            path="/",
        )
        return resp

    # New subscriber
    cookie_token = secrets.token_hex(32)
    unsubscribe_token = secrets.token_hex(32)
    confirmation_token = secrets.token_hex(32)

    subscriber = Subscriber(
        email=body.email,
        cookie_token=cookie_token,
        unsubscribe_token=unsubscribe_token,
        confirmation_token=confirmation_token,
    )
    db.add(subscriber)
    await db.commit()

    # Build confirmation URL
    base_url = str(request.base_url).rstrip("/")
    confirmation_url = f"{base_url}/api/subscribers/confirm?token={confirmation_token}"

    resp = JSONResponse(
        content=SubscribeResponse(message="Confirmation email sent").model_dump(),
        status_code=201,
    )
    resp.set_cookie(
        key=_COOKIE_NAME,
        value=cookie_token,
        httponly=True,
        secure=is_https,
        samesite="lax",
        max_age=_COOKIE_MAX_AGE,
        path="/",
    )
    resp.background = BackgroundTask(send_confirmation_email, body.email, confirmation_url)
    return resp


@router.get("/unsubscribe", response_class=HTMLResponse)
async def unsubscribe(token: str, db: AsyncSession = Depends(get_db)):
    """Unsubscribe via token link."""
    result = await db.execute(select(Subscriber).where(Subscriber.unsubscribe_token == token))
    subscriber = result.scalar_one_or_none()
    if not subscriber:
        raise HTTPException(404, "Invalid unsubscribe link")

    subscriber.unsubscribed_at = datetime.now(timezone.utc)
    await db.commit()

    return HTMLResponse("""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Unsubscribed</title></head>
<body style="background:#000;color:#e7e9ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;">
<div style="text-align:center;max-width:400px;">
  <h1 style="font-size:24px;margin-bottom:8px;">Unsubscribed</h1>
  <p style="color:#71767b;">You've been unsubscribed from the digest. You can close this page.</p>
</div>
</body></html>""")


@router.get("/confirm", response_class=HTMLResponse)
async def confirm(token: str, db: AsyncSession = Depends(get_db)):
    """Confirm subscription via token link."""
    result = await db.execute(select(Subscriber).where(Subscriber.confirmation_token == token))
    subscriber = result.scalar_one_or_none()
    if not subscriber:
        raise HTTPException(404, "Invalid or expired confirmation link")

    subscriber.confirmed_at = datetime.now(timezone.utc)
    subscriber.confirmation_token = None
    await db.commit()

    return HTMLResponse("""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Confirmed</title></head>
<body style="background:#000;color:#e7e9ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;">
<div style="text-align:center;max-width:400px;">
  <h1 style="font-size:24px;margin-bottom:8px;">Subscription Confirmed</h1>
  <p style="color:#71767b;">You're all set! You'll receive the digest when new issues are published.</p>
</div>
</body></html>""")


@router.get("/check", response_model=SubscriptionCheck)
async def check_subscription(
    digest_sub: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Check if the current browser has an active subscription cookie."""
    if not digest_sub:
        return SubscriptionCheck(subscribed=False)

    result = await db.execute(select(Subscriber).where(Subscriber.cookie_token == digest_sub))
    subscriber = result.scalar_one_or_none()
    if not subscriber or subscriber.unsubscribed_at:
        return SubscriptionCheck(subscribed=False)

    return SubscriptionCheck(subscribed=True)


@router.get("", response_model=list[SubscriberOut], dependencies=[Depends(require_admin)])
async def list_subscribers(db: AsyncSession = Depends(get_db)):
    """List all subscribers. Admin only."""
    result = await db.execute(select(Subscriber).order_by(Subscriber.subscribed_at.desc()))
    return result.scalars().all()


@router.get("/count", dependencies=[Depends(require_admin)])
async def subscriber_count(db: AsyncSession = Depends(get_db)):
    """Count active (confirmed, not unsubscribed) subscribers. Admin only."""
    result = await db.execute(
        select(func.count())
        .select_from(Subscriber)
        .where(
            Subscriber.confirmed_at.is_not(None),
            Subscriber.unsubscribed_at.is_(None),
        )
    )
    count = result.scalar() or 0
    return {"count": count}
