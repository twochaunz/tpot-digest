"""Add article_title column to tweets.

Revision ID: 021
Revises: 020
"""

from alembic import op
import sqlalchemy as sa

revision = "021"
down_revision = "020"


def upgrade() -> None:
    op.add_column("tweets", sa.Column("article_title", sa.String(1024), nullable=True))


def downgrade() -> None:
    op.drop_column("tweets", "article_title")
