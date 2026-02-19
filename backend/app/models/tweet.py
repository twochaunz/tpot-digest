from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Tweet(Base):
    __tablename__ = "tweets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tweet_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    author_handle: Mapped[str] = mapped_column(String(255), index=True)
    text: Mapped[str] = mapped_column(Text)
    media_urls: Mapped[dict | None] = mapped_column(JSONB)
    article_urls: Mapped[dict | None] = mapped_column(JSONB)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime)
    scraped_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    engagement: Mapped[dict | None] = mapped_column(JSONB)
    engagement_velocity: Mapped[float | None] = mapped_column()
    is_retweet: Mapped[bool] = mapped_column(default=False)
    is_quote_tweet: Mapped[bool] = mapped_column(default=False)
    quoted_tweet_id: Mapped[str | None] = mapped_column(String(64))
    quality_score: Mapped[float | None] = mapped_column()
    feed_source: Mapped[str | None] = mapped_column(String(32))

    account = relationship("Account", lazy="selectin")
    screenshots = relationship("Screenshot", back_populates="tweet", lazy="selectin")


class EngagementSnapshot(Base):
    __tablename__ = "engagement_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tweet_id: Mapped[int] = mapped_column(ForeignKey("tweets.id"), index=True)
    likes: Mapped[int] = mapped_column(BigInteger, default=0)
    retweets: Mapped[int] = mapped_column(BigInteger, default=0)
    replies: Mapped[int] = mapped_column(BigInteger, default=0)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
