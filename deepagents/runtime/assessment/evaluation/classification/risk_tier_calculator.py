"""Derive classification risk tier and citation coverage without an LLM."""

from typing import Dict, List, Tuple


def calculate_risk_tier(matches: List[Dict]) -> Tuple[str, str, str]:
    """Calculate risk level, applicability, and citation coverage deterministically.

    This function is intentionally rule-based: classification severity is
    derived from match confidence and citation coverage so the final risk tier
    is reproducible and does not depend on narrative LLM output.

    Args:
        matches: Legal-rule match dictionaries containing ``confidence`` and
            ``coverage_status`` values.

    Returns:
        A ``(risk_level, applicability_assessment, citation_coverage)`` tuple.
    """
    if not matches:
        return "LOW", "not_applicable", "NO_CITATION"

    applicability = "applicable"

    # Calculate aggregate citation coverage
    coverages = [m.get("coverage_status", "NO_CITATION") for m in matches]
    if all(c == "COMPLETE_CITATION" for c in coverages):
        overall_coverage = "COMPLETE_CITATION"
    elif all(c == "NO_CITATION" for c in coverages):
        overall_coverage = "NO_CITATION"
    else:
        overall_coverage = "PARTIAL_CITATION"

    # Calculate Risk Level deterministically
    # Simple logic based on confidence and coverage for now
    max_confidence = max([m.get("confidence", 0.0) for m in matches], default=0.0)

    if overall_coverage == "NO_CITATION":
        # Missing citations block or degrade classification
        risk_level = "BLOCKED"
    elif overall_coverage == "PARTIAL_CITATION":
        risk_level = "HIGH"
        applicability = "partially_applicable"
    else:
        if max_confidence > 0.8:
            risk_level = "HIGH"
        elif max_confidence > 0.5:
            risk_level = "MEDIUM"
        else:
            risk_level = "LOW"

    return risk_level, applicability, overall_coverage
