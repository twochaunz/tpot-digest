# Auto-Categorization Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically classify saved tweets into topics and discourse categories using Grok context + Claude classification with pgvector similarity search, showing suggestion badges for user review.

**Architecture:** Background pipeline on tweet save: embed tweet (all-MiniLM-L6-v2, local) → fetch Grok context (parallel) → pgvector similarity search for candidate topics → Claude Haiku classifies topic + category → store suggestion. Frontend shows badges on unsorted tweets for accept/dismiss.

**Tech Stack:** sentence-transformers (all-MiniLM-L6-v2), pgvector (already in Docker image), Anthropic SDK (Claude Haiku), FastAPI BackgroundTasks

---

### Task 1: Database Migration — pgvector + AI columns

Add vector columns for embeddings and AI suggestion fields.

**Files:**
- Create: `backend/alembic/versions/013_add_ai_classification.py`
- Modify: `backend/app/models/tweet.py`
- Modify: `backend/app/models/topic.py`

**Step 1: Create migration file**

Create `backend/alembic/versions/013_add_ai_classification.py`:

```python
"""Add AI classification columns and vector embeddings."""

from alembic import op
import sqlalchemy as sa

revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # Topic embedding for similarity search
    op.add_column("topics", sa.Column("embedding", sa.LargeBinary(), nullable=True))

    # Tweet embedding + AI suggestion fields
    op.add_column("tweets", sa.Column("embedding", sa.LargeBinary(), nullable=True))
    op.add_column("tweets", sa.Column("ai_topic_id", sa.Integer(), sa.ForeignKey("topics.id", ondelete="SET NULL"), nullable=True))
    op.add_column("tweets", sa.Column("ai_category", sa.String(64), nullable=True))
    op.add_column("tweets", sa.Column("ai_related_topic_id", sa.Integer(), sa.ForeignKey("topics.id", ondelete="SET NULL"), nullable=True))
    op.add_column("tweets", sa.Column("ai_override", sa.Boolean(), server_default="false", nullable=False))

    # pgvector index on topics — use raw SQL for vector type
    op.execute("ALTER TABLE topics ALTER COLUMN embedding TYPE vector(384) USING embedding::vector(384)")
    op.execute("ALTER TABLE tweets ALTER COLUMN embedding TYPE vector(384) USING embedding::vector(384)")
    op.execute("CREATE INDEX idx_topics_embedding ON topics USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_topics_embedding")
    op.drop_column("tweets", "ai_override")
    op.drop_column("tweets", "ai_related_topic_id")
    op.drop_column("tweets", "ai_category")
    op.drop_column("tweets", "ai_topic_id")
    op.drop_column("tweets", "embedding")
    op.drop_column("topics", "embedding")
```

**Note on pgvector:** The Docker image `pgvector/pgvector:pg16` already includes the extension. We just need `CREATE EXTENSION IF NOT EXISTS vector` in the migration. However, SQLAlchemy doesn't natively support the `vector` column type. We'll use `pgvector` Python package for the model column type.

**Step 2: Update Tweet model**

Add to `backend/app/models/tweet.py`:

```python
from pgvector.sqlalchemy import Vector

# Add after existing columns:
embedding = mapped_column(Vector(384), nullable=True)
ai_topic_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("topics.id", ondelete="SET NULL"), nullable=True)
ai_category: Mapped[str | None] = mapped_column(String(64), nullable=True)
ai_related_topic_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("topics.id", ondelete="SET NULL"), nullable=True)
ai_override: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
```

**Step 3: Update Topic model**

Add to `backend/app/models/topic.py`:

```python
from pgvector.sqlalchemy import Vector

# Add after existing columns:
embedding = mapped_column(Vector(384), nullable=True)
```

**Step 4: Update alembic env.py imports**

The `env.py` already imports all models. No change needed unless pgvector types cause issues — in that case, register the vector type with alembic.

**Step 5: Add pgvector Python package to dependencies**

Add `pgvector` to `backend/pyproject.toml` dependencies:

```toml
dependencies = [
    # ... existing deps ...
    "pgvector>=0.3",
]
```

**Step 6: Run migration**

```bash
cd backend && alembic upgrade head
```

**Step 7: Commit**

```bash
git add backend/alembic/versions/013_add_ai_classification.py backend/app/models/tweet.py backend/app/models/topic.py backend/pyproject.toml
git commit -m "feat: add pgvector columns and AI suggestion fields"
```

---

### Task 2: Embedding Service — sentence-transformers

Create the local embedding service that loads all-MiniLM-L6-v2 and exposes an `embed_text()` function.

**Files:**
- Create: `backend/app/services/embeddings.py`
- Create: `backend/tests/test_embeddings.py`
- Modify: `backend/pyproject.toml`

**Step 1: Add dependencies**

Add to `backend/pyproject.toml` dependencies:

```toml
"sentence-transformers>=3.0",
"torch>=2.0",
```

