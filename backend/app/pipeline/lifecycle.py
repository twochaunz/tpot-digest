from datetime import date, timedelta
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.topic import Topic, LifecycleStatus
from app.models.tweet import Tweet, EngagementSnapshot


def compute_lifecycle_status(
    velocity: float,
    prev_status: str,
    tweet_count: int = 0,
) -> str:
    """
    State machine for topic lifecycle transitions.

    EMERGING -> TRENDING: velocity > 100 or tweet_count >= 5
    TRENDING -> PEAKED: velocity is declining (negative)
    PEAKED -> FADING: velocity near zero or negative for sustained period
    FADING -> EMERGING: re-surge (velocity > 100 again, cross-day)
    """
    if prev_status == "emerging":
        if velocity > 100 or tweet_count >= 5:
            return "trending"
        return "emerging"

    elif prev_status == "trending":
        if velocity < 0:
            return "peaked"
        return "trending"

    elif prev_status == "peaked":
        if velocity < -50:
            return "fading"
        if velocity > 100:
            return "trending"  # Re-surge
        return "peaked"

    elif prev_status == "fading":
        if velocity > 100:
            return "emerging"  # Cross-day re-surge
        return "fading"

    return prev_status


async def refresh_engagement(
    db: AsyncSession,
    tweet_ids: list[int],
    new_engagement_data: dict[int, dict],
) -> list[dict]:
    """
    Update engagement metrics for tracked tweets.
    Creates new EngagementSnapshot records and computes velocity.

    new_engagement_data: {tweet_db_id: {"likes": N, "retweets": N, "replies": N}}

    Returns velocity info per tweet.
    """
    velocities = []

    for tweet_id in tweet_ids:
        if tweet_id not in new_engagement_data:
            continue

        new_data = new_engagement_data[tweet_id]

        # Get latest existing snapshot for comparison
        result = await db.execute(
            select(EngagementSnapshot)
            .where(EngagementSnapshot.tweet_id == tweet_id)
            .order_by(EngagementSnapshot.recorded_at.desc())
            .limit(1)
        )
        prev_snapshot = result.scalar_one_or_none()

        # Create new snapshot
        snapshot = EngagementSnapshot(
            tweet_id=tweet_id,
            likes=new_data.get("likes", 0),
            retweets=new_data.get("retweets", 0),
            replies=new_data.get("replies", 0),
        )
        db.add(snapshot)

        # Compute velocity (change since last snapshot)
        if prev_snapshot:
            likes_delta = new_data.get("likes", 0) - prev_snapshot.likes
            retweets_delta = new_data.get("retweets", 0) - prev_snapshot.retweets
            replies_delta = new_data.get("replies", 0) - prev_snapshot.replies
            velocity = likes_delta + (retweets_delta * 2) + (replies_delta * 3)
        else:
            # First snapshot — velocity is just the current engagement
            velocity = (
                new_data.get("likes", 0)
                + new_data.get("retweets", 0) * 2
                + new_data.get("replies", 0) * 3
            )

        # Update tweet's velocity
        tweet = await db.get(Tweet, tweet_id)
        if tweet:
            tweet.engagement_velocity = velocity
            tweet.engagement = new_data

        velocities.append({"tweet_id": tweet_id, "velocity": velocity})

    await db.commit()
    return velocities


async def update_topic_lifecycle(db: AsyncSession, topic_id: int) -> str:
    """
    Recalculate and update a topic's lifecycle status based on its tweets' velocities.
    """
    topic = await db.get(Topic, topic_id)
    if not topic:
        return "unknown"

    # Get all tweets for this topic via subtopics
    from app.models.topic import SubTopicTweet, SubTopic

    result = await db.execute(
        select(Tweet)
        .join(SubTopicTweet, SubTopicTweet.tweet_id == Tweet.id)
        .join(SubTopic, SubTopic.id == SubTopicTweet.subtopic_id)
        .where(SubTopic.topic_id == topic_id)
    )
    tweets = result.scalars().all()

    if not tweets:
        return topic.lifecycle_status.value

    # Average velocity across all tweets
    velocities = [t.engagement_velocity or 0 for t in tweets]
    avg_velocity = sum(velocities) / len(velocities) if velocities else 0

    new_status = compute_lifecycle_status(
        velocity=avg_velocity,
        prev_status=topic.lifecycle_status.value,
        tweet_count=len(tweets),
    )

    topic.lifecycle_status = LifecycleStatus(new_status)
    await db.commit()

    return new_status


async def bridge_cross_day_topics(db: AsyncSession) -> list[dict]:
    """
    Check yesterday's EMERGING and TRENDING topics.
    If they're gaining traction today, link them to today's date.
    """
    yesterday = date.today() - timedelta(days=1)
    today = date.today()

    result = await db.execute(
        select(Topic).where(
            Topic.date == yesterday,
            Topic.lifecycle_status.in_([LifecycleStatus.EMERGING, LifecycleStatus.TRENDING]),
        )
    )
    candidates = result.scalars().all()

    bridged = []
    for topic in candidates:
        # Check if a similar topic already exists for today
        existing = await db.execute(
            select(Topic).where(
                Topic.date == today,
                Topic.title == topic.title,
            )
        )
        if existing.scalar_one_or_none():
            continue

        # Create today's continuation
        new_topic = Topic(
            date=today,
            title=topic.title,
            summary=f"Continuation from {yesterday}: {topic.summary or ''}",
            rank=topic.rank,
            lifecycle_status=LifecycleStatus.EMERGING,
            sentiment=topic.sentiment,
            tags=topic.tags,
        )
        db.add(new_topic)
        bridged.append({"original_id": topic.id, "title": topic.title})

    await db.commit()
    return bridged
