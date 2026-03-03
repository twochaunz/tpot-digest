"""Add subscribers and digest_drafts tables, drop waitlist."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "015_subscribers_digest"
down_revision = "014_ai_new_topic_title"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create subscribers table
    op.create_table(
        "subscribers",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(320), unique=True, index=True, nullable=False),
        sa.Column("cookie_token", sa.String(64), unique=True, index=True, nullable=False),
        sa.Column("unsubscribe_token", sa.String(64), unique=True, index=True, nullable=False),
        sa.Column("confirmation_token", sa.String(64), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("unsubscribed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("subscribed_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Migrate existing waitlist emails to subscribers if waitlist table exists
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "waitlist" in inspector.get_table_names():
        conn.execute(sa.text("""
            INSERT INTO subscribers (email, cookie_token, unsubscribe_token, subscribed_at)
            SELECT email,
                   encode(gen_random_bytes(32), 'hex'),
                   encode(gen_random_bytes(32), 'hex'),
                   created_at
            FROM waitlist
            ON CONFLICT (email) DO NOTHING
        """))
        op.drop_table("waitlist")

    # Create digest_drafts table
    op.create_table(
        "digest_drafts",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("date", sa.Date, index=True, nullable=False),
        sa.Column("topic_ids", JSONB, server_default="[]"),
        sa.Column("topic_notes", JSONB, nullable=True),
        sa.Column("intro_text", sa.Text, nullable=True),
        sa.Column("status", sa.String(32), server_default="draft", nullable=False),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("recipient_count", sa.Integer, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("digest_drafts")

    # Recreate waitlist from subscribers
    op.create_table(
        "waitlist",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(320), unique=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    conn = op.get_bind()
    conn.execute(sa.text("""
        INSERT INTO waitlist (email, created_at)
        SELECT email, subscribed_at FROM subscribers
    """))

    op.drop_table("subscribers")
