"""
Topic knowledge graph edge formation.

Provides functions to:
- Generate embeddings via OpenAI API
- Compute cosine similarity
- Extract named entities from text
- Compute entity overlap (Jaccard similarity)
- Detect narrative continuation between topics
- Compute edge strength and relationship type
- Find related topics above a similarity threshold
"""

import math
import os
import re

import httpx


async def generate_embedding(text: str) -> list[float] | None:
    """
    Call OpenAI embeddings API and return a 1536-dimension embedding vector.

    Returns None if OPENAI_API_KEY is not set or if the API call fails.
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None

    try:
        url = "https://api.openai.com/v1/embeddings"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "input": text,
            "model": "text-embedding-3-small",
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
            return data["data"][0]["embedding"]
    except Exception:
        return None


def compute_cosine_similarity(a: list[float], b: list[float]) -> float:
    """
    Compute cosine similarity between two vectors using pure Python (no numpy).

    Returns a float in [-1.0, 1.0]. Returns 0.0 if either vector is zero-length.
    """
    dot_product = sum(x * y for x, y in zip(a, b))
    magnitude_a = math.sqrt(sum(x * x for x in a))
    magnitude_b = math.sqrt(sum(x * x for x in b))

    if magnitude_a == 0.0 or magnitude_b == 0.0:
        return 0.0

    return dot_product / (magnitude_a * magnitude_b)


# Known tech entities to detect in text
_KNOWN_ENTITIES = {
    "openai", "anthropic", "claude", "gpt", "gemini", "google", "meta", "llama",
    "apple", "microsoft", "nvidia", "tesla", "elon", "sam altman", "mistral",
    "hugging face", "stability ai", "midjourney", "perplexity", "cursor", "devin",
    "copilot", "github", "twitter", "x.com",
}

# Pre-compiled pattern: two or more consecutive capitalized words
_CAP_PHRASE_RE = re.compile(r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b')


def extract_entities(text: str) -> set[str]:
    """
    Extract tech entities and capitalized multi-word phrases from text.

    Uses a hardcoded list of known tech entities plus detection of
    capitalized multi-word phrases that look like proper nouns.
    """
    if not text:
        return set()

    found: set[str] = set()
    text_lower = text.lower()

    # Check for known multi-word entities first (order matters for substrings)
    for entity in _KNOWN_ENTITIES:
        if entity in text_lower:
            found.add(entity)

    # Also capture capitalized multi-word phrases (e.g. "Vision Pro", "Large Language Model")
    for match in _CAP_PHRASE_RE.finditer(text):
        phrase = match.group(1).lower()
        # Skip if already covered by known entities
        if phrase not in found:
            found.add(phrase)

    return found


def compute_entity_overlap(entities_a: set[str], entities_b: set[str]) -> float:
    """
    Compute Jaccard similarity between two entity sets.

    Returns 0.0 if both sets are empty.
    """
    if not entities_a and not entities_b:
        return 0.0

    intersection = entities_a & entities_b
    union = entities_a | entities_b

    if not union:
        return 0.0

    return len(intersection) / len(union)


# Common English stopwords to exclude from word overlap
_STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "can", "that", "this", "these",
    "those", "it", "its", "as", "about", "into", "up", "out", "over",
    "under", "again", "further", "then", "once", "here", "there", "when",
    "where", "why", "how", "all", "both", "each", "few", "more", "most",
    "other", "some", "such", "no", "not", "only", "same", "so", "than",
    "too", "very", "just", "new", "also",
}


def _stem(word: str) -> str:
    """
    Very simple suffix stripping for English words.

    Handles common suffixes to enable fuzzy word matching (e.g. "benchmarks" -> "benchmark").
    """
    for suffix in ("ing", "tion", "ies", "ness", "ment", "ous", "ful", "ly", "ed", "er", "es", "s"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            return word[: len(word) - len(suffix)]
    return word


def _tokenize(text: str) -> set[str]:
    """Extract stemmed meaningful word tokens from text, excluding stopwords."""
    tokens = re.findall(r'\b[a-zA-Z][a-zA-Z0-9]*\b', text.lower())
    return {_stem(t) for t in tokens if t not in _STOPWORDS and len(t) > 2}


def detect_narrative_continuation(
    title_a: str,
    summary_a: str,
    title_b: str,
    summary_b: str,
) -> float:
    """
    Detect if two topics are narratively related by measuring significant word overlap.

    Uses an overlap coefficient (intersection / min set size) with simple stemming
    to handle morphological variants (e.g. "benchmark" / "benchmarks").

    Returns a score in [0.0, 1.0].
    """
    words_a = _tokenize(f"{title_a} {summary_a}")
    words_b = _tokenize(f"{title_b} {summary_b}")

    if not words_a or not words_b:
        return 0.0

    intersection = words_a & words_b

    # Use overlap coefficient: intersection / min(|A|, |B|)
    # This rewards shared content relative to the smaller text rather than penalizing
    # for vocabulary richness in either document.
    return len(intersection) / min(len(words_a), len(words_b))


def compute_edge_strength(
    semantic_sim: float,
    entity_overlap: float,
    narrative_score: float,
) -> tuple[float, str]:
    """
    Compute weighted edge strength and determine the dominant relationship type.

    Weights: semantic 0.5, entity 0.3, narrative 0.2.

    Returns (strength, relationship_type) where relationship_type is one of:
    - "semantic_similarity"
    - "entity_overlap"
    - "narrative_continuation"
    """
    weighted_semantic = semantic_sim * 0.5
    weighted_entity = entity_overlap * 0.3
    weighted_narrative = narrative_score * 0.2
    strength = weighted_semantic + weighted_entity + weighted_narrative

    # Determine which signal is the strongest contributor
    if weighted_semantic >= weighted_entity and weighted_semantic >= weighted_narrative:
        relationship_type = "semantic_similarity"
    elif weighted_entity >= weighted_narrative:
        relationship_type = "entity_overlap"
    else:
        relationship_type = "narrative_continuation"

    return (strength, relationship_type)


def find_related_topics(
    topic_title: str,
    topic_summary: str,
    topic_embedding: list[float] | None,
    all_topics: list[dict],
    threshold: float = 0.3,
) -> list[dict]:
    """
    Find all topics in all_topics that are related to the given topic above threshold.

    Each item in all_topics is a dict with keys: id, title, summary, embedding, tags.

    Returns a list of dicts with keys: target_topic_id, relationship_type, strength.
    Results are sorted by descending strength.
    """
    if not all_topics:
        return []

    query_entities = extract_entities(f"{topic_title} {topic_summary}")
    results: list[dict] = []

    for candidate in all_topics:
        cand_title = candidate.get("title", "")
        cand_summary = candidate.get("summary", "")
        cand_embedding = candidate.get("embedding")
        cand_id = candidate.get("id")

        # Compute semantic similarity if embeddings are available
        if topic_embedding is not None and cand_embedding is not None:
            semantic_sim = compute_cosine_similarity(topic_embedding, cand_embedding)
            # Normalize from [-1, 1] to [0, 1]
            semantic_sim = (semantic_sim + 1.0) / 2.0
        else:
            semantic_sim = 0.0

        # Compute entity overlap
        cand_entities = extract_entities(f"{cand_title} {cand_summary}")
        # Also include tags as entities
        for tag in candidate.get("tags", []):
            cand_entities.add(tag.lower())

        entity_overlap = compute_entity_overlap(query_entities, cand_entities)

        # Compute narrative continuation
        narrative_score = detect_narrative_continuation(
            topic_title, topic_summary, cand_title, cand_summary
        )

        # Compute edge strength
        strength, relationship_type = compute_edge_strength(
            semantic_sim, entity_overlap, narrative_score
        )

        if strength >= threshold:
            results.append({
                "target_topic_id": cand_id,
                "relationship_type": relationship_type,
                "strength": strength,
            })

    # Sort by descending strength
    results.sort(key=lambda r: r["strength"], reverse=True)
    return results
