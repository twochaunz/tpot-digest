import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Request, Response, status
from sqlalchemy import select

import app.db as db_module
from app.config import settings
from app.models.digest_send_log import DigestSendLog
from app.models.email_event import EmailEvent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])

TRACKED_EVENTS = {"email.delivered", "email.opened", "email.clicked", "email.bounced", "email.complained"}


@router.post("/resend", status_code=status.HTTP_204_NO_CONTENT)
async def resend_webhook(request: Request, response: Response):
    """Receive and store Resend webhook events."""
    payload = await request.body()
    headers = dict(request.headers)

    # Verify signature if secret is configured
    if settings.resend_webhook_secret:
        try:
            from svix.webhooks import Webhook, WebhookVerificationError
            wh = Webhook(settings.resend_webhook_secret)
            wh.verify(payload, headers)
        except WebhookVerificationError:
            logger.warning("Webhook signature verification failed")
            response.status_code = status.HTTP_400_BAD_REQUEST
            return

    try:
        body = json.loads(payload)
    except json.JSONDecodeError:
        response.status_code = status.HTTP_400_BAD_REQUEST
        return

    event_type_raw = body.get("type", "")
    if event_type_raw not in TRACKED_EVENTS:
        return

    data = body.get("data", {})
    resend_message_id = data.get("email_id")
    if not resend_message_id:
        return

    svix_id = headers.get("svix-id", "")
    if not svix_id:
        svix_id = f"{event_type_raw}-{resend_message_id}-{body.get('created_at', '')}"

    event_type = event_type_raw.replace("email.", "")

    click_data = data.get("click", {})
    link_url = click_data.get("link") if click_data else None
    ip_address = click_data.get("ipAddress") if click_data else None
    user_agent = click_data.get("userAgent") if click_data else None

    event_at_str = body.get("created_at", "")
    try:
        event_at = datetime.fromisoformat(event_at_str.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        event_at = datetime.now(timezone.utc)

    async with db_module.async_session() as session:
        existing = await session.execute(
            select(EmailEvent).where(EmailEvent.svix_id == svix_id)
        )
        if existing.scalars().first():
            return

        send_log = None
        if resend_message_id:
            result = await session.execute(
                select(DigestSendLog).where(
                    DigestSendLog.resend_message_id == resend_message_id
                )
            )
            send_log = result.scalars().first()

        event = EmailEvent(
            send_log_id=send_log.id if send_log else None,
            draft_id=send_log.draft_id if send_log else None,
            subscriber_id=send_log.subscriber_id if send_log else None,
            event_type=event_type,
            link_url=link_url,
            ip_address=ip_address,
            user_agent=user_agent,
            event_at=event_at,
            svix_id=svix_id,
        )
        session.add(event)
        await session.commit()

    logger.info("Stored %s event for message %s", event_type, resend_message_id)