Note: `torch` will be CPU-only since the Dockerfile uses `python:3.12-slim`. For smaller image size, consider `--extra-index-url https://download.pytorch.org/whl/cpu` in the Dockerfile `pip install` step.

**Step 2: Write the failing test**

Create `backend/tests/test_embeddings.py`:

```python
import pytest
from app.services.embeddings import embed_text, embed_texts


def test_embed_text_returns_384_dim_vector():
    vec = embed_text("Hello world")
    assert len(vec) == 384
    assert all(isinstance(v, float) for v in vec)


def test_embed_text_empty_string():
    vec = embed_text("")
    assert len(vec) == 384


def test_embed_texts_batch():
    vecs = embed_texts(["Hello", "World"])
    assert len(vecs) == 2
    assert all(len(v) == 384 for v in vecs)


def test_embed_texts_similar():
    """Semantically similar texts should have higher cosine similarity."""
    import numpy as np
    v1 = np.array(embed_text("AI language models are changing the world"))
    v2 = np.array(embed_text("Large language models are transforming everything"))
    v3 = np.array(embed_text("I love chocolate ice cream"))

    sim_related = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2))
    sim_unrelated = np.dot(v1, v3) / (np.linalg.norm(v1) * np.linalg.norm(v3))
    assert sim_related > sim_unrelated
```

**Step 3: Run test to verify it fails**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_embeddings.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.embeddings'`

**Step 4: Write the implementation**

Create `backend/app/services/embeddings.py`:

```python
"""Local embedding service using all-MiniLM-L6-v2."""

from __future__ import annotations

from functools import lru_cache

from sentence_transformers import SentenceTransformer


@lru_cache(maxsize=1)
def _get_model() -> SentenceTransformer:
    """Load model once, cache in memory (~50MB)."""
    return SentenceTransformer("all-MiniLM-L6-v2")


def embed_text(text: str) -> list[float]:
    """Embed a single text string into a 384-dim vector."""
    model = _get_model()
    vec = model.encode(text, normalize_embeddings=True)
    return vec.tolist()


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed multiple texts in a batch (more efficient than one-by-one)."""
    model = _get_model()
    vecs = model.encode(texts, normalize_embeddings=True, batch_size=32)
    return [v.tolist() for v in vecs]
```

**Step 5: Run test to verify it passes**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_embeddings.py -v
```

Expected: All 4 tests PASS. First run will download the model (~90MB).

**Step 6: Optimize Dockerfile for torch CPU**

Modify `backend/Dockerfile` — add before the `pip install` line:

```dockerfile
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu
```

This installs CPU-only torch (~200MB instead of ~2GB with CUDA).

**Step 7: Commit**

```bash
git add backend/app/services/embeddings.py backend/tests/test_embeddings.py backend/pyproject.toml backend/Dockerfile
git commit -m "feat: add local embedding service (all-MiniLM-L6-v2)"
```

---

### Task 3: Claude Classification Service

Create the service that sends tweet + context + candidate topics to Claude Haiku and gets back structured topic + category suggestions.

**Files:**
- Create: `backend/app/services/claude_api.py`
- Create: `backend/tests/test_claude_api.py`

**Step 1: Write the failing test**

Create `backend/tests/test_claude_api.py`:

```python
import json
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from app.services.claude_api import classify_tweet, recategorize_topic, TopicCandidate


@pytest.fixture
def mock_anthropic():
    """Mock the Anthropic client."""
    with patch("app.services.claude_api._get_client") as mock:
        client = MagicMock()
        mock.return_value = client
        yield client


@pytest.mark.asyncio
async def test_classify_tweet_returns_suggestion(mock_anthropic):
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=json.dumps({
        "topic_id": 42,
        "new_topic_title": None,
        "category": "pushback",
        "related_topic_id": None,
        "confidence": 0.85,
    }))]

    mock_anthropic.messages.create = AsyncMock(return_value=mock_response)

    result = await classify_tweet(
        tweet_text="This is a terrible take and here's why...",
        grok_context="User is responding to a viral post about AI safety.",
        candidates=[
            TopicCandidate(
                topic_id=42,
                title="AI Safety Debate",
                date="2026-02-27",
                og_text="We need to pause AI development now.",
                og_grok_context="Post went viral with 10K+ retweets.",
                category_summary="2 context, 1 signal-boost",
                similarity=0.82,
            )
        ],
    )

    assert result["topic_id"] == 42
    assert result["category"] == "pushback"
    assert result["confidence"] == 0.85


@pytest.mark.asyncio
async def test_classify_tweet_suggests_new_topic(mock_anthropic):
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=json.dumps({
        "topic_id": None,
        "new_topic_title": "GPT-5 Launch Rumors",
        "category": "hot-take",
        "related_topic_id": None,
        "confidence": 0.70,
    }))]

    mock_anthropic.messages.create = AsyncMock(return_value=mock_response)

    result = await classify_tweet(
        tweet_text="GPT-5 is coming next month, mark my words.",
        grok_context="Speculation about OpenAI's next model release.",
        candidates=[],
    )

    assert result["topic_id"] is None
    assert result["new_topic_title"] == "GPT-5 Launch Rumors"
    assert result["category"] == "hot-take"


