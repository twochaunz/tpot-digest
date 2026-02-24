"""add og_tweet_id column to topics

Revision ID: 007_og_tweet_id
Revises: 006_grok_context
Create Date: 2026-02-23
"""
from alembic import op
import sqlalchemy as sa

revision = "007_og_tweet_id"
down_revision = "006_grok_context"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("topics", sa.Column("og_tweet_id", sa.Integer(), sa.ForeignKey("tweets.id", ondelete="SET NULL"), nullable=True))


def downgrade() -> None:
    op.drop_column("topics", "og_tweet_id")
