"""Email service: render digest HTML and send via Resend."""

import logging
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from app.config import settings

logger = logging.getLogger(__name__)

_TEMPLATE_DIR = Path(__file__).parent.parent / "templates"
_jinja_env = Environment(loader=FileSystemLoader(str(_TEMPLATE_DIR)), autoescape=False)


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


def send_digest_email(
    to_email: str,
    subject: str,
    html_content: str,
    unsubscribe_url: str | None = None,
) -> dict:
    """Send a digest email via Resend. Returns a dict with keys: success, result, error."""
    if not settings.resend_api_key:
        logger.warning("RESEND_API_KEY not set -- skipping digest email to %s", to_email)
        return {"success": False, "result": None, "error": "RESEND_API_KEY not set"}

    import resend

    resend.api_key = settings.resend_api_key
    headers: dict[str, str] = {}
    if unsubscribe_url:
        headers["List-Unsubscribe"] = f"<{unsubscribe_url}>"
        headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"

    params = {
        "from": settings.digest_from_email,
        "reply_to": settings.digest_reply_to_email,
        "to": [to_email],
        "subject": subject,
        "html": html_content,
        "headers": headers,
    }
    try:
        result = resend.Emails.send(params)
        logger.info("Digest email sent to %s: %s", to_email, result)
        return {"success": True, "result": result, "error": None}
    except Exception as exc:
        logger.exception("Failed to send digest email to %s", to_email)
        return {"success": False, "result": None, "error": str(exc)}


