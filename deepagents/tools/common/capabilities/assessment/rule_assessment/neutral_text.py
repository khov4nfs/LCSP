"""Customer-safe text guard: internal rule, legal and runtime identifiers must not leak."""

from __future__ import annotations

import re

# Internal-identifier patterns: the single Python copy, also imported by the Interview
# customer-safe projection (subagents/interview/customer_safe_projection.py).
IDENTIFIER_LEAK_PATTERNS = (
    re.compile(r"\bEngineeringRule\b", re.IGNORECASE),
    re.compile(r"\bLegalRule\b", re.IGNORECASE),
    re.compile(r"\b(?:ENG|ER|LR)-\d+\b", re.IGNORECASE),
    re.compile(r"\bcheckpoint(?:Id)?\b", re.IGNORECASE),
    re.compile(r"\bcontinuation(?: token)?\b", re.IGNORECASE),
    re.compile(r"\bLangGraph\b", re.IGNORECASE),
    re.compile(r"\bthread(?:Id)?\b", re.IGNORECASE),
    re.compile(
        r"\b(?:CUSTOMER_CONFIRMED|CUSTOMER_STATED|CONTEXT_READY|CONTEXT_RESOLVED"
        r"|INTERVIEW_CONTEXT_READY_REQUIRES_AUTHORITY|BUSINESS_CONTEXT_RESOLUTION"
        r"|TARGETED_EXACT_RESUME_PIN|WAITING_FOR_CUSTOMER|BLOCKED_OR_UNRESOLVED"
        r"|NEEDS_INPUT|PRE_PLANNER|DECISION_PATH_UNRESOLVED)\b",
        re.IGNORECASE,
    ),
    re.compile(r"\bresolutionCriteria\b", re.IGNORECASE),
)

_LEAK_PATTERNS = (
    *IDENTIFIER_LEAK_PATTERNS,
    re.compile(r"\bcompliance classification\b", re.IGNORECASE),
    re.compile(r"\bEU AI Act\b", re.IGNORECASE),
    re.compile(r"\brisk category\b", re.IGNORECASE),
    re.compile(
        r"\b[a-z0-9_.-]+/[a-z0-9_./-]+\.(?:ts|tsx|js|jsx|py|java|go|rs)\b",
        re.IGNORECASE,
    ),
)


def assert_neutral_customer_text(*values: str | None) -> None:
    """Raise RuntimeError when customer-facing text exposes internal details."""
    for value in values:
        if value and any(pattern.search(value) for pattern in _LEAK_PATTERNS):
            raise RuntimeError(
                "Targeted Interview registration text must not expose internal rule, legal, or checkpoint details"
            )


__all__ = ["IDENTIFIER_LEAK_PATTERNS", "assert_neutral_customer_text"]
