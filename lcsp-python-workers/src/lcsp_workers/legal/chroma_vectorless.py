"""Shared ChromaDB helpers for structure-only collections."""
from __future__ import annotations

VECTORLESS_EMBEDDING_DIMENSIONS = 384


def zero_embeddings(count: int) -> list[list[float]]:
    """Return deterministic placeholder embeddings for exact-match Chroma collections."""
    return [[0.0] * VECTORLESS_EMBEDDING_DIMENSIONS for _ in range(count)]
