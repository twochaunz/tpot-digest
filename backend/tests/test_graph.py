import pytest

from app.pipeline.graph import (
    compute_cosine_similarity,
    compute_edge_strength,
    compute_entity_overlap,
    detect_narrative_continuation,
    extract_entities,
    find_related_topics,
)


def test_cosine_similarity_identical():
    vec = [1.0, 0.0, 0.5]
    assert compute_cosine_similarity(vec, vec) == pytest.approx(1.0)


def test_cosine_similarity_orthogonal():
    a = [1.0, 0.0]
    b = [0.0, 1.0]
    assert compute_cosine_similarity(a, b) == pytest.approx(0.0)


def test_cosine_similarity_opposite():
    a = [1.0, 0.0]
    b = [-1.0, 0.0]
    assert compute_cosine_similarity(a, b) == pytest.approx(-1.0)


def test_extract_entities_finds_known():
    entities = extract_entities("OpenAI just released GPT-5 and Google responded with Gemini 2")
    assert "openai" in entities
    assert "gpt" in entities
    assert "google" in entities
    assert "gemini" in entities


def test_extract_entities_empty():
    assert extract_entities("") == set()


def test_entity_overlap_identical():
    s = {"openai", "gpt"}
    assert compute_entity_overlap(s, s) == pytest.approx(1.0)


def test_entity_overlap_disjoint():
    assert compute_entity_overlap({"openai"}, {"google"}) == pytest.approx(0.0)


def test_entity_overlap_partial():
    a = {"openai", "gpt", "claude"}
    b = {"openai", "anthropic"}
    # Intersection = {openai}, Union = {openai, gpt, claude, anthropic}
    assert compute_entity_overlap(a, b) == pytest.approx(1 / 4)


def test_entity_overlap_both_empty():
    assert compute_entity_overlap(set(), set()) == pytest.approx(0.0)


def test_narrative_continuation_similar():
    score = detect_narrative_continuation(
        "Claude 4 Launch", "Anthropic launches Claude 4 with new benchmarks",
        "Claude 4 Benchmark Controversy", "Questions about Claude 4 benchmark methodology"
    )
    assert score > 0.3


def test_narrative_continuation_unrelated():
    score = detect_narrative_continuation(
        "OpenAI Funding", "OpenAI raises new funding round",
        "Apple Vision Pro", "Apple releases new AR headset"
    )
    assert score < 0.2


def test_edge_strength_returns_type():
    strength, rel_type = compute_edge_strength(0.9, 0.1, 0.1)
    assert rel_type == "semantic_similarity"
    assert strength > 0.4

    strength2, rel_type2 = compute_edge_strength(0.1, 0.9, 0.1)
    assert rel_type2 == "entity_overlap"


def test_find_related_topics_above_threshold():
    topics = [
        {"id": 1, "title": "Claude Launch", "summary": "Anthropic launches Claude", "embedding": None, "tags": ["anthropic", "claude"]},
        {"id": 2, "title": "Claude Benchmarks", "summary": "Claude benchmark analysis", "embedding": None, "tags": ["anthropic", "claude", "benchmarks"]},
        {"id": 3, "title": "Apple Vision Pro", "summary": "Apple AR headset release", "embedding": None, "tags": ["apple", "ar"]},
    ]
    related = find_related_topics(
        "Claude 4 Performance", "Analysis of Claude 4 performance metrics",
        None, topics, threshold=0.1
    )
    # Should find Claude Launch and Claude Benchmarks as related, not Apple
    claude_ids = {r["target_topic_id"] for r in related}
    assert 1 in claude_ids or 2 in claude_ids


def test_find_related_topics_empty():
    assert find_related_topics("Test", "Test summary", None, [], threshold=0.3) == []


@pytest.mark.asyncio
async def test_generate_embedding_no_api_key(monkeypatch):
    """Without API key, should return None."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    from app.pipeline.graph import generate_embedding
    result = await generate_embedding("test text")
    assert result is None
