"""Add pgvector extension, embedding columns, and AI classification fields.

Revision ID: 013_ai_classification
Revises: 012_assignment_composite_idx
Create Date: 2026-02-27
"""

from alembic import op
import sqlalchemy as sa

revision = "013_ai_classification"
down_revision = "012_assignment_composite_idx"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enable pgvector extension
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # Add embedding columns using raw SQL (Alembic doesn't know vector type)
    op.execute("ALTER TABLE tweets ADD COLUMN embedding vector(384)")
    op.execute("ALTER TABLE topics ADD COLUMN embedding vector(384)")

    # Add AI classification columns to tweets
    op.add_column("tweets", sa.Column("ai_topic_id", sa.Integer(), sa.ForeignKey("topics.id", ondelete="SET NULL"), nullable=True))
    op.add_column("tweets", sa.Column("ai_category", sa.String(64), nullable=True))
    op.add_column("tweets", sa.Column("ai_related_topic_id", sa.Integer(), sa.ForeignKey("topics.id", ondelete="SET NULL"), nullable=True))
    op.add_column("tweets", sa.Column("ai_override", sa.Boolean(), server_default="false", nullable=False))

    # IVFFlat index for cosine similarity search on topic embeddings
    op.execute(
        "CREATE INDEX idx_topics_embedding ON topics "
        "USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_topics_embedding")

    op.drop_column("tweets", "ai_override")
    op.drop_column("tweets", "ai_related_topic_id")
    op.drop_column("tweets", "ai_category")
    op.drop_column("tweets", "ai_topic_id")

    op.execute("ALTER TABLE topics DROP COLUMN IF EXISTS embedding")
    op.execute("ALTER TABLE tweets DROP COLUMN IF EXISTS embedding")

    # Don't drop the vector extension -- other things might use it
