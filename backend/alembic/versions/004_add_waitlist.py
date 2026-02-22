"""add waitlist table

Revision ID: 004_waitlist
Revises: 003_url
Create Date: 2026-02-22
"""
from alembic import op
import sqlalchemy as sa

revision = "004_waitlist"
down_revision = "003_url"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "waitlist",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(320), unique=True, index=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("waitlist")
