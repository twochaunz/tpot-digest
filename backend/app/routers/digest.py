"""Digest draft endpoints: CRUD, preview, send-test, send, process-scheduled."""

import json
import logging
from collections import OrderedDict
from datetime import datetime, timezone

import anthropic
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

# Category display order for grouping tweets within topics
CATEGORY_ORDER = ["og post", "echo", "context", "commentary", "pushback", "hot-take", "callout", "kek"]


def _format_date(d) -> str:
    """Format a date as 'March 1, 2026'."""
    return d.strftime("%B %-d, %Y")


async def _generate_topic_summary(topic_title: str, grok_contexts: list[str]) -> str | None:
    """Generate a 1-2 sentence topic summary from all tweets' grok_context."""
    if not settings.anthropic_api_key or not grok_contexts:
        return None

    contexts_text = "\n---\n".join(c for c in grok_contexts if c)
    if not contexts_text.strip():
        return None

    prompt = f"""You are writing a brief summary for a daily tech digest email.

Topic: "{topic_title}"

Context from tweets in this topic (each separated by ---):
{contexts_text}

Write a 1-2 sentence summary that captures the FULL discourse around this topic — not just the original post, but the reactions, pushback, and key points of debate. Be concise and informative. Write in a neutral, journalistic tone. No hype. No emojis.

Return ONLY the summary text, nothing else."""

    try:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=150,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text.strip()
    except Exception:
        logger.exception("Failed to generate topic summary for '%s'", topic_title)
        return None


async def _generate_category_transitions(
    topic_title: str,
    category_groups: list[dict],
) -> dict[str, str]:
    """Generate contextual one-liner transitions for each category group.

    Returns a dict mapping category name -> transition text.
    """
    if not settings.anthropic_api_key or len(category_groups) <= 1:
        return {}

    groups_desc = []
    for g in category_groups:
        cat = g["category"]
        tweet_snippets = [t["text"][:120] for t in g["tweets"][:3]]
        groups_desc.append(f"Category: {cat}\nSample tweets:\n" + "\n".join(f"  - {s}" for s in tweet_snippets))

    groups_text = "\n\n".join(groups_desc)

    prompt = f"""You are writing category transition text for a daily tech digest email.

Topic: "{topic_title}"

The tweets are grouped by category. For each category EXCEPT the first one (which needs no transition), write a brief, contextual one-liner that introduces the group. These should intrigue readers — not just name the category, but add a touch of color about what the tweets discuss.

Examples of good transitions:
- "some pushback on the pricing model:"
- "others are drawing parallels:"
- "a few sharp takes:"
- "the community had thoughts:"

Category groups:
{groups_text}

Return ONLY valid JSON mapping category name to transition text. Skip the first category (it needs no transition).
Example: {{"pushback": "some pushback on the pricing model:", "kek": "and of course, the memes:"}}"""

    try:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=256,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        return json.loads(text)
    except Exception:
        logger.exception("Failed to generate category transitions for '%s'", topic_title)
        return {}


def _build_tweet_dict(tw: Tweet, show_engagement: bool, quoted_tweet: Tweet | None = None) -> dict:
    """Build a tweet dict for template rendering."""
    tweet_dict = {
        "author_handle": tw.author_handle,
        "author_display_name": tw.author_display_name,
        "author_avatar_url": tw.author_avatar_url,
        "text": tw.text,
        "url": tw.url,
        "show_engagement": show_engagement,
    }
    if show_engagement:
        tweet_dict["engagement"] = tw.engagement
    if quoted_tweet:
        tweet_dict["quoted_tweet"] = {
            "author_handle": quoted_tweet.author_handle,
            "author_display_name": quoted_tweet.author_display_name,
            "author_avatar_url": quoted_tweet.author_avatar_url,
            "text": quoted_tweet.text,
            "url": quoted_tweet.url,
        }
    return tweet_dict


