"""Add lang and translated_text columns to tweets.

Revision ID: 024
Revises: 023
"""

from alembic import op
import sqlalchemy as sa

revision = "024"
down_revision = "023"


def upgrade() -> None:
    op.add_column("tweets", sa.Column("lang", sa.String(16), nullable=True))
    op.add_column("tweets", sa.Column("translated_text", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("tweets", "translated_text")
    op.drop_column("tweets", "lang")
