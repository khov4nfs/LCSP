"""Route free-form agent questions to canonical wizard/pipeline locations.

Two routing engines, in priority order:

1. Small transformer embeddings (``sentence-transformers``, multilingual MiniLM
   class by default). The question text and each routing-target descriptor are
   embedded and compared by cosine similarity. The library is optional at
   runtime; when unavailable the router degrades to engine 2.
2. Deterministic multilingual keyword scoring with accent-insensitive matching
   (Vietnamese assessments frequently type with or without diacritics).

The agent may attach a ``suggestedFieldName`` hint. The hint is a prior, never
an override: it is accepted only when the computed ranking agrees it is
plausible, otherwise the computed winner or the GENERAL_CONTEXT fallback wins.
"""
from __future__ import annotations

import math
import os
import unicodedata
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from tools.common.capabilities.workflow.recovery.clarification.models import (
    CLARIFICATION_ROUTING_METHODS,
    ClarificationRoutingTarget,
)
from tools.common.capabilities.workflow.recovery.clarification.routing_catalog import (
    GENERAL_CONTEXT_TARGET,
    ROUTING_TARGETS,
    routing_target_by_field_name,
)
from tools.common.capabilities.platform.logging import get_logger


logger = get_logger(__name__)

DEFAULT_EMBEDDING_MODEL = "paraphrase-multilingual-MiniLM-L12-v2"
DEFAULT_SIMILARITY_THRESHOLD = 0.35
DEFAULT_KEYWORD_THRESHOLD = 0.34
_HINT_ACCEPTANCE_RATIO = 0.8

EmbeddingFn = Callable[[Sequence[str]], Sequence[Sequence[float]]]


def _deaccent(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value.lower())
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def _keyword_weight(keyword: str) -> float:
    return 2.0 if len(keyword.split()) > 1 else 1.0


def keyword_scores(question_text: str) -> dict[str, float]:
    """Deterministic accent-insensitive keyword score per routing target."""
    haystack_plain = question_text.lower()
    haystack_deaccented = _deaccent(question_text)
    scores: dict[str, float] = {}
    for target in ROUTING_TARGETS:
        score = 0.0
        for keyword in target.keywords:
            lowered = keyword.lower()
            deaccented = _deaccent(keyword)
            if (
                lowered in haystack_plain
                or (deaccented != lowered and deaccented in haystack_deaccented)
            ):
                score += _keyword_weight(keyword)
        if score:
            scores[target.field_name] = score
    return scores


def _keyword_confidence(score: float) -> float:
    return min(1.0, score / 3.0)


def _cosine_similarity(
    left: Sequence[float], right: Sequence[float]
) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = math.fsum(a * b for a, b in zip(left, right))
    norm_left = math.sqrt(math.fsum(a * a for a in left))
    norm_right = math.sqrt(math.fsum(b * b for b in right))
    if norm_left == 0.0 or norm_right == 0.0:
        return 0.0
    return dot / (norm_left * norm_right)


