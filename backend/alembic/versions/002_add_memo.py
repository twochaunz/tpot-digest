"""add memo column to tweets

Revision ID: 002_memo
Revises: 001_v2
Create Date: 2026-02-20
"""
from alembic import op
import sqlalchemy as sa

revision = "002_memo"
down_revision = "001_v2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tweets", sa.Column("memo", sa.Text()))


def downgrade() -> None:
    op.drop_column("tweets", "memo")
