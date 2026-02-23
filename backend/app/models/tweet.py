from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Tweet(Base):
    __tablename__ = "tweets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tweet_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    author_handle: Mapped[str] = mapped_column(String(256))
    author_display_name: Mapped[str | None] = mapped_column(String(512))
    text: Mapped[str] = mapped_column(Text, default="", server_default="")
    media_urls: Mapped[dict | None] = mapped_column(JSONB)
    engagement: Mapped[dict | None] = mapped_column(JSONB)
    is_quote_tweet: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    is_reply: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    quoted_tweet_id: Mapped[str | None] = mapped_column(String(64))
    reply_to_tweet_id: Mapped[str | None] = mapped_column(String(64))
    reply_to_handle: Mapped[str | None] = mapped_column(String(256))
    thread_id: Mapped[str | None] = mapped_column(String(64), index=True)
    thread_position: Mapped[int | None] = mapped_column(Integer)
    screenshot_path: Mapped[str | None] = mapped_column(String(512))
    feed_source: Mapped[str | None] = mapped_column(String(32))
    url: Mapped[str | None] = mapped_column(String(512))
    memo: Mapped[str | None] = mapped_column(Text)
    grok_context: Mapped[str | None] = mapped_column(Text)
    author_avatar_url: Mapped[str | None] = mapped_column(String(1024))
    author_verified: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self) -> str:
        return f"<Tweet id={self.id} tweet_id={self.tweet_id!r}>"
