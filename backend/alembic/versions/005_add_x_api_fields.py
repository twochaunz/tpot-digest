"""add x api fields to tweets

Revision ID: 005_x_api_fields
Revises: 004_waitlist
Create Date: 2026-02-22
"""
from alembic import op
import sqlalchemy as sa

revision = "005_x_api_fields"
down_revision = "004_waitlist"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tweets", sa.Column("author_avatar_url", sa.String(1024)))
    op.add_column("tweets", sa.Column("author_verified", sa.Boolean, server_default="false"))
    op.add_column("tweets", sa.Column("created_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("tweets", "created_at")
    op.drop_column("tweets", "author_verified")
    op.drop_column("tweets", "author_avatar_url")
