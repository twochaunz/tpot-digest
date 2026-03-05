"""Add subject column to digest_drafts."""

from alembic import op
import sqlalchemy as sa

revision = "018"
down_revision = "017"


def upgrade():
    op.add_column("digest_drafts", sa.Column("subject", sa.String(255), nullable=True))


def downgrade():
    op.drop_column("digest_drafts", "subject")
