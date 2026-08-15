"""Deterministic citation validation for classification outputs."""

from typing import List, Tuple


def check_citations(
    citation_refs: List[str],
    citation_allowlist: List[str],
    repealed_refs: List[str] = None,
) -> Tuple[str, str]:
    """Validate classification citations against allowed and repealed sources.

    Repealed references are always blocked. Unknown references degrade an
    otherwise usable citation set only when at least one allowed reference
    remains; otherwise the output is blocked.

    Args:
        citation_refs: Citation identifiers proposed for the classification.
        citation_allowlist: Citation identifiers accepted for the current run.
        repealed_refs: Optional identifiers that must never be reused.

    Returns:
        A ``(guardrail_status, reason)`` tuple where status is ``passed``,
        ``degraded``, or ``blocked``.
    """
    if repealed_refs is None:
        repealed_refs = []

    if not citation_refs:
        return "blocked", "No valid citations provided."

    invalid_refs = [ref for ref in citation_refs if ref not in citation_allowlist]
    has_repealed = any(ref in repealed_refs for ref in citation_refs)

    if has_repealed:
        # Reusing REPEALED citations is strictly prohibited
        return "blocked", "Citation contains REPEALED references."

    if invalid_refs:
        valid_refs = [ref for ref in citation_refs if ref in citation_allowlist]
        if not valid_refs:
            return "blocked", "No valid citations remaining after allowlist check."
        return "degraded", f"Some citations missing or invalid: {invalid_refs}"

    return "passed", "All citations valid."
