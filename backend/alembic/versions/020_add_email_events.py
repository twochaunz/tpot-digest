"""Add email_events table for analytics tracking

Revision ID: 020
Revises: 019
"""

import sqlalchemy as sa
from alembic import op

revision = "020"
down_revision = "019"


def upgrade() -> None:
    op.create_table(
        "email_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("send_log_id", sa.Integer(), sa.ForeignKey("digest_send_logs.id"), nullable=True),
        sa.Column("draft_id", sa.Integer(), sa.ForeignKey("digest_drafts.id"), nullable=True),
        sa.Column("subscriber_id", sa.Integer(), sa.ForeignKey("subscribers.id"), nullable=True),
        sa.Column("event_type", sa.String(32), nullable=False),
        sa.Column("link_url", sa.Text(), nullable=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("event_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("svix_id", sa.String(128), unique=True, nullable=False),
    )
    op.create_index("ix_email_events_draft_type", "email_events", ["draft_id", "event_type"])
    op.create_index("ix_email_events_subscriber_type", "email_events", ["subscriber_id", "event_type"])


def downgrade() -> None:
    op.drop_index("ix_email_events_subscriber_type", table_name="email_events")
    op.drop_index("ix_email_events_draft_type", table_name="email_events")
    op.drop_table("email_events")
