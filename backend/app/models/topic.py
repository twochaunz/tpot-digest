import enum
from datetime import date, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import Date, DateTime, Enum, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class LifecycleStatus(str, enum.Enum):
    EMERGING = "emerging"
    TRENDING = "trending"
    PEAKED = "peaked"
    FADING = "fading"


class Topic(Base):
    __tablename__ = "topics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    title: Mapped[str] = mapped_column(String(512))
    summary: Mapped[str | None] = mapped_column(Text)
    rank: Mapped[int] = mapped_column(Integer, default=0)
    lifecycle_status: Mapped[LifecycleStatus] = mapped_column(
        Enum(LifecycleStatus), default=LifecycleStatus.EMERGING
    )
    sentiment: Mapped[str | None] = mapped_column(String(32))
    tags: Mapped[dict | None] = mapped_column(JSONB)
    embedding: Mapped[list | None] = mapped_column(Vector(1536))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    subtopics = relationship("SubTopic", back_populates="topic", lazy="selectin")


class SubTopic(Base):
    __tablename__ = "subtopics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    topic_id: Mapped[int] = mapped_column(ForeignKey("topics.id"), index=True)
    title: Mapped[str] = mapped_column(String(512))
    summary: Mapped[str | None] = mapped_column(Text)
    sentiment: Mapped[str | None] = mapped_column(String(32))
    rank: Mapped[int] = mapped_column(Integer, default=0)

    topic = relationship("Topic", back_populates="subtopics")
    tweets = relationship("SubTopicTweet", back_populates="subtopic", lazy="selectin")


class SubTopicTweet(Base):
    __tablename__ = "subtopic_tweets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subtopic_id: Mapped[int] = mapped_column(ForeignKey("subtopics.id"), index=True)
    tweet_id: Mapped[int] = mapped_column(ForeignKey("tweets.id"), index=True)
    relevance_score: Mapped[float] = mapped_column(Float, default=0.0)
    stance: Mapped[str | None] = mapped_column(String(64))

    subtopic = relationship("SubTopic", back_populates="tweets")
    tweet = relationship("Tweet")


class TopicEdge(Base):
    __tablename__ = "topic_edges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_topic_id: Mapped[int] = mapped_column(ForeignKey("topics.id"), index=True)
    target_topic_id: Mapped[int] = mapped_column(ForeignKey("topics.id"), index=True)
    relationship_type: Mapped[str] = mapped_column(String(64))
    strength: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