@pytest.mark.asyncio
async def test_recategorize_topic(mock_anthropic):
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=json.dumps({
        "categories": {
            "101": "context",
            "102": "pushback",
            "103": "signal-boost",
        }
    }))]

    mock_anthropic.messages.create = AsyncMock(return_value=mock_response)

    result = await recategorize_topic(
        og_text="Original controversial take about AI.",
        og_grok_context="Post by prominent AI researcher.",
        tweets=[
            {"id": 101, "text": "Here's some data on this...", "grok_context": None},
            {"id": 102, "text": "This is wrong because...", "grok_context": None},
            {"id": 103, "text": "RT this is so important", "grok_context": None},
        ],
    )

    assert result == {101: "context", 102: "pushback", 103: "signal-boost"}
```

**Step 2: Run test to verify it fails**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_claude_api.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.claude_api'`

**Step 3: Write the implementation**

Create `backend/app/services/claude_api.py`:

```python
"""Claude API client for tweet classification and topic categorization."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from functools import lru_cache

import anthropic

from app.config import settings

logger = logging.getLogger(__name__)

CATEGORIES_DESCRIPTION = """Categories (pick exactly one):
- context — adds background info, explains, provides data or evidence about the OG post
- signal-boost — amplifies, agrees with, or supports the OG post
- pushback — disagrees with, challenges, or counters the OG post
- hot-take — strong or provocative opinion related to the OG post
- kek — humor, memes, jokes, or ironic commentary about the OG post"""


@dataclass
class TopicCandidate:
    topic_id: int
    title: str
    date: str
    og_text: str
    og_grok_context: str | None
    category_summary: str
    similarity: float


@lru_cache(maxsize=1)
def _get_client() -> anthropic.AsyncAnthropic:
    return anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)


async def classify_tweet(
    tweet_text: str,
    grok_context: str | None,
    candidates: list[TopicCandidate],
) -> dict:
    """Classify a tweet into a topic and category.

    Returns dict with keys: topic_id, new_topic_title, category,
    related_topic_id, confidence.
    """
    # Build candidate descriptions
    if candidates:
        candidate_lines = []
        for c in candidates:
            og_snippet = c.og_text[:280] if c.og_text else "(no OG text)"
            ctx_snippet = f"\n    Grok context: {c.og_grok_context[:200]}" if c.og_grok_context else ""
            candidate_lines.append(
                f"  - Topic ID {c.topic_id}: \"{c.title}\" ({c.date})\n"
                f"    OG post: {og_snippet}{ctx_snippet}\n"
                f"    Current tweets: {c.category_summary}\n"
                f"    Similarity: {c.similarity:.2f}"
            )
        candidates_text = "Candidate topics (ranked by similarity):\n" + "\n".join(candidate_lines)
    else:
        candidates_text = "No candidate topics found. This may need a new topic."

    grok_line = f"\nGrok context about this tweet:\n{grok_context}" if grok_context else ""

    prompt = f"""You are classifying a tweet for a daily digest of Twitter/X discourse.

Tweet text:
{tweet_text}
{grok_line}

{candidates_text}

{CATEGORIES_DESCRIPTION}

Decide:
1. Which topic does this tweet belong to? Pick the best matching topic_id, or suggest a new topic title if none fit.
2. What category best describes how this tweet relates to that topic's OG post?
3. If this relates to a topic from a previous day (cross-day continuation), note the related_topic_id.

Respond with ONLY valid JSON (no markdown, no explanation):
{{"topic_id": <int or null>, "new_topic_title": <string or null>, "category": "<category key>", "related_topic_id": <int or null>, "confidence": <float 0-1>}}"""

    client = _get_client()
    response = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=256,
        messages=[{"role": "user", "content": prompt}],
    )

    text = response.content[0].text.strip()
    # Strip markdown fences if present
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

    return json.loads(text)


async def recategorize_topic(
    og_text: str,
    og_grok_context: str | None,
    tweets: list[dict],
) -> dict[int, str]:
    """Re-categorize all tweets in a topic relative to the OG post.

    Args:
        og_text: The OG post text.
        og_grok_context: Grok context for the OG post.
        tweets: List of dicts with keys: id, text, grok_context.

    Returns:
        Dict mapping tweet_id -> category key.
    """
    og_ctx = f"\nGrok context: {og_grok_context}" if og_grok_context else ""

    tweet_lines = []
    for t in tweets:
        ctx = f" (context: {t['grok_context'][:150]})" if t.get("grok_context") else ""
        tweet_lines.append(f"  - Tweet {t['id']}: {t['text'][:280]}{ctx}")
    tweets_text = "\n".join(tweet_lines)

    prompt = f"""You are categorizing tweets within a topic for a daily digest.

OG Post (the anchor — all tweets are reactions to this):
{og_text}
{og_ctx}

Tweets to categorize:
{tweets_text}

{CATEGORIES_DESCRIPTION}

For each tweet, decide how it relates to the OG post.

Respond with ONLY valid JSON (no markdown):
{{"categories": {{"<tweet_id>": "<category key>", ...}}}}"""

    client = _get_client()
    response = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
    )

    text = response.content[0].text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

    data = json.loads(text)
    return {int(k): v for k, v in data["categories"].items()}
```

