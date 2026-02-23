"""add grok_context column to tweets

Revision ID: 006_grok_context
Revises: 005_x_api_fields
Create Date: 2026-02-22
"""
from alembic import op
import sqlalchemy as sa

revision = "006_grok_context"
down_revision = "005_x_api_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tweets", sa.Column("grok_context", sa.Text()))


def downgrade() -> None:
    op.drop_column("tweets", "grok_context")
