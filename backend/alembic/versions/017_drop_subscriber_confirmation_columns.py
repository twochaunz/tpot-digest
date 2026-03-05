"""Drop confirmation_token, confirmed_at, cookie_token from subscribers.

Single opt-in with popup on every visit -- no confirmation email, no cookie tracking.
"""

from alembic import op

revision = "017"
down_revision = "016_digest_content_blocks"


def upgrade():
    op.drop_column("subscribers", "confirmation_token")
    op.drop_column("subscribers", "confirmed_at")
    op.drop_column("subscribers", "cookie_token")


def downgrade():
    import sqlalchemy as sa

    op.add_column("subscribers", sa.Column("cookie_token", sa.String(64), unique=True, nullable=True))
    op.add_column("subscribers", sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("subscribers", sa.Column("confirmation_token", sa.String(64), nullable=True))
