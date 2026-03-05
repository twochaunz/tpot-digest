from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class DigestSendLog(Base):
    __tablename__ = "digest_send_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    draft_id: Mapped[int] = mapped_column(Integer, ForeignKey("digest_drafts.id"), index=True)
    subscriber_id: Mapped[int] = mapped_column(Integer, ForeignKey("subscribers.id"))
    email: Mapped[str] = mapped_column(String(320))
    status: Mapped[str] = mapped_column(String(16))  # 'sent' or 'failed'
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    resend_message_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    attempted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
