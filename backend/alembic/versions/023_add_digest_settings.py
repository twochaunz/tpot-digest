"""Add digest_settings table for welcome email configuration.

Revision ID: 023
Revises: 022
"""

from alembic import op
import sqlalchemy as sa

revision = "023"
down_revision = "022"


def upgrade() -> None:
    op.create_table(
        "digest_settings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("welcome_send_mode", sa.String(16), nullable=False, server_default="off"),
        sa.Column("welcome_subject", sa.String(255), nullable=False, server_default="no little piggies allowed"),
        sa.Column("welcome_message", sa.Text, nullable=False, server_default=(
            "thanks for subscribing! here's the most recent abridged piece that went out. "
            "feel free to share any feedback that would help your experience \U0001f600"
        )),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("digest_settings")
