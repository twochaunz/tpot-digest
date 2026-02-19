from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Article(Base):
    __tablename__ = "articles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tweet_id: Mapped[int | None] = mapped_column(ForeignKey("tweets.id"), index=True)
    url: Mapped[str] = mapped_column(String(2048))
    archive_url: Mapped[str | None] = mapped_column(String(2048))
    title: Mapped[str | None] = mapped_column(String(1024))
    author: Mapped[str | None] = mapped_column(String(512))
    publication: Mapped[str | None] = mapped_column(String(512))
    full_text: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text)
    extracted_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
