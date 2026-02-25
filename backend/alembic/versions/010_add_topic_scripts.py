"""Add topic_scripts table."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "010_topic_scripts"
down_revision = "009_url_entities"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "topic_scripts",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("topic_id", sa.Integer, sa.ForeignKey("topics.id", ondelete="CASCADE"), index=True, nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("model_used", sa.String(128), nullable=False),
        sa.Column("content", JSONB, nullable=False),
        sa.Column("feedback", sa.Text, nullable=True),
        sa.Column("is_active", sa.Boolean, server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("topic_scripts")