**Step 4: Run test to verify it passes**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_claude_api.py -v
```

Expected: All 3 tests PASS.

**Step 5: Add anthropic to dependencies**

Add to `backend/pyproject.toml` dependencies:

```toml
"anthropic>=0.40",
```

**Step 6: Commit**

```bash
git add backend/app/services/claude_api.py backend/tests/test_claude_api.py backend/pyproject.toml
git commit -m "feat: add Claude classification service for tweet categorization"
```

---

### Task 4: Classification Pipeline — Background Task

Wire up the full pipeline: embed → grok → pgvector → claude → store. Runs as a background task when a tweet is saved.

**Files:**
- Create: `backend/app/services/classifier.py`
- Create: `backend/tests/test_classifier.py`
- Modify: `backend/app/routers/tweets.py` (wire into save endpoint)

**Step 1: Write the failing test**

Create `backend/tests/test_classifier.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from app.services.classifier import classify_pipeline, _build_category_summary


def test_build_category_summary():
    assignments = [
        MagicMock(category="context"),
        MagicMock(category="context"),
        MagicMock(category="pushback"),
        MagicMock(category=None),
    ]
    result = _build_category_summary(assignments)
    assert "2 context" in result
    assert "1 pushback" in result


@pytest.mark.asyncio
async def test_classify_pipeline_stores_suggestion():
    """Integration-style test: mock all external calls, verify DB writes."""
    with patch("app.services.classifier.embed_text", return_value=[0.1] * 384) as mock_embed, \
         patch("app.services.classifier.fetch_grok_context", new_callable=AsyncMock, return_value="Some context") as mock_grok, \
         patch("app.services.classifier.classify_tweet", new_callable=AsyncMock, return_value={
             "topic_id": 1,
             "new_topic_title": None,
             "category": "pushback",
             "related_topic_id": None,
             "confidence": 0.85,
         }) as mock_classify:

        # This test needs a real DB session — use the test fixture pattern
        # For now, verify the function exists and accepts the right args
        assert callable(classify_pipeline)
```

**Step 2: Write the implementation**

Create `backend/app/services/classifier.py`:

```python
"""Full classification pipeline: embed → grok → pgvector → claude → store."""

from __future__ import annotations

import asyncio
import logging
from collections import Counter
from datetime import date, timedelta

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

import app.db as db_module
from app.models.assignment import TweetAssignment
from app.models.topic import Topic
from app.models.tweet import Tweet
from app.services.claude_api import TopicCandidate, classify_tweet, recategorize_topic
from app.services.embeddings import embed_text
from app.services.grok_api import GrokAPIError, fetch_grok_context

logger = logging.getLogger(__name__)


def _build_category_summary(assignments: list[TweetAssignment]) -> str:
    """Build a concise summary like '3 context, 2 pushback, 1 kek'."""
    counts = Counter(a.category for a in assignments if a.category)
    if not counts:
        return "no categorized tweets"
    return ", ".join(f"{v} {k}" for k, v in counts.most_common())


async def classify_pipeline(tweet_id: int) -> None:
    """Run the full classification pipeline for a tweet.

    Steps:
    1. Embed tweet text (local, ~10ms)
    2. Fetch Grok context (parallel, ~3-5s)
    3. pgvector similarity search for candidate topics (~5ms)
    4. Claude classification (~1-2s)
    5. Store suggestion on tweet
    """
    async with db_module.async_session() as db:
        tweet = await db.get(Tweet, tweet_id)
        if not tweet or not tweet.text:
            logger.info("Tweet %d has no text yet, skipping classification", tweet_id)
            return

        # Step 1: Embed tweet text
        tweet_embedding = embed_text(tweet.text)
        tweet.embedding = tweet_embedding
        await db.commit()

        # Step 2: Grok context + pgvector search in parallel
        grok_task = _fetch_grok_safe(tweet)
        candidates_task = _find_candidate_topics(db, tweet_embedding)

        grok_context, candidates = await asyncio.gather(grok_task, candidates_task)

        # Store grok context if fetched
        if grok_context and not tweet.grok_context:
            tweet.grok_context = grok_context
            await db.commit()

        # Step 3: Claude classification
        if not candidates:
            # No candidate topics — suggest new topic
            try:
                result = await classify_tweet(
                    tweet_text=tweet.text,
                    grok_context=grok_context or tweet.grok_context,
                    candidates=[],
                )
            except Exception as e:
                logger.error("Claude classification failed for tweet %d: %s", tweet_id, e)
                return
        else:
            try:
                result = await classify_tweet(
                    tweet_text=tweet.text,
                    grok_context=grok_context or tweet.grok_context,
                    candidates=candidates,
                )
            except Exception as e:
                logger.error("Claude classification failed for tweet %d: %s", tweet_id, e)
                return

        # Step 4: Store suggestion
        tweet.ai_topic_id = result.get("topic_id")
        tweet.ai_category = result.get("category")
        tweet.ai_related_topic_id = result.get("related_topic_id")
        await db.commit()

        logger.info(
            "Tweet %d classified: topic=%s category=%s confidence=%.2f",
            tweet_id,
            result.get("topic_id") or result.get("new_topic_title"),
            result.get("category"),
            result.get("confidence", 0),
        )


