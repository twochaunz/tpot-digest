from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class EmailEvent(Base):
    __tablename__ = "email_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    send_log_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("digest_send_logs.id"), nullable=True
    )
    draft_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("digest_drafts.id"), nullable=True
    )
    subscriber_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("subscribers.id"), nullable=True
    )
    event_type: Mapped[str] = mapped_column(String(32))
    link_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    event_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    svix_id: Mapped[str] = mapped_column(String(128), unique=True)

    __table_args__ = (
        Index("ix_email_events_draft_type", "draft_id", "event_type"),
        Index("ix_email_events_subscriber_type", "subscriber_id", "event_type"),
    )
