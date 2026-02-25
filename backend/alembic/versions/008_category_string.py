"""Replace category_id FK with category string

Revision ID: 008
Revises: 007_og_tweet_id
"""
from alembic import op
import sqlalchemy as sa

revision = "008_category_string"
down_revision = "007_og_tweet_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add category string column
    op.add_column("tweet_assignments", sa.Column("category", sa.String(64), nullable=True))

    # 2. Copy category names from categories table
    op.execute("""
        UPDATE tweet_assignments
        SET category = (SELECT name FROM categories WHERE categories.id = tweet_assignments.category_id)
        WHERE category_id IS NOT NULL
    """)

    # 3. Drop category_id FK column
    op.drop_constraint("tweet_assignments_category_id_fkey", "tweet_assignments", type_="foreignkey")
    op.drop_column("tweet_assignments", "category_id")

    # 4. Drop categories table
    op.drop_table("categories")


def downgrade() -> None:
    # Recreate categories table
    op.create_table(
        "categories",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(128), unique=True),
        sa.Column("color", sa.String(7)),
        sa.Column("position", sa.Integer, default=0),
    )
    # Add back category_id column
    op.add_column("tweet_assignments", sa.Column("category_id", sa.Integer, sa.ForeignKey("categories.id", ondelete="SET NULL")))
    # Drop category string column
    op.drop_column("tweet_assignments", "category")
