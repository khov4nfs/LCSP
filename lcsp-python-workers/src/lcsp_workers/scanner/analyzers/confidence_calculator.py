from __future__ import annotations

import decimal

from .finding_types import FINDING_TYPES


CONFIDENCE_COMPONENT_KEYS = (
    "base",
    "direct_evidence_bonus",
    "corroboration_bonus",
    "coverage_penalty",
    "ambiguity_penalty",
)


def calculate_confidence(
    finding_type: str,
    *,
    has_direct_ast_cst_evidence: bool = False,
    corroborating_tools: list[str] | None = None,
    material_coverage_limitations: int = 0,
    has_unresolved_path: bool = False,
) -> tuple[float, dict[str, float]]:
    """Calculate a deterministic confidence score and expose its components.

    The arithmetic intentionally mirrors the scanner specification component by
    component so downstream policy logic can explain why a finding gained or lost
    confidence instead of receiving an opaque model-style score.

    Args:
        finding_type: Registered finding type used to select base confidence.
        has_direct_ast_cst_evidence: Whether structural parsing directly supports
            the finding.
        corroborating_tools: Independent tools that observed the same signal.
        material_coverage_limitations: Count of meaningful analysis limitations.
        has_unresolved_path: Whether the scanner could not statically resolve a path.

    Returns:
        A two-decimal confidence score in ``[0, 1]`` and the named contribution map.

    Raises:
        KeyError: If ``finding_type`` is not registered in ``FINDING_TYPES``.
    """
    # Keep this arithmetic intentionally literal: downstream policy logic and
    # tests depend on the scanner-spec.md confidence components by name.
    base = FINDING_TYPES[finding_type]["base_confidence"]
    direct_evidence_bonus = 0.15 if has_direct_ast_cst_evidence else 0.0
    unique_corroborators = sorted(set(corroborating_tools or []))
    corroboration_bonus = min(len(unique_corroborators) * 0.05, 0.15)
    coverage_penalty = min(max(0, material_coverage_limitations) * 0.15, 0.30)
    ambiguity_penalty = 0.20 if has_unresolved_path else 0.0

    raw = (
        base
        + direct_evidence_bonus
        + corroboration_bonus
        - coverage_penalty
        - ambiguity_penalty
    )
    clamped = max(0.00, min(1.00, raw))
    confidence = float(
        decimal.Decimal(str(clamped)).quantize(
            decimal.Decimal("0.01"),
            rounding=decimal.ROUND_HALF_UP,
        )
    )
    return confidence, {
        "base": base,
        "direct_evidence_bonus": direct_evidence_bonus,
        "corroboration_bonus": corroboration_bonus,
        "coverage_penalty": coverage_penalty,
        "ambiguity_penalty": ambiguity_penalty,
    }
