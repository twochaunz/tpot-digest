import os

# app.config refuses to import without DATABASE_URL. The test modules build
# their own in-memory SQLite engines and override get_db, so the value only
# needs to be a syntactically valid URL; no connection is ever made to it.
os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://tpot:test-only@localhost:5432/tpot_digest_test"
)
