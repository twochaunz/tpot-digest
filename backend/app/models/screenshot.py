from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Screenshot(Base):
    __tablename__ = "screenshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tweet_id: Mapped[int | None] = mapped_column(ForeignKey("tweets.id"))
    article_id: Mapped[int | None] = mapped_column(ForeignKey("articles.id"))
    file_path: Mapped[str] = mapped_column(String(1024))
    annotated_file_path: Mapped[str | None] = mapped_column(String(1024))
    annotations_json: Mapped[dict | None] = mapped_column(JSONB)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    captured_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    tweet = relationship("Tweet", back_populates="screenshots")
