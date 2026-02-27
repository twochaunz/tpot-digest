"""Add composite index on tweet_assignments(tweet_id, topic_id) for faster lookups."""

from alembic import op

revision = "012_assignment_composite_idx"
down_revision = "011_saved_at_index"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_tweet_assignments_tweet_topic",
        "tweet_assignments",
        ["tweet_id", "topic_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_tweet_assignments_tweet_topic", table_name="tweet_assignments")
