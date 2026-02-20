"""v2 schema: tweets, topics, categories, assignments

Revision ID: 001_v2
Revises:
Create Date: 2026-02-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "001_v2"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tweets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tweet_id", sa.String(64), unique=True, index=True, nullable=False),
        sa.Column("author_handle", sa.String(256), nullable=False),
        sa.Column("author_display_name", sa.String(512)),
        sa.Column("text", sa.Text(), server_default=""),
        sa.Column("media_urls", postgresql.JSONB()),
        sa.Column("engagement", postgresql.JSONB()),
        sa.Column("is_quote_tweet", sa.Boolean(), server_default="false"),
        sa.Column("is_reply", sa.Boolean(), server_default="false"),
        sa.Column("quoted_tweet_id", sa.String(64)),
        sa.Column("reply_to_tweet_id", sa.String(64)),
        sa.Column("reply_to_handle", sa.String(256)),
        sa.Column("thread_id", sa.String(64), index=True),
        sa.Column("thread_position", sa.Integer()),
        sa.Column("screenshot_path", sa.String(512)),
        sa.Column("feed_source", sa.String(32)),
        sa.Column("saved_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "topics",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("date", sa.Date(), index=True, nullable=False),
        sa.Column("color", sa.String(7)),
        sa.Column("position", sa.Integer(), server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(128), unique=True, nullable=False),
        sa.Column("color", sa.String(7)),
        sa.Column("position", sa.Integer(), server_default="0"),
    )

    op.create_table(
        "tweet_assignments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tweet_id", sa.Integer(), sa.ForeignKey("tweets.id", ondelete="CASCADE"), index=True, nullable=False),
        sa.Column("topic_id", sa.Integer(), sa.ForeignKey("topics.id", ondelete="CASCADE"), index=True, nullable=False),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("categories.id", ondelete="SET NULL")),
        sa.UniqueConstraint("tweet_id", "topic_id"),
    )

    # Seed default categories
    op.execute("INSERT INTO categories (name, color, position) VALUES ('commentary', '#4ECDC4', 0)")
    op.execute("INSERT INTO categories (name, color, position) VALUES ('reaction', '#FF6B6B', 1)")
    op.execute("INSERT INTO categories (name, color, position) VALUES ('callout', '#FFE66D', 2)")


def downgrade() -> None:
    op.drop_table("tweet_assignments")
    op.drop_table("categories")
    op.drop_table("topics")
    op.drop_table("tweets")
