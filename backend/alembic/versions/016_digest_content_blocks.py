"""Replace digest_drafts intro_text/topic_ids/topic_notes with content_blocks JSONB."""

import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "016_digest_content_blocks"
down_revision = "015_subscribers_digest"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add content_blocks column
    op.add_column("digest_drafts", sa.Column("content_blocks", JSONB, server_default="[]"))

    # Migrate existing data: intro_text -> text block, topic_ids -> topic blocks with notes
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, intro_text, topic_ids, topic_notes FROM digest_drafts")
    ).fetchall()

    for row in rows:
        draft_id = row[0]
        intro_text = row[1]
        topic_ids = row[2] or []
        topic_notes = row[3] or {}

        # Parse JSON if returned as strings (depends on driver)
        if isinstance(topic_ids, str):
            topic_ids = json.loads(topic_ids)
        if isinstance(topic_notes, str):
            topic_notes = json.loads(topic_notes)

        blocks = []
        block_idx = 0

        # Intro text becomes first text block
        if intro_text:
            blocks.append({
                "id": f"block-{block_idx}",
                "type": "text",
                "content": intro_text,
            })
            block_idx += 1

        # Each topic_id becomes a topic block
        for tid in topic_ids:
            block = {
                "id": f"block-{block_idx}",
                "type": "topic",
                "topic_id": tid,
            }
            note = topic_notes.get(str(tid))
            if note:
                block["note"] = note
            blocks.append(block)
            block_idx += 1

        conn.execute(
            sa.text("UPDATE digest_drafts SET content_blocks = :blocks WHERE id = :id"),
            {"blocks": json.dumps(blocks), "id": draft_id},
        )

    # Drop old columns
    op.drop_column("digest_drafts", "intro_text")
    op.drop_column("digest_drafts", "topic_ids")
    op.drop_column("digest_drafts", "topic_notes")


def downgrade() -> None:
    # Re-add old columns
    op.add_column("digest_drafts", sa.Column("intro_text", sa.Text, nullable=True))
    op.add_column("digest_drafts", sa.Column("topic_ids", JSONB, server_default="[]"))
    op.add_column("digest_drafts", sa.Column("topic_notes", JSONB, nullable=True))

    # Migrate content_blocks back
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, content_blocks FROM digest_drafts")
    ).fetchall()

    for row in rows:
        draft_id = row[0]
        blocks = row[1] or []
        if isinstance(blocks, str):
            blocks = json.loads(blocks)

        intro_text = None
        topic_ids = []
        topic_notes = {}

        for block in blocks:
            if block.get("type") == "text" and intro_text is None:
                intro_text = block.get("content")
            elif block.get("type") == "topic" and block.get("topic_id"):
                topic_ids.append(block["topic_id"])
                if block.get("note"):
                    topic_notes[str(block["topic_id"])] = block["note"]

        conn.execute(
            sa.text(
                "UPDATE digest_drafts SET intro_text = :intro, topic_ids = :tids, topic_notes = :tnotes WHERE id = :id"
            ),
            {
                "intro": intro_text,
                "tids": json.dumps(topic_ids),
                "tnotes": json.dumps(topic_notes),
                "id": draft_id,
            },
        )

    op.drop_column("digest_drafts", "content_blocks")