class ClarificationQuestionRouter:
    """Route one free-form question to its canonical clarification location."""

    def __init__(
        self,
        *,
        embedding_fn: EmbeddingFn | None = None,
        embedding_model_name: str | None = None,
        similarity_threshold: float = DEFAULT_SIMILARITY_THRESHOLD,
        keyword_threshold: float = DEFAULT_KEYWORD_THRESHOLD,
    ) -> None:
        self._embedding_fn = embedding_fn
        self._embedding_model_name = embedding_model_name or os.environ.get(
            "LCSP_CLARIFICATION_EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL
        )
        self._similarity_threshold = similarity_threshold
        self._keyword_threshold = keyword_threshold
        self._embedding_cache: dict[str, tuple[float, ...]] = {}

    def _resolve_embedding_fn(self) -> EmbeddingFn | None:
        if self._embedding_fn is not None:
            return self._embedding_fn
        try:
            from sentence_transformers import SentenceTransformer  # type: ignore[import-not-found]
        except Exception as error:  # pragma: no cover - depends on optional dep
            logger.info(
                "CLARIFICATION_EMBEDDINGS_UNAVAILABLE_KEYWORD_FALLBACK",
                model=self._embedding_model_name,
                error_type=type(error).__name__,
            )
            self._embedding_fn = None
            return None
        try:  # pragma: no cover - exercised only with the optional dep installed
            model = SentenceTransformer(self._embedding_model_name)

            def _encode(texts: Sequence[str]) -> Sequence[Sequence[float]]:
                return model.encode(list(texts)).tolist()

            self._embedding_fn = _encode
            return _encode
        except Exception as error:  # pragma: no cover
            logger.warning(
                "CLARIFICATION_EMBEDDING_MODEL_LOAD_FAILED",
                model=self._embedding_model_name,
                error_type=type(error).__name__,
            )
            return None

    def _target_embedding(
        self, embedding_fn: EmbeddingFn, target: ClarificationRoutingTarget
    ) -> tuple[float, ...]:
        cached = self._embedding_cache.get(target.field_name)
        if cached is not None:
            return cached
        vector = next(iter(embedding_fn([self._target_text(target)])))
        result = tuple(float(value) for value in vector)
        self._embedding_cache[target.field_name] = result
        return result

    @staticmethod
    def _target_text(target: ClarificationRoutingTarget) -> str:
        return f"{target.display_name}: {target.descriptor}"

    def _embedding_ranking(
        self, question_text: str
    ) -> list[tuple[ClarificationRoutingTarget, float]]:
        embedding_fn = self._resolve_embedding_fn()
        if embedding_fn is None:
            return []
        question_vector = next(iter(embedding_fn([question_text])))
        question_vector = tuple(float(value) for value in question_vector)
        ranked = [
            (
                target,
                _cosine_similarity(
                    question_vector, self._target_embedding(embedding_fn, target)
                ),
            )
            for target in ROUTING_TARGETS
        ]
        ranked.sort(key=lambda row: row[1], reverse=True)
        return ranked

    def _keyword_ranking(
        self, question_text: str
    ) -> list[tuple[ClarificationRoutingTarget, float]]:
        scores = keyword_scores(question_text)
        ranked = [
            (
                target,
                _keyword_confidence(scores[target.field_name]),
            )
            for target in ROUTING_TARGETS
            if target.field_name in scores
        ]
        ranked.sort(key=lambda row: (row[1], row[0].field_name), reverse=True)
        return ranked

    def route(
        self,
        question_text: str,
        *,
        suggested_field_name: str | None = None,
    ) -> tuple[ClarificationRoutingTarget, str, float]:
        """Return ``(target, routing_method, confidence)`` for one question."""
        embedding_ranking = self._embedding_ranking(question_text)
        if embedding_ranking:
            method = CLARIFICATION_ROUTING_METHODS["transformer_embedding"]
            threshold = self._similarity_threshold
            ranking: Sequence[tuple[ClarificationRoutingTarget, float]] = (
                embedding_ranking
            )
        else:
            method = CLARIFICATION_ROUTING_METHODS["keyword_fallback"]
            threshold = self._keyword_threshold
            ranking = self._keyword_ranking(question_text)

        hint_target = routing_target_by_field_name(suggested_field_name or "")
        if hint_target is not None:
            hint_score = next(
                (score for target, score in ranking if target is hint_target), 0.0
            )
            top_score = ranking[0][1] if ranking else 0.0
            hint_plausible = (
                not ranking
                or hint_score >= top_score * _HINT_ACCEPTANCE_RATIO
                or top_score < threshold
            )
            if hint_plausible:
                confidence = 1.0 if not ranking else max(hint_score, threshold)
                return hint_target, CLARIFICATION_ROUTING_METHODS["agent_hint"], confidence

        if ranking and ranking[0][1] >= threshold:
            target, score = ranking[0]
            return target, method, score
        return (
            GENERAL_CONTEXT_TARGET,
            method,
            ranking[0][1] if ranking else 0.0,
        )

    def route_batch(
        self,
        questions: Sequence[Mapping[str, Any]],
    ) -> list[tuple[Mapping[str, Any], ClarificationRoutingTarget, str, float]]:
        """Route many raw questions, returning each with its routing verdict."""
        results: list[
            tuple[Mapping[str, Any], ClarificationRoutingTarget, str, float]
        ] = []
        for question in questions:
            target, method, confidence = self.route(
                str(question.get("text") or ""),
                suggested_field_name=question.get("suggestedFieldName")
                or question.get("suggested_field_name"),
            )
            results.append((question, target, method, confidence))
        return results
