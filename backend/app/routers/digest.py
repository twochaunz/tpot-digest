"""Digest draft endpoints: CRUD, preview, send-test, send, process-scheduled."""

import json
import logging
import re
from collections import OrderedDict
from datetime import datetime, timedelta, timezone

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_admin
from app.config import settings
from app.db import get_db
from app.models.assignment import TweetAssignment
from app.models.digest_draft import DigestDraft
from app.models.digest_settings import DigestSettings, DEFAULT_WELCOME_MESSAGE
from app.models.digest_send_log import DigestSendLog
from app.services.translate import translate_text, TranslationError
from app.models.subscriber import Subscriber
from app.models.topic import Topic
from app.models.tweet import Tweet
from app.schemas.digest import (
    DigestDraftCreate,
    DigestDraftOut,
    DigestDraftUpdate,
    DigestPreview,
    DigestRetryRequest,
    DigestSendLogOut,
    DigestSendRequest,
    DigestSendTestRequest,
    DigestSettingsOut,
    DigestSettingsUpdate,
    GenerateTemplateRequest,
    SendStatusOut,
)
from app.services.email import render_digest_email, render_welcome_email, send_digest_batch, send_digest_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/digest", tags=["digest"], dependencies=[Depends(require_admin)])

# Category display order for grouping tweets within topics
CATEGORY_ORDER = ["og post", "echo", "context", "commentary", "pushback", "hot-take", "callout", "kek"]


def _format_date(d) -> str:
    """Format a date as 'March 1, 2026'."""
    return d.strftime("%B %-d, %Y")


def _default_subject(d) -> str:
    """Generate default subject like '3/3/26 abridged tech'."""
    return f"{d.month}/{d.day}/{d.strftime('%y')} abridged tech"


async def _get_or_create_settings(db: AsyncSession) -> DigestSettings:
    """Get the single DigestSettings row, creating defaults if none exists."""
    result = await db.execute(select(DigestSettings).where(DigestSettings.id == 1))
    settings_row = result.scalar_one_or_none()
    if not settings_row:
        settings_row = DigestSettings(
            id=1,
            welcome_send_mode="off",
            welcome_subject="no little piggies allowed",
            welcome_message=DEFAULT_WELCOME_MESSAGE,
        )
        db.add(settings_row)
        await db.commit()
        await db.refresh(settings_row)
    return settings_row


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

Write a 1-2 sentence summary that captures the FULL discourse around this topic — not just the original post, but the reactions, pushback, and key points of debate. Be concise and informative. Write in a neutral, journalistic tone. No hype. No emojis. Use simple past tense (e.g. "announced", "sparked debate", "pushed back"), NOT past progressive (e.g. "is announcing", "are debating"). Keep it quippy.

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


async def _generate_casual_intro(topic_titles: list[str]) -> str | None:
    """Generate a casual, conversational one-liner previewing the day's topics."""
    if not settings.anthropic_api_key or not topic_titles:
        return None

    titles_text = "\n".join(f"- {t}" for t in topic_titles)

    prompt = f"""You are writing a casual one-liner intro for a daily tech digest email.

Today's topics:
{titles_text}

Write a super casual, conversational preview of these topics — as if you're texting a friend about what happened today in tech. All lowercase, no periods at the end, keep it breezy and digestible. Can use emojis sparingly if it fits. Should feel like a friend catching you up, not a news anchor.

Examples of the right vibe:
- "andrej karpathy's new project, replit ceo's instigating words, and *cells* playing games.."
- "gpt-5.4 is out, cluely drama, and updates on anthropic/pentagon's shaky relationship :o"
- "not a lot yesterday, just an article of a fruit fly brain in a simulated body 😀"

Return ONLY the intro text, nothing else."""

    try:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=100,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text.strip()
    except Exception:
        logger.exception("Failed to generate casual intro")
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

Use simple past tense — keep it quippy and punchy, not progressive/continuous tense.

Examples of good transitions:
- "some pushed back on the pricing model"
- "others drew parallels"
- "a few sharp takes"
- "the community had thoughts"

IMPORTANT: Do NOT end transitions with colons. Just end the sentence naturally.

Category groups:
{groups_text}

