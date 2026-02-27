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
