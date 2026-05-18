from datetime import date
from io import BytesIO
from html import escape
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse, Response
from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.assignment import TweetAssignment
from app.models.topic import Topic
from app.models.tweet import Tweet

router = APIRouter(tags=["share"])

SITE_ORIGIN = "https://abridged.tech"
SITE_TITLE = "abridged tech"
SITE_DESCRIPTION = "daily curated tech discourse"
STATIC_OG_IMAGE = f"{SITE_ORIGIN}/og-image.png"


def _parse_date_slug(date_slug: str) -> date | None:
    try:
        if len(date_slug) == 8:
            return date(
                int(date_slug[0:4]),
                int(date_slug[4:6]),
                int(date_slug[6:8]),
            )
        if len(date_slug) == 10 and date_slug[4] == "-" and date_slug[7] == "-":
            return date.fromisoformat(date_slug)
    except ValueError:
        return None
    return None


def _is_kek(title: str) -> bool:
    return title.lower() == "kek"


def _first_media_image(media_urls: Any) -> str | None:
    if not media_urls:
        return None
    if isinstance(media_urls, str):
        return media_urls
    if not isinstance(media_urls, list):
        return None

    for item in media_urls:
        if isinstance(item, str) and item:
            return item
        if not isinstance(item, dict):
            continue
        media_type = item.get("type")
        if media_type and media_type not in {"photo", "animated_gif", "video"}:
            continue
        url = item.get("url") or item.get("media_url_https")
        if isinstance(url, str) and url:
            return url
    return None


async def _resolve_topic(
    db: AsyncSession,
    date_slug: str,
    topic_num: int,
) -> tuple[Topic, Tweet | None] | None:
    day = _parse_date_slug(date_slug)
    if day is None or topic_num < 1:
        return None

    tweet_count = func.count(TweetAssignment.tweet_id).label("tweet_count")
    earliest_saved_at = func.min(Tweet.saved_at).label("earliest_saved_at")
    result = await db.execute(
        select(Topic, tweet_count, earliest_saved_at)
        .outerjoin(TweetAssignment, TweetAssignment.topic_id == Topic.id)
        .outerjoin(Tweet, Tweet.id == TweetAssignment.tweet_id)
        .where(Topic.date == day)
        .group_by(Topic.id)
    )
    rows = result.all()
    rows.sort(
        key=lambda row: (
            1 if _is_kek(row[0].title) else 0,
            -(row[1] or 0),
            row[2].isoformat() if row[2] else "",
            row[0].position,
            row[0].id,
        )
    )

    if topic_num > len(rows):
        return None

    topic = rows[topic_num - 1][0]
    og_tweet = await db.get(Tweet, topic.og_tweet_id) if topic.og_tweet_id else None
    return topic, og_tweet


def _trim(text: str, limit: int) -> str:
    collapsed = " ".join(text.split())
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 1].rstrip() + "..."


def _description(og_tweet: Tweet | None) -> str:
    if not og_tweet:
        return SITE_DESCRIPTION
    if og_tweet.text:
        return _trim(og_tweet.text, 220)
    if og_tweet.grok_context:
        return _trim(og_tweet.grok_context, 220)
    return SITE_DESCRIPTION


def _html(title: str, description: str, image_url: str, page_url: str) -> str:
    title_attr = escape(title, quote=True)
    description_attr = escape(description, quote=True)
    image_attr = escape(image_url, quote=True)
    page_attr = escape(page_url, quote=True)

    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title_attr}</title>
    <meta name="description" content="{description_attr}">
    <meta property="og:title" content="{title_attr}">
    <meta property="og:description" content="{description_attr}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="{page_attr}">
    <meta property="og:image" content="{image_attr}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="{title_attr}">
    <meta name="twitter:description" content="{description_attr}">
    <meta name="twitter:image" content="{image_attr}">
  </head>
  <body>
    <p><a href="{page_attr}">{title_attr}</a></p>
  </body>
</html>
"""


@router.get("/app/{date_slug}/{topic_num}", response_class=HTMLResponse)
async def topic_share_preview(
    date_slug: str,
    topic_num: int,
    db: AsyncSession = Depends(get_db),
):
    page_url = f"{SITE_ORIGIN}/app/{date_slug}/{topic_num}"
    resolved = await _resolve_topic(db, date_slug, topic_num)
    if not resolved:
        return HTMLResponse(_html(SITE_TITLE, SITE_DESCRIPTION, STATIC_OG_IMAGE, page_url))

    topic, og_tweet = resolved
    title = topic.title or SITE_TITLE
    description = _description(og_tweet)
    media_image = _first_media_image(og_tweet.media_urls) if og_tweet else None
    image_url = media_image or f"{SITE_ORIGIN}/api/og/topic/{date_slug}/{topic_num}.png"

    return HTMLResponse(_html(title, description, image_url, page_url))


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    names = (
        "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf",
        "Arial Bold.ttf" if bold else "Arial.ttf",
    )
    for name in names:
        try:
            return ImageFont.truetype(name, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def _wrap_for_draw(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    max_width: int,
    max_lines: int,
) -> list[str]:
    words = " ".join(text.split()).split()
    if not words:
        return [SITE_DESCRIPTION]

    lines: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if draw.textlength(candidate, font=font) <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
        current = word
        if len(lines) == max_lines:
            break
    if current and len(lines) < max_lines:
        lines.append(current)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
    if len(lines) == max_lines and len(" ".join(words)) > len(" ".join(lines)):
        lines[-1] = _trim(lines[-1], max(8, len(lines[-1]) - 1))
    return lines


@router.get("/api/og/topic/{date_slug}/{topic_num}.png")
async def topic_share_image(
    date_slug: str,
    topic_num: int,
    db: AsyncSession = Depends(get_db),
):
    resolved = await _resolve_topic(db, date_slug, topic_num)
    topic: Topic | None = resolved[0] if resolved else None
    og_tweet: Tweet | None = resolved[1] if resolved else None

    day = _parse_date_slug(date_slug)
    display_date = f"{day.strftime('%b')} {day.day}, {day.year}" if day else "abridged tech"
    title = topic.title if topic else SITE_TITLE
    text = _description(og_tweet)
    handle = f"@{og_tweet.author_handle}" if og_tweet else SITE_TITLE

    image = Image.new("RGB", (1200, 630), "#101418")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (40, 40, 1160, 590),
        radius=28,
        fill="#161b22",
        outline="#2d333b",
        width=2,
    )

    label_font = _font(28)
    title_font = _font(42, bold=True)
    body_font = _font(40, bold=True)
    handle_font = _font(30, bold=True)
    mark_font = _font(34, bold=True)

    draw.text((76, 78), f"{SITE_TITLE} - {display_date}", fill="#aab4c0", font=label_font)
    draw.text((76, 136), _trim(title, 44), fill="#ffffff", font=title_font)

    y = 246
    for line in _wrap_for_draw(draw, text, body_font, 1040, 5):
        draw.text((76, y), line, fill="#f4f7fb", font=body_font)
        y += 52

    draw.text((76, 518), handle, fill="#d7dee8", font=handle_font)
    draw.text((1060, 518), "a/t", fill="#d7dee8", font=mark_font)

    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return Response(
        content=buffer.getvalue(),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=300"},
    )
