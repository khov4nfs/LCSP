"""Confirmed Context Pack: what the Customer owns, normalized for downstream stages.

The Interview owns business-context gaps; the Repository Analyst consumes its
result. The thread already stores Customer-confirmed statements
(:mod:`confirmed_business_context`); this module projects them into the fixed
business dimensions downstream stages actually route on — oversight model,
downstream action boundary, data categories, AI capability purpose — plus the
gaps still open and the Scanner facts the context was grounded in.

It is a normalization of existing confirmed state: no new persistence, and every
statement stays attributed to the Customer revision that confirmed it.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from .confirmed_business_context import ConfirmedStructuredBusinessContext

CONFIRMED_CONTEXT_PACK_VERSION = "1.0.0"

# Topic keywords -> the business dimension a confirmed statement answers.
CONTEXT_DIMENSIONS: Mapping[str, tuple[str, ...]] = {
    "humanReviewModel": ("human", "review", "oversight", "approval", "signoff"),
    "downstreamActionBoundary": ("downstream", "action", "decision", "effect", "consequence"),
    "dataCategories": ("data", "personal", "pii", "category", "subject", "retention"),
    "aiCapabilityPurpose": ("ai", "capability", "purpose", "feature", "automation", "model"),
}


def build_confirmed_context_pack(
    context: ConfirmedStructuredBusinessContext | None,
    *,
    unresolved_business_gaps: Iterable[str] = (),
    resolved_needs: Iterable[str] = (),
    scanner_artifact_version: str | None = None,
) -> dict[str, Any]:
    """Project confirmed Customer context into downstream routing dimensions."""
    statements = tuple(context.statements) if context else ()
    dimensions: dict[str, list[dict[str, Any]]] = {key: [] for key in CONTEXT_DIMENSIONS}
    evidence_refs: list[str] = []
    for statement in statements:
        topic = str(getattr(statement, "topic", "") or "").lower()
        entry = {
            "statementId": statement.statement_id,
            "topic": statement.topic,
            "statement": statement.statement,
            "normalizedValue": statement.normalized_value,
            "evidenceRefs": list(statement.evidence_refs),
        }
        for dimension, keywords in CONTEXT_DIMENSIONS.items():
            if any(keyword in topic for keyword in keywords):
                dimensions[dimension].append(entry)
        evidence_refs.extend(statement.evidence_refs)
    return {
        "packVersion": CONFIRMED_CONTEXT_PACK_VERSION,
        "assessmentId": getattr(context, "assessment_id", None),
        "contextRevision": getattr(context, "context_revision", 0),
        "authority": getattr(context, "authority", None),
        "confirmedStatements": [statement.to_prompt_dict() for statement in statements],
        **dimensions,
        "unresolvedBusinessGaps": [str(gap) for gap in unresolved_business_gaps],
        "resolvedNeeds": [str(need) for need in resolved_needs],
        "linkedScannerFacts": {
            "scannerArtifactVersion": scanner_artifact_version,
            "authorizedEvidenceRefs": sorted(set(evidence_refs)),
        },
        "limitations": [str(item) for item in getattr(context, "limitations", ()) or ()],
    }


def context_pack_identity(pack: Mapping[str, Any]) -> tuple[Any, int]:
    """Cache identity of one confirmed context: its assessment and revision."""
    return (pack.get("assessmentId"), int(pack.get("contextRevision") or 0))


__all__ = [
    "CONFIRMED_CONTEXT_PACK_VERSION",
    "CONTEXT_DIMENSIONS",
    "build_confirmed_context_pack",
    "context_pack_identity",
]
