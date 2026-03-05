"""Add digest_send_logs table."""

from alembic import op
import sqlalchemy as sa

revision = "019"
down_revision = "018"


def upgrade():
    op.create_table(
        "digest_send_logs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("draft_id", sa.Integer, sa.ForeignKey("digest_drafts.id"), nullable=False, index=True),
        sa.Column("subscriber_id", sa.Integer, sa.ForeignKey("subscribers.id"), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("resend_message_id", sa.String(128), nullable=True),
        sa.Column("attempted_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_digest_send_logs_draft_status", "digest_send_logs", ["draft_id", "status"])


def downgrade():
    op.drop_index("ix_digest_send_logs_draft_status")
    op.drop_table("digest_send_logs")
