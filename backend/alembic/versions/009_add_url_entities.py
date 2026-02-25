"""Add url_entities JSONB column to tweets

Revision ID: 009
Revises: 008_category_string
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "009_url_entities"
down_revision = "008_category_string"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tweets", sa.Column("url_entities", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("tweets", "url_entities")