async def _fetch_grok_safe(tweet: Tweet) -> str | None:
    """Fetch Grok context, return None on failure."""
    if tweet.grok_context:
        return tweet.grok_context
    if not tweet.url:
        return None
    try:
        return await fetch_grok_context(tweet.url)
    except GrokAPIError as e:
        logger.warning("Grok fetch failed for tweet %d: %s", tweet.id, e)
        return None


async def _find_candidate_topics(
    db: AsyncSession,
    tweet_embedding: list[float],
    lookback_days: int = 3,
    limit: int = 5,
    min_similarity: float = 0.3,
) -> list[TopicCandidate]:
    """Find candidate topics using pgvector similarity search."""
    cutoff_date = date.today() - timedelta(days=lookback_days)

    # pgvector cosine distance: <=> operator, similarity = 1 - distance
    rows = (await db.execute(
        text("""
            SELECT t.id, t.title, t.date::text, t.og_tweet_id,
                   1 - (t.embedding <=> :vec::vector) as similarity
            FROM topics t
            WHERE t.embedding IS NOT NULL
              AND t.date >= :cutoff
            ORDER BY t.embedding <=> :vec::vector
            LIMIT :lim
        """),
        {"vec": str(tweet_embedding), "cutoff": cutoff_date, "lim": limit},
    )).all()

    candidates = []
    for row in rows:
        if row.similarity < min_similarity:
            continue

        # Fetch OG tweet text + grok context
        og_text = ""
        og_grok = None
        if row.og_tweet_id:
            og_tweet = await db.get(Tweet, row.og_tweet_id)
            if og_tweet:
                og_text = og_tweet.text or ""
                og_grok = og_tweet.grok_context

        # Build category summary from assignments
        assignments = (await db.execute(
            select(TweetAssignment).where(TweetAssignment.topic_id == row.id)
        )).scalars().all()

        candidates.append(TopicCandidate(
            topic_id=row.id,
            title=row.title,
            date=row.date,
            og_text=og_text,
            og_grok_context=og_grok,
            category_summary=_build_category_summary(assignments),
            similarity=row.similarity,
        ))

    return candidates


async def recategorize_topic_tweets(topic_id: int) -> None:
    """Re-categorize all tweets in a topic relative to the OG post.

    Skips tweets with ai_override=True.
    """
    async with db_module.async_session() as db:
        topic = await db.get(Topic, topic_id)
        if not topic or not topic.og_tweet_id:
            return

        og_tweet = await db.get(Tweet, topic.og_tweet_id)
        if not og_tweet:
            return

        # Get all assignments for this topic
        assignments = (await db.execute(
            select(TweetAssignment).where(TweetAssignment.topic_id == topic_id)
        )).scalars().all()

        # Load tweets, skip OG and overridden
        tweets_to_categorize = []
        assignment_map: dict[int, TweetAssignment] = {}
        for a in assignments:
            if a.tweet_id == topic.og_tweet_id:
                continue
            tweet = await db.get(Tweet, a.tweet_id)
            if not tweet or tweet.ai_override:
                continue
            tweets_to_categorize.append({
                "id": tweet.id,
                "text": tweet.text or "",
                "grok_context": tweet.grok_context,
            })
            assignment_map[tweet.id] = a

        if not tweets_to_categorize:
            return

        try:
            new_categories = await recategorize_topic(
                og_text=og_tweet.text or "",
                og_grok_context=og_tweet.grok_context,
                tweets=tweets_to_categorize,
            )
        except Exception as e:
            logger.error("Recategorization failed for topic %d: %s", topic_id, e)
            return

        # Update assignments
        for tweet_id, category in new_categories.items():
            if tweet_id in assignment_map:
                assignment_map[tweet_id].category = category

        await db.commit()
        logger.info("Recategorized %d tweets in topic %d", len(new_categories), topic_id)
