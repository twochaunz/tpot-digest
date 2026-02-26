"""Add index on tweets.saved_at for date range queries."""

from alembic import op

revision = "011_saved_at_index"
down_revision = "010_topic_scripts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_tweets_saved_at", "tweets", ["saved_at"])


def downgrade() -> None:
    op.drop_index("ix_tweets_saved_at", table_name="tweets")
