"""Canonical state machine for proactive legal-intelligence maintenance."""

from __future__ import annotations

from typing import Final


LEGAL_INTELLIGENCE_STATES: Final[tuple[str, ...]] = (
    "source_refresh",
    "change_detection",
    "partial_chunk_update",
    "legal_triage",
    "partial_engineering_rule_update",
    "deterministic_validation",
    "activate",
    "resume_waiters",
    "complete",
)

LEGAL_INTELLIGENCE_TRANSITIONS: Final[dict[str, tuple[str, ...]]] = {
    "source_refresh": ("change_detection",),
    "change_detection": ("complete", "partial_chunk_update"),
    "partial_chunk_update": ("legal_triage",),
    "legal_triage": ("partial_engineering_rule_update",),
    "partial_engineering_rule_update": ("deterministic_validation",),
    "deterministic_validation": ("activate",),
    "activate": ("resume_waiters",),
    "resume_waiters": ("complete",),
    "complete": (),
}


def validate_legal_intelligence_transition(current: str, target: str) -> None:
    """Fail closed when a supervisor attempts to skip a legal maintenance stage."""
    if target not in LEGAL_INTELLIGENCE_TRANSITIONS.get(current, ()):
        raise ValueError(f"illegal legal-intelligence transition: {current} -> {target}")