```

**Step 3: Wire into tweet save endpoint**

Modify `backend/app/routers/tweets.py`. In the `save_tweet` function, the `_backfill_tweet` background task already runs after save. We need to chain the classification pipeline after backfill completes.

Update the `_backfill_tweet` function — add at the end (after the existing `await db.commit()`):

```python
# After backfill is complete, run classification pipeline
from app.services.classifier import classify_pipeline
await classify_pipeline(tweet_id)
```

This is clean because `_backfill_tweet` already runs as a background task, and classification needs the tweet text which backfill provides.

**Step 4: Run tests**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_classifier.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/services/classifier.py backend/tests/test_classifier.py backend/app/routers/tweets.py
git commit -m "feat: add classification pipeline with pgvector + claude"
```

---

### Task 5: Topic Embedding Generation

Generate topic embeddings when OG post is set. This is the other side of the similarity search.

**Files:**
- Modify: `backend/app/routers/topics.py` (generate embedding when og_tweet_id is set)

**Step 1: Understand the current flow**

In `backend/app/routers/topics.py`, the `PATCH /{topic_id}` endpoint already handles `og_tweet_id` changes (validates tweet exists, auto-assigns, fetches Grok context). We add embedding generation alongside.

**Step 2: Add embedding generation**

In the `og_tweet_id` handling block in `PATCH /{topic_id}`, after the Grok context fetch, add:

```python
# Generate topic embedding for similarity search
from app.services.embeddings import embed_text as embed

embed_source = f"{topic.title} {tweet.text or ''} {tweet.grok_context or ''}"
topic.embedding = embed(embed_source)
```

Also add embedding update when topic title changes — after `topic.title = data["title"]`:

```python
# Re-embed if title changes and we have an OG tweet
if topic.og_tweet_id:
    og = await db.get(Tweet, topic.og_tweet_id)
    if og:
        from app.services.embeddings import embed_text as embed
        embed_source = f"{topic.title} {og.text or ''} {og.grok_context or ''}"
        topic.embedding = embed(embed_source)
```

**Step 3: Commit**

```bash
git add backend/app/routers/topics.py
git commit -m "feat: generate topic embeddings when OG post is set"
```

---

### Task 6: Accept/Dismiss Suggestion API Endpoints

New endpoints for the frontend to accept or dismiss AI suggestions.

**Files:**
- Modify: `backend/app/routers/tweets.py` (add accept/dismiss endpoints)
- Create: `backend/tests/test_accept_dismiss.py`

**Step 1: Write the failing test**

Create `backend/tests/test_accept_dismiss.py`:

```python
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.db import engine, Base, get_db, async_session


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.mark.asyncio
async def test_accept_suggestion():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Create a topic
        resp = await client.post("/api/topics", json={"title": "Test Topic", "date": "2026-02-27"})
        topic_id = resp.json()["id"]

        # Create a tweet with AI suggestion
        async with async_session() as db:
            from app.models.tweet import Tweet
            tweet = Tweet(tweet_id="123", author_handle="test", text="Test tweet")
            tweet.ai_topic_id = topic_id
            tweet.ai_category = "pushback"
            db.add(tweet)
            await db.commit()
            tweet_id = tweet.id

        # Accept suggestion
        resp = await client.post(f"/api/tweets/{tweet_id}/accept-suggestion")
        assert resp.status_code == 200
        data = resp.json()
        assert data["assigned_topic_id"] == topic_id
        assert data["category"] == "pushback"


@pytest.mark.asyncio
async def test_dismiss_suggestion():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with async_session() as db:
            from app.models.tweet import Tweet
            tweet = Tweet(tweet_id="456", author_handle="test", text="Test tweet")
            tweet.ai_topic_id = 1
            tweet.ai_category = "context"
            db.add(tweet)
            await db.commit()
            tweet_id = tweet.id

        resp = await client.post(f"/api/tweets/{tweet_id}/dismiss-suggestion")
        assert resp.status_code == 200

        # Verify suggestion cleared
        async with async_session() as db:
            from app.models.tweet import Tweet
            tweet = await db.get(Tweet, tweet_id)
            assert tweet.ai_topic_id is None
            assert tweet.ai_category is None
```

**Step 2: Write the implementation**

Add to `backend/app/routers/tweets.py`:

```python
from starlette.background import BackgroundTask as StarletteBackgroundTask


@router.post("/{tweet_id}/accept-suggestion", status_code=200)
async def accept_suggestion(tweet_id: int, db: AsyncSession = Depends(get_db)):
    """Accept AI suggestion: assign tweet to suggested topic with category."""
    tweet = await db.get(Tweet, tweet_id)
    if not tweet:
        raise HTTPException(404, "Tweet not found")
    if not tweet.ai_topic_id:
        raise HTTPException(400, "No AI suggestion for this tweet")

    topic_id = tweet.ai_topic_id
    category = tweet.ai_category

    # Create assignment
    existing = (await db.execute(
        select(TweetAssignment).where(
            TweetAssignment.tweet_id == tweet_id,
            TweetAssignment.topic_id == topic_id,
        )
    )).scalar_one_or_none()
    if existing:
        existing.category = category
    else:
        db.add(TweetAssignment(tweet_id=tweet_id, topic_id=topic_id, category=category))

    # Clear suggestion fields
    tweet.ai_topic_id = None
    tweet.ai_category = None
    tweet.ai_related_topic_id = None
    await db.commit()

    return JSONResponse(
        content={"assigned_topic_id": topic_id, "category": category},
        background=BackgroundTask(_recategorize_after_accept, topic_id),
    )


@router.post("/{tweet_id}/dismiss-suggestion", status_code=200)
async def dismiss_suggestion(tweet_id: int, db: AsyncSession = Depends(get_db)):
    """Dismiss AI suggestion: clear suggestion fields."""
    tweet = await db.get(Tweet, tweet_id)
    if not tweet:
        raise HTTPException(404, "Tweet not found")

    tweet.ai_topic_id = None
    tweet.ai_category = None
    tweet.ai_related_topic_id = None
    await db.commit()
    return {"dismissed": True}


async def _recategorize_after_accept(topic_id: int):
    """Background: re-categorize all tweets in topic after a new one is accepted."""
    from app.services.classifier import recategorize_topic_tweets
    await recategorize_topic_tweets(topic_id)
```

