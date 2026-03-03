"""Email service: render digest HTML and send via Resend."""

import logging
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from app.config import settings

logger = logging.getLogger(__name__)

_TEMPLATE_DIR = Path(__file__).parent.parent / "templates"
_jinja_env = Environment(loader=FileSystemLoader(str(_TEMPLATE_DIR)), autoescape=True)


def render_digest_email(
    date_str: str,
    blocks: list[dict],
    unsubscribe_url: str,
) -> str:
    """Render digest email HTML from template."""
    template = _jinja_env.get_template("digest_email.html")
    return template.render(
        date_str=date_str,
        blocks=blocks,
        unsubscribe_url=unsubscribe_url,
    )


def send_digest_email(to_email: str, subject: str, html_content: str) -> dict | None:
    """Send a digest email via Resend. Returns Resend response or None if not configured."""
    if not settings.resend_api_key:
        logger.warning("RESEND_API_KEY not set -- skipping digest email to %s", to_email)
        return None

    import resend

    resend.api_key = settings.resend_api_key
    params = {
        "from": settings.from_email,
        "to": [to_email],
        "subject": subject,
        "html": html_content,
    }
    try:
        result = resend.Emails.send(params)
        logger.info("Digest email sent to %s: %s", to_email, result)
        return result
    except Exception:
        logger.exception("Failed to send digest email to %s", to_email)
        return None


def send_confirmation_email(to_email: str, confirmation_url: str) -> dict | None:
    """Send a subscription confirmation email via Resend."""
    if not settings.resend_api_key:
        logger.warning("RESEND_API_KEY not set -- skipping confirmation email to %s", to_email)
        return None

    import resend

    resend.api_key = settings.resend_api_key
    html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="background:#000;color:#e7e9ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:40px 20px;">
  <div style="max-width:480px;margin:0 auto;text-align:center;">
    <h1 style="font-size:24px;margin-bottom:8px;">abridged</h1>
    <p style="color:#71767b;margin-bottom:32px;">Confirm your subscription</p>
    <p style="margin-bottom:24px;">Click the button below to confirm your email and start receiving the digest.</p>
    <a href="{confirmation_url}" style="display:inline-block;background:#00a67d;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">Confirm Subscription</a>
    <p style="color:#71767b;font-size:13px;margin-top:32px;">If you didn't subscribe, you can ignore this email.</p>
  </div>
</body>
</html>"""

    params = {
        "from": settings.from_email,
        "to": [to_email],
        "subject": "Confirm your subscription to abridged",
        "html": html,
    }
    try:
        result = resend.Emails.send(params)
        logger.info("Confirmation email sent to %s: %s", to_email, result)
        return result
    except Exception:
        logger.exception("Failed to send confirmation email to %s", to_email)
        return None
