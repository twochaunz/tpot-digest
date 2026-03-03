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


