"""Score and explain customer-context/evidence conflicts using deterministic weights."""

from __future__ import annotations


CONFIDENCE_WEIGHTS = {
    "high": 1.0,
    "medium": 0.7,
    "low": 0.4,
    "unknown": 0.2,
}

SEVERITY_WEIGHTS = {
    "direct": 1.0,
    "partial": 0.5,
    "scope_only": 0.3,
}

DEFAULT_NORMALIZATION_FACTOR = 1.0


class ConflictScoreCalculator:
    """Calculate bounded conflict priority scores and human-readable reasons."""

    def calculate(
        self,
        *,
        evidence_confidence: str | None,
        contradiction_severity: str,
        normalization_factor: float = DEFAULT_NORMALIZATION_FACTOR,
    ) -> float:
        """Calculate a normalized conflict score from evidence/severity weights.

        Args:
            evidence_confidence: Evidence confidence bucket; unknown values use
                the conservative ``unknown`` weight.
            contradiction_severity: Contradiction severity bucket.
            normalization_factor: Positive factor used to normalize the score.

        Returns:
            Score clamped to the inclusive 0..1 range and rounded to 2 decimals.

        Raises:
            ValueError: If ``normalization_factor`` is not positive.
        """
        if normalization_factor <= 0:
            raise ValueError("normalization_factor must be positive")

        confidence_weight = CONFIDENCE_WEIGHTS.get(
            str(evidence_confidence or "unknown").lower(),
            CONFIDENCE_WEIGHTS["unknown"],
        )
        severity_weight = SEVERITY_WEIGHTS.get(
            contradiction_severity,
            SEVERITY_WEIGHTS["partial"],
        )
        score = (confidence_weight * severity_weight) / normalization_factor
        return round(max(0.0, min(1.0, score)), 2)

    def explain(
        self,
        *,
        conflict_type: str,
        evidence_confidence: str | None,
        contradiction_severity: str,
    ) -> str:
        """Build a bounded explanation for a supported conflict type.

        Args:
            conflict_type: Detected conflict category.
            evidence_confidence: Confidence bucket attached to technical evidence.
            contradiction_severity: Severity used by scoring; retained in the
                signature for consistent conflict-calculator inputs.

        Returns:
            Human-readable explanation that avoids asserting a final legal outcome.
        """
        confidence = str(evidence_confidence or "unknown").lower()
        if conflict_type == "evidence_contradiction":
            return (
                "The technical evidence indicates external AI use, while the "
                "manager answer says external AI is not used. Review is needed "
                f"because the evidence strength is {confidence} and the disagreement is material."
            )
        if conflict_type == "scope_mismatch":
            return (
                "The technical evidence indicates an agent-like usage pattern, while the "
                "manager answer says the system does not make autonomous decisions. "
                f"Review is needed because the evidence strength is {confidence}."
            )
        if conflict_type == "unverifiable":
            return (
                "A high-confidence AI usage claim is supported only by low-coverage "
                "evidence. Review is needed before treating the claim as settled."
            )
        return (
            "The AI usage record and manager answers disagree on a material point. "
            f"Review is needed because the evidence strength is {confidence}."
        )