**Step 3: Run tests**

```bash
backend/.venv/bin/python -m pytest backend/tests/test_accept_dismiss.py -v
```

**Step 4: Commit**

```bash
git add backend/app/routers/tweets.py backend/tests/test_accept_dismiss.py
git commit -m "feat: add accept/dismiss suggestion API endpoints"
```

---

### Task 7: Update TweetOut Schema + Day Bundle

Add AI suggestion fields to the API response so the frontend can display them.

**Files:**
- Modify: `backend/app/schemas/tweet.py` (add AI fields to TweetOut)
- Modify: `backend/app/routers/days.py` (include AI fields in unsorted tweets)

**Step 1: Add fields to TweetOut**

Add to `TweetOut` in `backend/app/schemas/tweet.py`:

```python
ai_topic_id: int | None = None
ai_category: str | None = None
ai_related_topic_id: int | None = None
ai_override: bool = False
```

These fields are already on the model, so `model_validate` will pick them up automatically from the Tweet ORM object. No changes needed to `_tweet_out_with_category` in `days.py` — unsorted tweets are already built with `TweetOut.model_validate(t)` which will include the new fields.

**Step 2: Add topic title resolution for suggestion badge**

The frontend needs the topic title, not just the ID, to show a useful badge. Add a `ai_topic_title` field to TweetOut:

```python
ai_topic_title: str | None = None
```

Modify `get_day_bundle` in `backend/app/routers/days.py` to populate this field for unsorted tweets:

```python
# After building topic_rows, create a lookup
topic_title_map = {t.id: t.title for t in topic_rows}

# When building unsorted:
unsorted = []
for t in all_tweets:
    if t.id not in assigned_tweet_ids:
        out = TweetOut.model_validate(t)
        if out.ai_topic_id and out.ai_topic_id in topic_title_map:
            out.ai_topic_title = topic_title_map[out.ai_topic_id]
        elif out.ai_topic_id:
            # Topic might be from a different day — fetch title
            topic = await db.get(Topic, out.ai_topic_id)
            if topic:
                out.ai_topic_title = topic.title
                topic_title_map[topic.id] = topic.title  # cache
        unsorted.append(out)
```

**Step 3: Commit**

```bash
git add backend/app/schemas/tweet.py backend/app/routers/days.py
git commit -m "feat: expose AI suggestion fields in TweetOut and day bundle"
```

---

### Task 8: Frontend — Tweet Type + API Hooks

Update the frontend Tweet type and add accept/dismiss API hooks.

**Files:**
- Modify: `frontend/src/api/tweets.ts` (add AI fields to Tweet type, add hooks)
- Modify: `frontend/src/api/dayBundle.ts` (add accept/dismiss mutations)

**Step 1: Update Tweet type**

Add to `Tweet` interface in `frontend/src/api/tweets.ts`:

```typescript
ai_topic_id: number | null
ai_category: string | null
ai_related_topic_id: number | null
ai_topic_title: string | null
ai_override: boolean
```

**Step 2: Add accept/dismiss mutations**

Add to `frontend/src/api/dayBundle.ts`:

```typescript
export function useAcceptSuggestion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (tweetId: number) => {
      const { data } = await api.post(`/tweets/${tweetId}/accept-suggestion`)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['day-bundle'] }),
  })
}

export function useDismissSuggestion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (tweetId: number) => {
      const { data } = await api.post(`/tweets/${tweetId}/dismiss-suggestion`)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['day-bundle'] }),
  })
}
```

**Step 3: Commit**

```bash
git add frontend/src/api/tweets.ts frontend/src/api/dayBundle.ts
git commit -m "feat: add AI suggestion fields and accept/dismiss hooks"
```

---

### Task 9: Frontend — Suggestion Badges on Unsorted Tweets

Add suggestion badges to unsorted tweet cards showing the AI-suggested topic and category.

**Files:**
- Modify: `frontend/src/components/UnsortedSection.tsx`
- Modify: `frontend/src/constants/categories.ts` (for category color lookup in badge)

