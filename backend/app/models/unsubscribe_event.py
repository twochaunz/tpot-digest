from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class UnsubscribeEvent(Base):
    __tablename__ = "unsubscribe_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subscriber_id: Mapped[int] = mapped_column(Integer, ForeignKey("subscribers.id"), index=True)
    # No FK to digest_drafts — we store the value as-is so unsubscribe never fails
    # even if the draft has been deleted or the param is invalid
    draft_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    unsubscribed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
