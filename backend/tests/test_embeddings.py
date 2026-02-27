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