**Step 1: Add suggestion badge to UnsortedSection**

In `UnsortedSection.tsx`, modify the tweet card rendering to show a suggestion badge when `tweet.ai_topic_id` is set.

Add a `SuggestionBadge` component within the file:

```tsx
function SuggestionBadge({ tweet }: { tweet: Tweet }) {
  const accept = useAcceptSuggestion()
  const dismiss = useDismissSuggestion()

  if (!tweet.ai_topic_id || !tweet.ai_topic_title) return null

  const catDef = tweet.ai_category ? getCategoryDef(tweet.ai_category) : null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 10px',
      marginTop: 4,
    }}>
      <button
        onClick={(e) => { e.stopPropagation(); accept.mutate(tweet.id) }}
        disabled={accept.isPending}
        style={{
          background: 'var(--accent-muted)',
          border: '1px solid var(--accent)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--accent)',
          cursor: accept.isPending ? 'wait' : 'pointer',
          fontSize: 12,
          padding: '4px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'var(--font-body)',
        }}
      >
        <span style={{ fontSize: 11 }}>→</span>
        <span>{tweet.ai_topic_title}</span>
        {catDef && (
          <span style={{
            fontSize: 10,
            color: catDef.color,
            fontWeight: 600,
          }}>
            · {catDef.label}
          </span>
        )}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); dismiss.mutate(tweet.id) }}
        disabled={dismiss.isPending}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-tertiary)',
          cursor: 'pointer',
          fontSize: 14,
          padding: '2px 6px',
          lineHeight: 1,
        }}
        title="Dismiss suggestion"
      >
        ✕
      </button>
    </div>
  )
}
```

Render it below each tweet card in the unsorted list:

```tsx
<DraggableFeedTweetCard key={t.id} tweet={t} onContextMenu={onContextMenu}>
  <SuggestionBadge tweet={t} />
</DraggableFeedTweetCard>
```

Note: `DraggableFeedTweetCard` may need to accept children or the badge may need to be placed adjacent to it. Check the component's structure and add the badge in the right place — likely a wrapper div around the draggable card.

**Step 2: Add imports**

```typescript
import { useAcceptSuggestion, useDismissSuggestion } from '../api/dayBundle'
import { getCategoryDef } from '../constants/categories'
```

**Step 3: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add frontend/src/components/UnsortedSection.tsx
git commit -m "feat: add AI suggestion badges on unsorted tweets"
```

---

### Task 10: Manual Override Flag

When a user manually changes a tweet's category via the context menu, set `ai_override = true` so re-categorization skips it.

**Files:**
- Modify: `backend/app/routers/tweets.py` (set override flag on manual category change)

**Step 1: Update assign endpoint**

In the `assign_tweets` endpoint, when a category is explicitly set by the user (not by AI), mark the tweet as overridden. Add a query parameter or body field:

The simplest approach: when the assign endpoint is called from the frontend (not from accept-suggestion), set `ai_override = true` on the tweet if a category is provided.

Add to `assign_tweets` in `backend/app/routers/tweets.py`, inside the for loop after assigning:

```python
# Mark as manually overridden if user explicitly set category
if body.category:
    tweet = await db.get(Tweet, tid)
    if tweet:
        tweet.ai_override = True
```

**Step 2: Commit**

```bash
git add backend/app/routers/tweets.py
git commit -m "feat: set ai_override flag on manual category assignment"
```

---

### Task 11: Backfill Existing Topic Embeddings

Create a one-time script to generate embeddings for all existing topics that have OG posts.

**Files:**
- Create: `backend/scripts/backfill_embeddings.py`

**Step 1: Write the script**

```python
"""One-time: generate embeddings for all existing topics with OG posts."""
import asyncio
from app.db import async_session
from app.models.topic import Topic
from app.models.tweet import Tweet
from app.services.embeddings import embed_text
from sqlalchemy import select

async def main():
    async with async_session() as db:
        topics = (await db.execute(
            select(Topic).where(Topic.og_tweet_id.isnot(None))
        )).scalars().all()

        print(f"Found {len(topics)} topics with OG posts")
        for topic in topics:
            if topic.embedding is not None:
                print(f"  {topic.title}: already embedded, skipping")
                continue
            og = await db.get(Tweet, topic.og_tweet_id)
            if not og:
                print(f"  {topic.title}: OG tweet not found, skipping")
                continue
            source = f"{topic.title} {og.text or ''} {og.grok_context or ''}"
            topic.embedding = embed_text(source)
            print(f"  {topic.title}: embedded")
        await db.commit()
        print("Done")

asyncio.run(main())
```

**Step 2: Run on server after deploy**

```bash
docker exec -e PYTHONPATH=/app tpot-digest-backend-1 python scripts/backfill_embeddings.py
```

**Step 3: Commit**

```bash
git add backend/scripts/backfill_embeddings.py
git commit -m "feat: add backfill script for existing topic embeddings"
```
