"""
Auto-discovery of high-signal accounts.

Analyzes tweet data to find accounts that frequently appear in
quality content and are engaged with by seed accounts.
"""

from collections import Counter

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, AccountSource
from app.models.tweet import Tweet


async def discover_accounts(
    db: AsyncSession,
    min_appearances: int = 3,
    max_suggestions: int = 10,
) -> list[dict]:
    """
    Discover high-signal accounts not yet in the seed list.

    Algorithm:
    1. Get all existing account handles (seed + manual + auto_discovered)
    2. Count appearances of each non-tracked author_handle in quality tweets
    3. Score by: appearance count * average quality score
    4. Return top N suggestions

    Returns:
    [
        {
            "handle": str,
            "appearance_count": int,
            "avg_quality_score": float,
            "discovery_score": float,
            "sample_tweets": list[str],  # Up to 3 sample tweet texts
        },
        ...
    ]
    """
    # Get existing tracked handles
    result = await db.execute(select(Account.handle))
    tracked_handles = {row[0] for row in result.all()}

    # Get all tweets with quality scores, grouped by author
    result = await db.execute(
        select(
            Tweet.author_handle,
            func.count(Tweet.id).label("count"),
            func.avg(Tweet.quality_score).label("avg_score"),
        )
        .where(Tweet.quality_score.isnot(None))
        .group_by(Tweet.author_handle)
        .having(func.count(Tweet.id) >= min_appearances)
        .order_by(func.count(Tweet.id).desc())
    )
    candidates = result.all()

    suggestions = []
    for handle, count, avg_score in candidates:
        if handle in tracked_handles:
            continue

        avg_score = avg_score or 0.0
        discovery_score = count * avg_score

        # Get sample tweets
        sample_result = await db.execute(
            select(Tweet.text)
            .where(Tweet.author_handle == handle)
            .order_by(Tweet.scraped_at.desc())
            .limit(3)
        )
        sample_tweets = [row[0] for row in sample_result.all() if row[0]]

        suggestions.append({
            "handle": handle,
            "appearance_count": count,
            "avg_quality_score": round(float(avg_score), 3),
            "discovery_score": round(float(discovery_score), 3),
            "sample_tweets": sample_tweets,
        })

    # Sort by discovery score, return top N
    suggestions.sort(key=lambda s: s["discovery_score"], reverse=True)
    return suggestions[:max_suggestions]


async def approve_discovery(db: AsyncSession, handle: str, priority: int = 3) -> Account:
    """
    Approve a discovered account and add it to the tracked accounts.
    """
    account = Account(
        handle=handle,
        source=AccountSource.AUTO_DISCOVERED,
        priority=priority,
        is_active=True,
    )
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return account


async def reject_discovery(db: AsyncSession, handle: str) -> Account:
    """
    Reject a discovered account by adding it to blocklist.
    """
    account = Account(
        handle=handle,
        source=AccountSource.AUTO_DISCOVERED,
        priority=1,
        is_active=False,
        is_blocked=True,
    )
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return account