Return ONLY valid JSON mapping category name to transition text. Skip the first category (it needs no transition).
Example: {{"pushback": "some pushback on the pricing model", "kek": "and of course, the memes"}}"""

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


_SKIP_TRANSLATE_LANGS = {"en", "und", "zxx", "qme", "qht", "art", "", None}


def _has_non_latin_text(text: str) -> bool:
    """Check if text contains non-Latin script characters that indicate non-English."""
    for c in text:
        cp = ord(c)
        # CJK, Japanese, Korean
        if '\u3040' <= c <= '\u30ff' or '\u4e00' <= c <= '\u9fff' or '\uac00' <= c <= '\ud7af':
            return True
        # Arabic, Hebrew, Thai, Devanagari, Cyrillic, etc.
        if 0x0600 <= cp <= 0x06FF or 0x0590 <= cp <= 0x05FF or 0x0E00 <= cp <= 0x0E7F:
            return True
        if 0x0900 <= cp <= 0x097F or 0x0400 <= cp <= 0x04FF:
            return True
    return False


def _needs_translation(tw: "Tweet") -> bool:
    """Check if a tweet has non-English text that needs translation."""
    if tw.translated_text:
        return False
    if not tw.text:
        return False
    # Always require actual non-Latin characters. The X API lang field is unreliable
    # for short texts (e.g. "WAT" gets lang="qst"). Only translate when the text
    # actually contains non-Latin script.
    return _has_non_latin_text(tw.text)


async def _auto_translate(tw: "Tweet", db: "AsyncSession") -> None:
    """Translate a tweet in-place and persist to DB."""
    if not _needs_translation(tw):
        return
    # Strip t.co links before translating — they're not translatable content
    text_to_translate = _strip_tco_links(tw.text) if tw.text else ""
    if not text_to_translate:
        return
    try:
        tw.translated_text = await translate_text(text_to_translate)
        await db.commit()
    except TranslationError:
        logger.warning("Auto-translate failed for tweet %d", tw.id)


def _proxy_avatar_url(avatar_url: str | None) -> str | None:
    """Rewrite avatar URL to go through our image proxy for email compatibility."""
    if not avatar_url:
        return avatar_url
    from urllib.parse import quote
    return f"https://abridged.tech/api/image-proxy?url={quote(avatar_url, safe='')}"


def _strip_tco_links(text: str) -> str:
    """Strip ALL t.co links from tweet text."""
    return re.sub(r'\s*https://t\.co/\w+', '', text).strip()


def _build_quoted_tweet_dict(quoted_tweet: "Tweet", nested_qt: "Tweet | None" = None) -> dict:
    """Build a quoted tweet dict, optionally with its own nested quoted tweet."""
    text = quoted_tweet.text
    if nested_qt or quoted_tweet.quoted_tweet_id:
        text = _strip_tco_links(text)

    # Strip article t.co link from text when article_title is present
    article_title = quoted_tweet.article_title
    article_url = None
    if article_title:
        text = _strip_tco_links(text)
        if quoted_tweet.url_entities:
            for e in quoted_tweet.url_entities:
                target = e.get("unwound_url") or e.get("expanded_url") or ""
                if "/i/article/" in target:
                    article_url = target
                    break

    qt: dict = {
        "author_handle": quoted_tweet.author_handle,
        "author_display_name": quoted_tweet.author_display_name,
        "author_avatar_url": _proxy_avatar_url(quoted_tweet.author_avatar_url),
        "text": text,
        "translated_text": quoted_tweet.translated_text if hasattr(quoted_tweet, 'translated_text') else None,
        "url": quoted_tweet.url,
        "media_images": _collect_media(quoted_tweet.media_urls),
        "link_cards": _build_link_cards(quoted_tweet.url_entities),
        "article_title": article_title,
        "article_url": article_url or quoted_tweet.url,
    }
    if nested_qt:
        qt["quoted_tweet"] = _build_quoted_tweet_dict(nested_qt)
    return qt


def _build_link_cards(url_entities: list[dict] | None) -> list[dict]:
    """Build link preview cards from url_entities, excluding media links."""
    if not url_entities:
        return []
    cards = []
    for e in url_entities:
        display = e.get("display_url", "")
        # Skip media links (these are rendered as images, not link cards)
        if any(domain in display for domain in ("pic.x.com", "pic.twitter.com", "x.com/", "twitter.com/")):
            continue
        card: dict = {
            "url": e.get("unwound_url") or e.get("expanded_url") or e.get("url", ""),
            "display_url": display,
        }
        if e.get("title"):
            card["title"] = e["title"]
        if e.get("description"):
            card["description"] = e["description"]
        if e.get("images") and len(e["images"]) > 0:
            img_url = e["images"][0].get("url", "")
            if img_url:
                card["image_url"] = _proxy_avatar_url(img_url)
        cards.append(card)
    return cards


def _collect_media(media_urls: list[dict] | None) -> list[dict]:
    """Extract media as structured dicts with URL and dimensions.

    Includes photos and video/gif thumbnails (preview_image_url).
    """
    images = []
    for m in (media_urls or []):
        if m.get("type") in ("photo", "video", "animated_gif") and m.get("url"):
            images.append({
                "url": _proxy_avatar_url(m["url"]),
                "width": m.get("width", 0),
                "height": m.get("height", 0),
                "is_video": m.get("type") == "video",
            })
    return images


def _build_tweet_dict(tw: Tweet, show_engagement: bool, quoted_tweet: "Tweet | dict | None" = None, nested_qt: "Tweet | dict | None" = None, *, show_media: bool = True) -> dict:
    """Build a tweet dict for template rendering."""
    text = _strip_tco_links(tw.text)
    media_images = _collect_media(tw.media_urls) if show_media else []

    # Find article URL if this is an X Article tweet
    article_title = tw.article_title
    article_url = None
    if article_title and tw.url_entities:
        for e in tw.url_entities:
            target = e.get("unwound_url") or e.get("expanded_url") or ""
            if "/i/article/" in target:
                article_url = target
                break

    tweet_dict = {
        "author_handle": tw.author_handle,
        "author_display_name": tw.author_display_name,
        "author_avatar_url": _proxy_avatar_url(tw.author_avatar_url),
        "text": text,
        "translated_text": tw.translated_text,
        "tweet_url": tw.url,
        "url": tw.url,
        "show_engagement": show_engagement,
        "link_cards": _build_link_cards(tw.url_entities) if show_media else [],
        "media_images": media_images,
        "article_title": article_title,
        "article_url": article_url or tw.url,
    }
    if show_engagement:
        tweet_dict["engagement"] = tw.engagement
    if quoted_tweet:
        tweet_dict["quoted_tweet"] = _build_quoted_tweet_dict(quoted_tweet, nested_qt)
    return tweet_dict


@router.post("/generate-template")
async def generate_template(body: GenerateTemplateRequest, db: AsyncSession = Depends(get_db)):
    """Generate AI content (summaries + transitions) for template assembly."""
    result_topics = []

    for topic_id in body.topic_ids:
        topic = await db.get(Topic, topic_id)
        if not topic:
            continue

        # Fetch tweets with categories
        stmt = (
            select(Tweet, TweetAssignment.category)
            .join(TweetAssignment, TweetAssignment.tweet_id == Tweet.id)
            .where(TweetAssignment.topic_id == topic_id)
            .order_by(Tweet.saved_at)
        )
        rows = await db.execute(stmt)
        tweet_rows = rows.all()

        # Collect grok_contexts for summary
        grok_contexts = [tw.grok_context for tw, _ in tweet_rows if tw.grok_context]

        # Group tweets by category
        category_tweets: OrderedDict[str, list[dict]] = OrderedDict()
        for tw, category in tweet_rows:
            cat = category or "og post"
            if cat not in category_tweets:
                category_tweets[cat] = []
            category_tweets[cat].append({
                "tweet_id": tw.id,
                "text": tw.text[:200],
            })

        # Sort categories
        sorted_categories = sorted(
            category_tweets.keys(),
            key=lambda c: CATEGORY_ORDER.index(c) if c in CATEGORY_ORDER else len(CATEGORY_ORDER),
        )

        category_groups = [
            {"category": cat, "tweet_ids": [t["tweet_id"] for t in category_tweets[cat]]}
            for cat in sorted_categories
        ]

        # Generate AI summary
        summary = await _generate_topic_summary(topic.title, grok_contexts)

        # Generate AI transitions
        transition_groups = [
            {"category": cat, "tweets": category_tweets[cat]}
            for cat in sorted_categories
        ]
        transitions = await _generate_category_transitions(topic.title, transition_groups)

        result_topics.append({
            "topic_id": topic_id,
            "title": topic.title,
            "summary": summary,
            "category_groups": [
                {**g, "transition": transitions.get(g["category"])}
                for g in category_groups
            ],
        })

    # Generate casual intro from topic titles
    topic_titles = [t["title"] for t in result_topics]
    intro = await _generate_casual_intro(topic_titles)

    return {"topics": result_topics, "intro": intro}


async def _fetch_quoted_tweet(tweet_id: str, db: "AsyncSession") -> "Tweet | None":
    """Look up a quoted tweet from the DB. No X API calls."""
    qt_stmt = select(Tweet).where(Tweet.tweet_id == tweet_id)
    qt_result = await db.execute(qt_stmt)
    return qt_result.scalars().first()


async def _fetch_quoted_chain(tw: "Tweet", db: "AsyncSession") -> tuple["Tweet | None", "Tweet | None"]:
    """Look up quoted tweet and its nested quoted tweet (one level deep) from DB."""
    if not tw.quoted_tweet_id:
        return None, None
    quoted = await _fetch_quoted_tweet(tw.quoted_tweet_id, db)
    if not quoted:
        return None, None
    nested = None
    if quoted.quoted_tweet_id:
        nested = await _fetch_quoted_tweet(quoted.quoted_tweet_id, db)
    return quoted, nested


async def _build_digest_content(draft: DigestDraft, db: AsyncSession) -> list[dict]:
    """Build list of block dicts for rendering from content_blocks.

    With the new block architecture, AI content is pre-generated into text blocks
    at template creation time. This function just renders blocks as-is.
    """
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

        elif block_type == "topic-header":
            topic_id = block.get("topic_id")
            if not topic_id:
                continue
            topic = await db.get(Topic, topic_id)
            if not topic:
                continue
            topic_number += 1
            result_blocks.append({
                "type": "topic-header",
                "title": topic.title,
                "topic_number": topic_number,
            })

        elif block_type == "tweet":
            tweet_id = block.get("tweet_id")
            if not tweet_id:
                continue

            tw = await db.get(Tweet, tweet_id)
            if not tw:
                continue

            # Auto-translate non-English tweets and their quoted tweets
            await _auto_translate(tw, db)

            show_engagement = block.get("show_engagement", False)
            show_media = block.get("show_media", True)
            show_quoted = block.get("show_quoted_tweet", True)
            quoted, nested_qt = (await _fetch_quoted_chain(tw, db)) if show_quoted else (None, None)
            if quoted:
                await _auto_translate(quoted, db)
            if nested_qt:
                await _auto_translate(nested_qt, db)

            tweet_block = _build_tweet_dict(tw, show_engagement, quoted, nested_qt, show_media=show_media)
            tweet_block["type"] = "tweet"
            result_blocks.append(tweet_block)

        # Legacy: old 'topic' blocks still render for existing drafts
        elif block_type == "topic":
            topic_id = block.get("topic_id")
            if not topic_id:
                continue
            topic = await db.get(Topic, topic_id)
            if not topic:
                continue
            topic_number += 1

            stmt = (
                select(Tweet)
                .join(TweetAssignment, TweetAssignment.tweet_id == Tweet.id)
                .where(TweetAssignment.topic_id == topic_id)
                .order_by(Tweet.saved_at)
            )
            rows = await db.execute(stmt)
            tweet_rows = rows.scalars().all()
            tweet_overrides = block.get("tweet_overrides") or {}
            tweet_dicts = []
            for tw in tweet_rows:
                tw_override = tweet_overrides.get(str(tw.id), {})
                show_eng = tw_override.get("show_engagement", False)
                quoted, nested_qt = await _fetch_quoted_chain(tw, db)
                tweet_dicts.append(_build_tweet_dict(tw, show_eng, quoted, nested_qt))

            result_blocks.append({
                "type": "topic",
                "title": topic.title,
                "topic_number": topic_number,
                "summary": None,
                "category_groups": [{"category": "og post", "transition": None, "tweets": tweet_dicts}],
            })

    return result_blocks


async def _send_welcome_emails(subscribers: list, db: AsyncSession) -> list[dict]:
    """Send welcome email to given subscribers using latest sent digest.

    Skips subscribers who already received the latest draft (dedup via digest_send_logs).
    """
    settings_row = await _get_or_create_settings(db)
    if settings_row.welcome_send_mode == "off":
        return []

    # Find latest sent draft
    result = await db.execute(
        select(DigestDraft)
        .where(DigestDraft.sent_at.is_not(None))
        .order_by(DigestDraft.sent_at.desc())
        .limit(1)
    )
    latest_draft = result.scalar_one_or_none()
    if not latest_draft:
        return []

    # Filter out subscribers who already got this draft
    sub_ids = [s.id for s in subscribers]
    existing_logs = await db.execute(
        select(DigestSendLog.subscriber_id)
        .where(
            DigestSendLog.draft_id == latest_draft.id,
            DigestSendLog.subscriber_id.in_(sub_ids),
        )
    )
    already_sent = set(existing_logs.scalars().all())
    eligible = [s for s in subscribers if s.id not in already_sent]
    if not eligible:
        return []

    # Build welcome email content
    blocks = await _build_digest_content(latest_draft, db)
    date_str = _format_date(latest_draft.date)
    digest_subject = latest_draft.subject or _default_subject(latest_draft.date)

    # Build batch
    batch_emails = []
    sub_by_email: dict[str, object] = {}
    for sub in eligible:
        unsubscribe_url = f"https://abridged.tech/api/subscribers/unsubscribe?token={sub.unsubscribe_token}"
        html = render_welcome_email(
            welcome_message=settings_row.welcome_message,
            welcome_subject=digest_subject,
            digest_date_str=date_str,
            digest_blocks=blocks,
            unsubscribe_url=unsubscribe_url,
        )
        batch_emails.append({
            "to_email": sub.email,
            "subject": settings_row.welcome_subject,
            "html_content": html,
            "unsubscribe_url": unsubscribe_url,
        })
        sub_by_email[sub.email] = sub

    # Send
    results = send_digest_batch(batch_emails)

    # Log results to digest_send_logs (for dedup)
    for r in results:
        sub = sub_by_email[r["to_email"]]
        log = DigestSendLog(
            draft_id=latest_draft.id,
            subscriber_id=sub.id,
            email=sub.email,
            status="sent" if r["success"] else "failed",
            error_message=r["error"],
            resend_message_id=r["result"].get("id") if r["result"] and isinstance(r["result"], dict) else None,
        )
        db.add(log)

    await db.commit()
    return results


@router.post("/drafts", response_model=DigestDraftOut, status_code=201)
async def create_draft(body: DigestDraftCreate, db: AsyncSession = Depends(get_db)):
    """Create a new digest draft."""
    draft = DigestDraft(
        date=body.date,
        content_blocks=[b.model_dump() for b in body.content_blocks],
        subject=body.subject,
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
        raise HTTPException(400, "Cannot edit a sent draft. Duplicate it first.")

    data = body.model_dump(exclude_unset=True)

    if "scheduled_for" in data:
        if data["scheduled_for"] is not None:
            draft.status = "scheduled"
        else:
            draft.status = "draft"

    if "content_blocks" in data and data["content_blocks"] is not None:
        draft.content_blocks = [b if isinstance(b, dict) else b.model_dump() for b in data["content_blocks"]]
        data.pop("content_blocks")

    for field, value in data.items():
        setattr(draft, field, value)

    await db.commit()
    await db.refresh(draft)
    return draft


@router.post("/drafts/{draft_id}/duplicate", response_model=DigestDraftOut, status_code=201)
async def duplicate_draft(draft_id: int, db: AsyncSession = Depends(get_db)):
    """Clone a draft as a new editable draft. Primary use: iterate on sent editions."""
    source = await db.get(DigestDraft, draft_id)
    if not source:
        raise HTTPException(404, "Draft not found")

    new_draft = DigestDraft(
        date=source.date,
        content_blocks=[dict(b) for b in source.content_blocks] if source.content_blocks else [],
        subject=source.subject,
    )
    db.add(new_draft)
    await db.commit()
    await db.refresh(new_draft)
    return new_draft


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
    subject = draft.subject or _default_subject(draft.date)

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
    base_subject = draft.subject or _default_subject(draft.date)
    subject = f"[TEST] {base_subject}"

    html = render_digest_email(
        date_str=date_str,
        blocks=blocks,
        unsubscribe_url="#",
    )

    result = send_digest_email(to_email, subject, html)
    return {"sent_to": to_email, "result": result}


@router.post("/drafts/{draft_id}/send")
async def send_digest(draft_id: int, body: DigestSendRequest | None = None, db: AsyncSession = Depends(get_db)):
    """Send the digest to active subscribers and mark as sent."""
    draft = await db.get(DigestDraft, draft_id)
    if not draft:
        raise HTTPException(404, "Draft not found")
    # Fetch active subscribers, optionally filtered by IDs
    query = select(Subscriber).where(Subscriber.unsubscribed_at.is_(None))
    if body and body.subscriber_ids is not None:
        query = query.where(Subscriber.id.in_(body.subscriber_ids))
    result = await db.execute(query)
    subscribers = result.scalars().all()

    blocks = await _build_digest_content(draft, db)
    date_str = _format_date(draft.date)
    subject = draft.subject or _default_subject(draft.date)

    # Build batch email payloads (one per subscriber with personalized unsubscribe URL)
    batch_emails = []
    sub_by_email: dict[str, "Subscriber"] = {}
    for sub in subscribers:
        unsubscribe_url = f"https://abridged.tech/api/subscribers/unsubscribe?token={sub.unsubscribe_token}&digest={draft_id}"
        html = render_digest_email(
            date_str=date_str,
            blocks=blocks,
            unsubscribe_url=unsubscribe_url,
        )
        batch_emails.append({
            "to_email": sub.email,
            "subject": subject,
            "html_content": html,
            "unsubscribe_url": unsubscribe_url,
        })
        sub_by_email[sub.email] = sub

    # Send all emails in a single Resend batch API call (up to 100)
    results = send_digest_batch(batch_emails)

    sent_count = 0
    for r in results:
        sub = sub_by_email[r["to_email"]]
        log = DigestSendLog(
            draft_id=draft_id,
            subscriber_id=sub.id,
            email=sub.email,
            status="sent" if r["success"] else "failed",
            error_message=r["error"],
            resend_message_id=r["result"].get("id") if r["result"] and isinstance(r["result"], dict) else None,
        )
        db.add(log)
        if r["success"]:
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
        subject = draft.subject or _default_subject(draft.date)

        batch_emails = []
        sub_by_email: dict[str, "Subscriber"] = {}
        for sub in subscribers:
            unsubscribe_url = f"https://abridged.tech/api/subscribers/unsubscribe?token={sub.unsubscribe_token}&digest={draft.id}"
            html = render_digest_email(
                date_str=date_str,
                blocks=blocks,
                unsubscribe_url=unsubscribe_url,
            )
            batch_emails.append({
                "to_email": sub.email,
                "subject": subject,
                "html_content": html,
                "unsubscribe_url": unsubscribe_url,
            })
            sub_by_email[sub.email] = sub

        results = send_digest_batch(batch_emails)

        sent_count = 0
        for r in results:
            sub = sub_by_email[r["to_email"]]
            log = DigestSendLog(
                draft_id=draft.id,
                subscriber_id=sub.id,
                email=sub.email,
                status="sent" if r["success"] else "failed",
                error_message=r["error"],
                resend_message_id=r["result"].get("id") if r["result"] and isinstance(r["result"], dict) else None,
            )
            db.add(log)
            if r["success"]:
                sent_count += 1

        draft.status = "sent"
        draft.sent_at = datetime.now(timezone.utc)
        draft.recipient_count = sent_count
        processed.append({"draft_id": draft.id, "sent_count": sent_count})

    await db.commit()
    return {"processed": len(processed), "details": processed}


@router.get("/drafts/{draft_id}/send-log")
async def get_draft_send_log(draft_id: int, db: AsyncSession = Depends(get_db)):
    """Get send logs for a specific draft."""
    result = await db.execute(
        select(DigestSendLog)
        .where(DigestSendLog.draft_id == draft_id)
        .order_by(DigestSendLog.attempted_at.desc())
    )
    logs = result.scalars().all()
    return [DigestSendLogOut.model_validate(log) for log in logs]


@router.get("/drafts/{draft_id}/send-status", response_model=SendStatusOut)
async def get_send_status(draft_id: int, db: AsyncSession = Depends(get_db)):
    """Check if a draft has been previously sent and to whom."""
    result = await db.execute(
        select(DigestSendLog)
        .where(DigestSendLog.draft_id == draft_id, DigestSendLog.status == "sent")
    )
    sent_logs = result.scalars().all()

    if not sent_logs:
        return SendStatusOut(
            previously_sent=False,
            sent_count=0,
            sent_at=None,
            sent_subscriber_ids=[],
        )

    # Deduplicate subscriber IDs (in case of retries)
    subscriber_ids = list({log.subscriber_id for log in sent_logs})
    earliest = min(log.attempted_at for log in sent_logs)

    return SendStatusOut(
        previously_sent=True,
        sent_count=len(subscriber_ids),
        sent_at=earliest,
        sent_subscriber_ids=subscriber_ids,
    )


@router.post("/drafts/{draft_id}/retry")
async def retry_failed_sends(draft_id: int, body: DigestRetryRequest | None = None, db: AsyncSession = Depends(get_db)):
    """Retry failed sends for a draft. Optional subscriber_ids to retry selectively."""
    draft = await db.get(DigestDraft, draft_id)
    if not draft:
        raise HTTPException(404, "Draft not found")

    # Find failed logs for this draft
    query = select(DigestSendLog).where(
        DigestSendLog.draft_id == draft_id,
        DigestSendLog.status == "failed",
    )
    if body and body.subscriber_ids is not None:
        query = query.where(DigestSendLog.subscriber_id.in_(body.subscriber_ids))
    result = await db.execute(query)
    failed_logs = result.scalars().all()

    if not failed_logs:
        return {"retried": 0, "sent": 0}

    # Get subscriber IDs to retry — deduplicate in case multiple failed attempts
    sub_ids = list({log.subscriber_id for log in failed_logs})
    sub_result = await db.execute(select(Subscriber).where(Subscriber.id.in_(sub_ids)))
    subscribers = {s.id: s for s in sub_result.scalars().all()}

    blocks = await _build_digest_content(draft, db)
    date_str = _format_date(draft.date)
    subject = draft.subject or _default_subject(draft.date)

    batch_emails = []
    sub_by_email: dict[str, "Subscriber"] = {}
    for sub_id in sub_ids:
        sub = subscribers.get(sub_id)
        if not sub:
            continue
        unsubscribe_url = f"https://abridged.tech/api/subscribers/unsubscribe?token={sub.unsubscribe_token}&digest={draft_id}"
        html = render_digest_email(date_str=date_str, blocks=blocks, unsubscribe_url=unsubscribe_url)
        batch_emails.append({
            "to_email": sub.email,
            "subject": subject,
            "html_content": html,
            "unsubscribe_url": unsubscribe_url,
        })
        sub_by_email[sub.email] = sub

    results = send_digest_batch(batch_emails)

    sent_count = 0
    for r in results:
        sub = sub_by_email[r["to_email"]]
        new_log = DigestSendLog(
            draft_id=draft_id,
            subscriber_id=sub.id,
            email=sub.email,
            status="sent" if r["success"] else "failed",
            error_message=r["error"],
            resend_message_id=r["result"].get("id") if r["result"] and isinstance(r["result"], dict) else None,
        )
        db.add(new_log)

        if r["success"]:
            sent_count += 1

    # Update draft recipient_count based on all successful sends
    all_sent_result = await db.execute(
        select(DigestSendLog).where(DigestSendLog.draft_id == draft_id, DigestSendLog.status == "sent")
    )
    draft.recipient_count = len(all_sent_result.scalars().all())
    await db.commit()

    return {"retried": len(sub_ids), "sent": sent_count}


@router.get("/send-log")
async def get_all_send_logs(
    status: str | None = None,
    draft_id: int | None = None,
    limit: int = 100,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """Get all send logs with optional filters."""
    query = select(DigestSendLog)
    if status:
        query = query.where(DigestSendLog.status == status)
    if draft_id:
        query = query.where(DigestSendLog.draft_id == draft_id)
    query = query.order_by(DigestSendLog.attempted_at.desc()).limit(limit).offset(offset)
    result = await db.execute(query)
    logs = result.scalars().all()
    return [DigestSendLogOut.model_validate(log) for log in logs]


# ---- Welcome Email Settings ----

@router.get("/settings", response_model=DigestSettingsOut)
async def get_digest_settings(db: AsyncSession = Depends(get_db)):
    """Get digest settings (upserts defaults if none exist)."""
    return await _get_or_create_settings(db)


@router.patch("/settings", response_model=DigestSettingsOut)
async def update_digest_settings(body: DigestSettingsUpdate, db: AsyncSession = Depends(get_db)):
    """Update digest settings."""
    settings_row = await _get_or_create_settings(db)
    if body.welcome_send_mode is not None:
        if body.welcome_send_mode not in ("off", "hourly", "immediate"):
            raise HTTPException(400, "welcome_send_mode must be 'off', 'hourly', or 'immediate'")
        settings_row.welcome_send_mode = body.welcome_send_mode
    if body.welcome_subject is not None:
        settings_row.welcome_subject = body.welcome_subject
    if body.welcome_message is not None:
        settings_row.welcome_message = body.welcome_message
    await db.commit()
    await db.refresh(settings_row)
    return settings_row


@router.get("/settings/welcome-preview")
async def welcome_preview(db: AsyncSession = Depends(get_db)):
    """Render a preview of the welcome email using current settings + latest sent digest."""
    settings_row = await _get_or_create_settings(db)

    # Find latest sent draft
    result = await db.execute(
        select(DigestDraft)
        .where(DigestDraft.sent_at.is_not(None))
        .order_by(DigestDraft.sent_at.desc())
        .limit(1)
    )
    latest_draft = result.scalar_one_or_none()

    if not latest_draft:
        import markdown as md
        resolved = settings_row.welcome_message
        welcome_html = md.markdown(resolved, extensions=["extra"])
        return {
            "subject": settings_row.welcome_subject,
            "html": f"<div style='padding:20px;font-family:sans-serif;'>{welcome_html}<hr style='margin:24px 0;border:none;border-top:1px solid #333;'/><p style='color:#71767b;font-style:italic;'>No digest sent yet — welcome email will begin sending after your first digest.</p></div>",
            "has_digest": False,
            "template_vars": {},
        }

    blocks = await _build_digest_content(latest_draft, db)
    date_str = _format_date(latest_draft.date)
    digest_subject = latest_draft.subject or _default_subject(latest_draft.date)

    html = render_welcome_email(
        welcome_message=settings_row.welcome_message,
        welcome_subject=digest_subject,
        digest_date_str=date_str,
        digest_blocks=blocks,
        unsubscribe_url="{{unsubscribe_url}}",
    )

    return {
        "subject": settings_row.welcome_subject,
        "html": html,
        "has_digest": True,
        "template_vars": {
            "date": date_str,
            "subject": digest_subject,
        },
    }


@router.post("/settings/welcome-test")
async def welcome_test(db: AsyncSession = Depends(get_db)):
    """Send a test welcome email to the admin email."""
    settings_row = await _get_or_create_settings(db)

    if not settings.admin_email:
        raise HTTPException(400, "No admin_email configured")

    result = await db.execute(
        select(DigestDraft)
        .where(DigestDraft.sent_at.is_not(None))
        .order_by(DigestDraft.sent_at.desc())
        .limit(1)
    )
    latest_draft = result.scalar_one_or_none()
    if not latest_draft:
        raise HTTPException(400, "No sent digest yet — cannot send welcome test")

    blocks = await _build_digest_content(latest_draft, db)
    date_str = _format_date(latest_draft.date)
    digest_subject = latest_draft.subject or _default_subject(latest_draft.date)

    html = render_welcome_email(
        welcome_message=settings_row.welcome_message,
        welcome_subject=digest_subject,
        digest_date_str=date_str,
        digest_blocks=blocks,
        unsubscribe_url="#",
    )

    email_result = send_digest_email(
        settings.admin_email,
        f"[TEST] {settings_row.welcome_subject}",
        html,
    )
    return {"sent_to": settings.admin_email, "result": email_result}


@router.post("/process-welcome")
async def process_welcome(db: AsyncSession = Depends(get_db)):
    """Process welcome emails for recent subscribers. Designed for hourly cron."""
    settings_row = await _get_or_create_settings(db)
    if settings_row.welcome_send_mode != "hourly":
        return {"processed": 0, "mode": settings_row.welcome_send_mode, "message": "Not in hourly mode"}

    # Find subscribers from last 2 hours (overlap window for safety)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=2)
    result = await db.execute(
        select(Subscriber).where(
            Subscriber.subscribed_at >= cutoff,
            Subscriber.unsubscribed_at.is_(None),
        )
    )
    new_subscribers = result.scalars().all()

    if not new_subscribers:
        return {"processed": 0, "message": "No new subscribers"}

    results = await _send_welcome_emails(new_subscribers, db)
    sent = sum(1 for r in results if r["success"])
    return {"processed": sent, "total_eligible": len(new_subscribers)}
