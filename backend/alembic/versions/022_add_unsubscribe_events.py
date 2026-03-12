"""Add unsubscribe_events table with backfill.

Revision ID: 022
Revises: 021
"""

from alembic import op
import sqlalchemy as sa

revision = "022"
down_revision = "021"


def upgrade() -> None:
    op.create_table(
        "unsubscribe_events",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("subscriber_id", sa.Integer, sa.ForeignKey("subscribers.id"), nullable=False, index=True),
        sa.Column("draft_id", sa.Integer, nullable=True, index=True),
        sa.Column("unsubscribed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    # Backfill: create events for existing unsubscribed subscribers (draft_id unknown)
    op.execute(
        "INSERT INTO unsubscribe_events (subscriber_id, draft_id, unsubscribed_at) "
        "SELECT id, NULL, unsubscribed_at FROM subscribers WHERE unsubscribed_at IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_table("unsubscribe_events")
