"""Add ai_new_topic_title column to tweets."""

from alembic import op
import sqlalchemy as sa

revision = "014_ai_new_topic_title"
down_revision = "013_ai_classification"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tweets", sa.Column("ai_new_topic_title", sa.String(512), nullable=True))


def downgrade() -> None:
    op.drop_column("tweets", "ai_new_topic_title")
