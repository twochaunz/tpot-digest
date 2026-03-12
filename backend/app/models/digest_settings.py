"""Single-row table for digest-level configuration."""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

DEFAULT_WELCOME_MESSAGE = (
    "thanks for subscribing! here's the most recent abridged piece that went out. "
    "feel free to share any feedback that would help your experience \U0001f600"
)


class DigestSettings(Base):
    __tablename__ = "digest_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    welcome_send_mode: Mapped[str] = mapped_column(String(16), default="off")
    welcome_subject: Mapped[str] = mapped_column(String(255), default="no little piggies allowed")
    welcome_message: Mapped[str] = mapped_column(Text, default=DEFAULT_WELCOME_MESSAGE)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
