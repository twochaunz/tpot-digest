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
    unsubscribe_url: str | None = None,
) -> str:
    """Render digest email HTML from template."""
    template = _jinja_env.get_template("digest_email.html")
    return template.render(
        date_str=date_str,
        blocks=blocks,
        unsubscribe_url=unsubscribe_url,
    )


def render_welcome_email(
    welcome_message: str,
    welcome_subject: str,
    digest_date_str: str,
    digest_blocks: list[dict],
    unsubscribe_url: str,
) -> str:
    """Render welcome email: welcome text + divider + full digest content."""
    import markdown as md

    # Resolve template variables in welcome message
    resolved_message = welcome_message.replace(
        "{{date}}", digest_date_str
    ).replace(
        "{{subject}}", welcome_subject
    )

    # Build combined blocks: welcome text + divider + original digest blocks
    welcome_html = md.markdown(resolved_message, extensions=["extra"])
    combined_blocks = [
        {"type": "text", "content": resolved_message, "html": welcome_html},
        {"type": "divider"},
        *digest_blocks,
    ]

    return render_digest_email(
        date_str=digest_date_str,
        blocks=combined_blocks,
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


def send_digest_batch(
    emails: list[dict],
) -> list[dict]:
    """Send up to 100 digest emails in a single Resend batch API call.

    Each item in `emails` should have keys: to_email, subject, html_content, unsubscribe_url.
    Returns a list of dicts with keys: to_email, success, result, error.
    """
    if not settings.resend_api_key:
        logger.warning("RESEND_API_KEY not set -- skipping batch send")
        return [
            {"to_email": e["to_email"], "success": False, "result": None, "error": "RESEND_API_KEY not set"}
            for e in emails
        ]

    import resend

    resend.api_key = settings.resend_api_key

    params_list = []
    for e in emails:
        headers: dict[str, str] = {}
        if e.get("unsubscribe_url"):
            headers["List-Unsubscribe"] = f"<{e['unsubscribe_url']}>"
            headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
        params_list.append({
            "from": settings.digest_from_email,
            "reply_to": settings.digest_reply_to_email,
            "to": [e["to_email"]],
            "subject": e["subject"],
            "html": e["html_content"],
            "headers": headers,
        })

    try:
        response = resend.Batch.send(params_list)
        # response.data is a list of {"id": "msg_..."} for each email
        results = []
        for i, e in enumerate(emails):
            item = response.data[i] if i < len(response.data) else None
            results.append({
                "to_email": e["to_email"],
                "success": True,
                "result": {"id": item.get("id")} if item else None,
                "error": None,
            })
        logger.info("Batch sent %d emails successfully", len(emails))
        return results
    except Exception as exc:
        logger.exception("Batch send failed for %d emails", len(emails))
        return [
            {"to_email": e["to_email"], "success": False, "result": None, "error": str(exc)}
            for e in emails
        ]


