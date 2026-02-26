from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.assignment import TweetAssignment
from app.models.topic import Topic
from app.models.topic_script import TopicScript
from app.models.tweet import Tweet
from app.schemas.topic_script import (
    DayScriptGenerateRequest,
    ScriptGenerateRequest,
    ScriptOut,
    ScriptVersionSummary,
)
from app.services.script_generator import (
    DEFAULT_STYLE_GUIDE,
    ScriptGeneratorError,
    build_prompt,
    generate_script,
)

router = APIRouter(tags=["scripts"])


async def _get_topic_tweets(topic_id: int, db: AsyncSession) -> tuple[Topic, Tweet | None, list[dict]]:
    """Load a topic, its OG tweet, and all assigned tweets with categories."""
    topic = await db.get(Topic, topic_id)
    if not topic:
        raise HTTPException(404, "Topic not found")

    og_tweet = None
    if topic.og_tweet_id:
        og_tweet = await db.get(Tweet, topic.og_tweet_id)

    rows = (await db.execute(
        select(Tweet, TweetAssignment.category)
        .join(TweetAssignment, TweetAssignment.tweet_id == Tweet.id)
        .where(TweetAssignment.topic_id == topic_id)
    )).all()

    tweets = []
    for tweet, category in rows:
        tweets.append({
            "tweet_id": tweet.tweet_id,
            "author_handle": tweet.author_handle,
            "text": tweet.text,
            "url": tweet.url,
            "category": category,
            "grok_context": tweet.grok_context,
        })

    return topic, og_tweet, tweets


async def _fetch_missing_grok_contexts(topic_id: int, db: AsyncSession):
    """Fetch Grok context for all tweets in topic that don't have it cached."""
    from app.services.grok_api import fetch_grok_context, GrokAPIError

    rows = (await db.execute(
        select(Tweet)
        .join(TweetAssignment, TweetAssignment.tweet_id == Tweet.id)
        .where(TweetAssignment.topic_id == topic_id)
        .where(Tweet.grok_context.is_(None))
    )).scalars().all()

    for tweet in rows:
        tweet_url = tweet.url or f"https://x.com/{tweet.author_handle}/status/{tweet.tweet_id}"
        try:
            tweet.grok_context = await fetch_grok_context(tweet_url)
        except GrokAPIError:
            pass  # Skip tweets where Grok fails, continue with rest

    await db.commit()


@router.post("/api/topics/{topic_id}/script/generate", response_model=ScriptOut)
async def generate_topic_script(
    topic_id: int,
    body: ScriptGenerateRequest,
    db: AsyncSession = Depends(get_db),
):
    # Fetch Grok context for tweets if requested
    if body.fetch_grok_context:
        await _fetch_missing_grok_contexts(topic_id, db)

    topic, og_tweet, tweets = await _get_topic_tweets(topic_id, db)

    # Build OG tweet dict
    og_dict = None
    if og_tweet:
        og_dict = {
            "tweet_id": og_tweet.tweet_id,
            "text": og_tweet.text,
            "url": og_tweet.url or f"https://x.com/{og_tweet.author_handle}/status/{og_tweet.tweet_id}",
            "grok_context": og_tweet.grok_context,
        }

    # Load previous active script if regenerating with feedback
    previous_script = None
    if body.feedback:
        prev = (await db.execute(
            select(TopicScript)
            .where(TopicScript.topic_id == topic_id, TopicScript.is_active.is_(True))
        )).scalar_one_or_none()
        if prev:
            previous_script = prev.content

    # Build prompt and generate
    prompt = build_prompt(
        topic_title=topic.title,
        og_tweet=og_dict,
        tweets=tweets,
        style_guide=DEFAULT_STYLE_GUIDE,
        previous_script=previous_script,
        feedback=body.feedback,
    )

    try:
        blocks = await generate_script(model=body.model, prompt=prompt)
    except ScriptGeneratorError as e:
        raise HTTPException(502, str(e))

    # Validate tweet_ids in generated blocks exist in the topic
    valid_tweet_ids = {t["tweet_id"] for t in tweets}
    if og_tweet:
        valid_tweet_ids.add(og_tweet.tweet_id)
    blocks = [
        b for b in blocks
        if b.get("type") != "tweet" or b.get("tweet_id") in valid_tweet_ids
    ]

    # Deactivate previous versions
    prev_scripts = (await db.execute(
        select(TopicScript)
        .where(TopicScript.topic_id == topic_id, TopicScript.is_active.is_(True))
    )).scalars().all()
    for ps in prev_scripts:
        ps.is_active = False

    # Determine next version
    max_version = (await db.execute(
        select(TopicScript.version)
        .where(TopicScript.topic_id == topic_id)
        .order_by(TopicScript.version.desc())
        .limit(1)
    )).scalar_one_or_none() or 0

    script = TopicScript(
        topic_id=topic_id,
        version=max_version + 1,
        model_used=body.model,
        content=blocks,
        feedback=body.feedback,
        is_active=True,
    )
    db.add(script)
    await db.commit()
    await db.refresh(script)
    return script


@router.get("/api/topics/{topic_id}/script", response_model=ScriptOut)
async def get_active_script(
    topic_id: int,
    db: AsyncSession = Depends(get_db),
):
    script = (await db.execute(
        select(TopicScript)
        .where(TopicScript.topic_id == topic_id, TopicScript.is_active.is_(True))
    )).scalar_one_or_none()

    if not script:
        raise HTTPException(404, "No script found for this topic")

    return script


@router.get("/api/topics/{topic_id}/script/versions", response_model=list[ScriptVersionSummary])
async def list_script_versions(
    topic_id: int,
    db: AsyncSession = Depends(get_db),
):
    scripts = (await db.execute(
        select(TopicScript)
        .where(TopicScript.topic_id == topic_id)
        .order_by(TopicScript.version)
    )).scalars().all()
    return scripts


@router.post("/api/dates/{date}/script/generate", response_model=list[ScriptOut])
async def generate_day_scripts(
    date: date,
    body: DayScriptGenerateRequest,
    db: AsyncSession = Depends(get_db),
):
    topics = (await db.execute(
        select(Topic).where(Topic.date == date).order_by(Topic.position)
    )).scalars().all()

    if body.topic_ids:
        allowed = set(body.topic_ids)
        topics = [t for t in topics if t.id in allowed]

    results = []
    for topic in topics:
        req = ScriptGenerateRequest(model=body.model, fetch_grok_context=body.fetch_grok_context)
        script = await generate_topic_script(topic.id, req, db)
        results.append(script)

    return results


@router.get("/api/dates/{date}/script", response_model=list[ScriptOut])
async def get_day_scripts(
    date: date,
    db: AsyncSession = Depends(get_db),
):
    topics = (await db.execute(
        select(Topic).where(Topic.date == date).order_by(Topic.position)
    )).scalars().all()

    scripts = []
    for topic in topics:
        script = (await db.execute(
            select(TopicScript)
            .where(TopicScript.topic_id == topic.id, TopicScript.is_active.is_(True))
        )).scalar_one_or_none()
        if script:
            scripts.append(script)

    return scripts
