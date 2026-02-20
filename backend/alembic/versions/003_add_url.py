"""add url column to tweets

Revision ID: 003_url
Revises: 002_memo
Create Date: 2026-02-20
"""
from alembic import op
import sqlalchemy as sa

revision = "003_url"
down_revision = "002_memo"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tweets", sa.Column("url", sa.String(512)))


def downgrade() -> None:
    op.drop_column("tweets", "url")