async def _build_digest_content(draft: DigestDraft, db: AsyncSession) -> list[dict]:
    """Build list of block dicts for rendering from content_blocks."""
    import markdown as md

    result_blocks = []
    topic_number = 0

    for block in (draft.content_blocks or []):
        block_type = block.get("type")

        if block_type == "text":
            content = block.get("content")
            if content:
                html_content = md.markdown(content, extensions=["extra"])
                result_blocks.append({"type": "text", "content": content, "html": html_content})

        elif block_type == "divider":
            result_blocks.append({"type": "divider"})

        elif block_type == "topic":
            topic_id = block.get("topic_id")
            if not topic_id:
                continue

            topic = await db.get(Topic, topic_id)
            if not topic:
                continue

            topic_number += 1

            # Fetch tweets WITH their assignments (for category)
            stmt = (
                select(Tweet, TweetAssignment.category)
                .join(TweetAssignment, TweetAssignment.tweet_id == Tweet.id)
                .where(TweetAssignment.topic_id == topic_id)
                .order_by(Tweet.saved_at)
            )
            rows = await db.execute(stmt)
            tweet_rows = rows.all()  # list of (Tweet, category)

            tweet_overrides = block.get("tweet_overrides") or {}

            # Collect grok_contexts for summary generation
            grok_contexts = []

            # Collect quoted tweet IDs to batch-fetch
            quoted_ids = set()
            for tw, _ in tweet_rows:
                if tw.grok_context:
                    grok_contexts.append(tw.grok_context)
                if tw.quoted_tweet_id:
                    quoted_ids.add(tw.quoted_tweet_id)

            # Batch-fetch quoted tweets
            quoted_tweets_map: dict[str, Tweet] = {}
            if quoted_ids:
                qt_stmt = select(Tweet).where(Tweet.tweet_id.in_(quoted_ids))
                qt_result = await db.execute(qt_stmt)
                for qt in qt_result.scalars().all():
                    quoted_tweets_map[qt.tweet_id] = qt

            # Group tweets by category, maintaining order
            category_tweets: OrderedDict[str, list[dict]] = OrderedDict()
            for tw, category in tweet_rows:
                cat = category or "og post"
                tw_override = tweet_overrides.get(str(tw.id), {})
                show_engagement = tw_override.get("show_engagement", False)
                quoted = quoted_tweets_map.get(tw.quoted_tweet_id) if tw.quoted_tweet_id else None
                tweet_dict = _build_tweet_dict(tw, show_engagement, quoted)

                if cat not in category_tweets:
                    category_tweets[cat] = []
                category_tweets[cat].append(tweet_dict)

            # Sort categories by defined order
            sorted_categories = sorted(
                category_tweets.keys(),
                key=lambda c: CATEGORY_ORDER.index(c) if c in CATEGORY_ORDER else len(CATEGORY_ORDER),
            )

            # Build category groups for template
            category_groups = []
            for cat in sorted_categories:
                category_groups.append({
                    "category": cat,
                    "tweets": category_tweets[cat],
                })

            # Generate AI topic summary
            summary = await _generate_topic_summary(topic.title, grok_contexts)

            # Generate AI category transitions
            transitions = await _generate_category_transitions(topic.title, category_groups)

            # Attach transitions to groups
            for group in category_groups:
                group["transition"] = transitions.get(group["category"])

            result_blocks.append({
                "type": "topic",
                "title": topic.title,
                "topic_number": topic_number,
                "summary": summary,
                "category_groups": category_groups,
            })

        elif block_type == "tweet":
            tweet_id = block.get("tweet_id")
            if not tweet_id:
                continue

            tw = await db.get(Tweet, tweet_id)
            if not tw:
                continue

            show_engagement = block.get("show_engagement", False)
            quoted = None
            if tw.quoted_tweet_id:
                qt_stmt = select(Tweet).where(Tweet.tweet_id == tw.quoted_tweet_id)
                qt_result = await db.execute(qt_stmt)
                quoted = qt_result.scalars().first()

            tweet_block = _build_tweet_dict(tw, show_engagement, quoted)
            tweet_block["type"] = "tweet"
            result_blocks.append(tweet_block)

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
    subject = f"abridged tech -- {date_str}"

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
    subject = f"[TEST] abridged tech -- {date_str}"

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
    subject = f"abridged tech -- {date_str}"

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
        subject = f"abridged tech -- {date_str}"

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
