from sqlalchemy import ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TweetAssignment(Base):
    __tablename__ = "tweet_assignments"
    __table_args__ = (UniqueConstraint("tweet_id", "topic_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tweet_id: Mapped[int] = mapped_column(ForeignKey("tweets.id", ondelete="CASCADE"), index=True)
    topic_id: Mapped[int] = mapped_column(ForeignKey("topics.id", ondelete="CASCADE"), index=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"))

    def __repr__(self) -> str:
        return f"<TweetAssignment id={self.id} tweet_id={self.tweet_id} topic_id={self.topic_id}>"
