"""initial schema

Revision ID: a80a80d4d5c0
Revises:
Create Date: 2026-02-19 14:39:51.079277

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from pgvector.sqlalchemy import Vector


# revision identifiers, used by Alembic.
revision: str = 'a80a80d4d5c0'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Enable pgvector extension
    op.execute('CREATE EXTENSION IF NOT EXISTS vector')

    # accounts
    op.create_table(
        'accounts',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('handle', sa.String(255), nullable=False),
        sa.Column('display_name', sa.String(255), nullable=True),
        sa.Column('pfp_url', sa.String(2048), nullable=True),
        sa.Column('source', sa.Enum('seed', 'auto_discovered', 'manual', name='accountsource'), nullable=False),
        sa.Column('priority', sa.Integer(), nullable=False, server_default='2'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('is_blocked', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('is_boosted', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('follower_count', sa.Integer(), nullable=True),
        sa.Column('frequency_cap', sa.Integer(), nullable=True),
        sa.Column('added_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_accounts_handle', 'accounts', ['handle'], unique=True)

    # tweets
    op.create_table(
        'tweets',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('tweet_id', sa.String(64), nullable=False),
        sa.Column('account_id', sa.Integer(), sa.ForeignKey('accounts.id'), nullable=True),
        sa.Column('author_handle', sa.String(255), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('media_urls', postgresql.JSONB(), nullable=True),
        sa.Column('article_urls', postgresql.JSONB(), nullable=True),
        sa.Column('posted_at', sa.DateTime(), nullable=True),
        sa.Column('scraped_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('engagement', postgresql.JSONB(), nullable=True),
        sa.Column('engagement_velocity', sa.Float(), nullable=True),
        sa.Column('is_retweet', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('is_quote_tweet', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('quoted_tweet_id', sa.String(64), nullable=True),
        sa.Column('quality_score', sa.Float(), nullable=True),
        sa.Column('feed_source', sa.String(32), nullable=True),
    )
    op.create_index('ix_tweets_tweet_id', 'tweets', ['tweet_id'], unique=True)
    op.create_index('ix_tweets_author_handle', 'tweets', ['author_handle'])

    # engagement_snapshots
    op.create_table(
        'engagement_snapshots',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('tweet_id', sa.Integer(), sa.ForeignKey('tweets.id'), nullable=False),
        sa.Column('likes', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('retweets', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('replies', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('recorded_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_engagement_snapshots_tweet_id', 'engagement_snapshots', ['tweet_id'])

    # topics
    op.create_table(
        'topics',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('title', sa.String(512), nullable=False),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('rank', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('lifecycle_status', sa.Enum('emerging', 'trending', 'peaked', 'fading', name='lifecyclestatus'), nullable=False),
        sa.Column('sentiment', sa.String(32), nullable=True),
        sa.Column('tags', postgresql.JSONB(), nullable=True),
        sa.Column('embedding', Vector(1536), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_topics_date', 'topics', ['date'])

    # subtopics
    op.create_table(
        'subtopics',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('topic_id', sa.Integer(), sa.ForeignKey('topics.id'), nullable=False),
        sa.Column('title', sa.String(512), nullable=False),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('sentiment', sa.String(32), nullable=True),
        sa.Column('rank', sa.Integer(), nullable=False, server_default='0'),
    )
    op.create_index('ix_subtopics_topic_id', 'subtopics', ['topic_id'])

    # subtopic_tweets
    op.create_table(
        'subtopic_tweets',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('subtopic_id', sa.Integer(), sa.ForeignKey('subtopics.id'), nullable=False),
        sa.Column('tweet_id', sa.Integer(), sa.ForeignKey('tweets.id'), nullable=False),
        sa.Column('relevance_score', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('stance', sa.String(64), nullable=True),
    )
    op.create_index('ix_subtopic_tweets_subtopic_id', 'subtopic_tweets', ['subtopic_id'])
    op.create_index('ix_subtopic_tweets_tweet_id', 'subtopic_tweets', ['tweet_id'])

    # topic_edges
    op.create_table(
        'topic_edges',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('source_topic_id', sa.Integer(), sa.ForeignKey('topics.id'), nullable=False),
        sa.Column('target_topic_id', sa.Integer(), sa.ForeignKey('topics.id'), nullable=False),
        sa.Column('relationship_type', sa.String(64), nullable=False),
        sa.Column('strength', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_topic_edges_source_topic_id', 'topic_edges', ['source_topic_id'])
    op.create_index('ix_topic_edges_target_topic_id', 'topic_edges', ['target_topic_id'])

    # articles
    op.create_table(
        'articles',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('tweet_id', sa.Integer(), sa.ForeignKey('tweets.id'), nullable=True),
        sa.Column('url', sa.String(2048), nullable=False),
        sa.Column('archive_url', sa.String(2048), nullable=True),
        sa.Column('title', sa.String(1024), nullable=True),
        sa.Column('author', sa.String(512), nullable=True),
        sa.Column('publication', sa.String(512), nullable=True),
        sa.Column('full_text', sa.Text(), nullable=True),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('extracted_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_articles_tweet_id', 'articles', ['tweet_id'])

    # screenshots
    op.create_table(
        'screenshots',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('tweet_id', sa.Integer(), sa.ForeignKey('tweets.id'), nullable=True),
        sa.Column('article_id', sa.Integer(), sa.ForeignKey('articles.id'), nullable=True),
        sa.Column('file_path', sa.String(1024), nullable=False),
        sa.Column('annotated_file_path', sa.String(1024), nullable=True),
        sa.Column('annotations_json', postgresql.JSONB(), nullable=True),
        sa.Column('width', sa.Integer(), nullable=True),
        sa.Column('height', sa.Integer(), nullable=True),
        sa.Column('captured_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('screenshots')
    op.drop_table('articles')
    op.drop_table('topic_edges')
    op.drop_table('subtopic_tweets')
    op.drop_table('subtopics')
    op.drop_table('topics')
    op.drop_table('engagement_snapshots')
    op.drop_table('tweets')
    op.drop_table('accounts')

    op.execute("DROP TYPE IF EXISTS lifecyclestatus")
    op.execute("DROP TYPE IF EXISTS accountsource")
    op.execute("DROP EXTENSION IF EXISTS vector")
