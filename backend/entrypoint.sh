#!/bin/sh
set -e

# If tables exist but alembic hasn't been initialized, stamp to the
# pre-existing schema version so upgrade only runs new migrations.
python -c "
import asyncio
from sqlalchemy import text
from app.db import engine

async def check():
    async with engine.connect() as conn:
        # Check if alembic_version table exists
        r = await conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='alembic_version')\"
        ))
        has_alembic = r.scalar()

        if has_alembic:
            return  # alembic already initialized, nothing to do

        # Check if tweets table exists (i.e. DB was created without alembic)
        r = await conn.execute(text(
            \"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='tweets')\"
        ))
        has_tables = r.scalar()

        if has_tables:
            # Figure out what version the DB is at by checking columns
            r = await conn.execute(text(
                \"SELECT column_name FROM information_schema.columns WHERE table_name='tweets'\"
            ))
            cols = {row[0] for row in r}

            if 'grok_context' in cols:
                version = '006_grok_context'
            elif 'author_avatar_url' in cols:
                version = '005_x_api_fields'
            elif 'url' in cols:
                version = '003_url'
            elif 'memo' in cols:
                version = '002_memo'
            else:
                version = '001_v2'

            # Check for og_tweet_id on topics
            r = await conn.execute(text(
                \"SELECT column_name FROM information_schema.columns WHERE table_name='topics' AND column_name='og_tweet_id'\"
            ))
            if r.fetchone():
                version = '007_og_tweet_id'

            print(f'Stamping existing DB at {version}')
            # Create alembic_version table and stamp
            await conn.execute(text('CREATE TABLE IF NOT EXISTS alembic_version (version_num VARCHAR(32) NOT NULL)'))
            await conn.execute(text(f\"INSERT INTO alembic_version (version_num) VALUES ('{version}')\"))
            await conn.commit()

asyncio.run(check())
"

# Run pending migrations
python -m alembic upgrade head

# Start the application
exec "$@"
