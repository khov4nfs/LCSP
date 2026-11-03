"""Checked-in non-normative investigation skills selected by observed capability."""
from __future__ import annotations

import hashlib
from tools.common.capabilities.agent_runtime.skill_loader import load_project_skill

CATALOG = (
    ("assessment-system-boundaries", "Map actual system boundaries and source execution."),
    ("assessment-automated-outcomes", "Trace consequential automation and human oversight."),
    ("assessment-model-integrity", "Inspect relevant AI/ML model semantics and inference."),
    ("assessment-data-lifecycle", "Investigate selected duties concerning data processing."),
    ("assessment-controls-and-claims", "Verify relevant safeguards and product claims."),
)
ALLOWED = frozenset(name for name, _ in CATALOG)


def list_skills() -> list[dict[str, str]]:
    """Business purpose:
    List reusable, allowlisted investigation methods for selected-rule reasoning.

    Business rules:
    - No dynamically derived or repo-specific skills; results never become legal authority.

    Execution flow:
    1. Return canonical names and relevance hints only.

    Failure cases:
    - The checked-in catalog is fixed and has no external dependencies.

    Side effects:
    - Read-only metadata; neither files nor Assessment state change.
    """
    return [{"name": name, "when_relevant": when} for name, when in CATALOG]


def load_skill(name: str) -> dict[str, object]:
    """Business purpose:
    Load a checked-in assessment investigation method by canonical name.

    Business rules:
    - Only allowlisted names; content is non-normative and cannot widen legal scope.

    Execution flow:
    1. Reject unsupported names or read the fixed skill text and attach its content hash.

    Failure cases:
    - Unsupported names return a stable error; missing checked-in files fail explicitly.

    Side effects:
    - May emit the existing skill usage stream event; writes no domain state.
    """
    if name not in ALLOWED:
        return {"ok": False, "code": "UNKNOWN_ASSESSMENT_SKILL"}
    body = load_project_skill(name)
    return {
        "ok": True, "name": name,
        "contentSha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
        "authority": "NON_NORMATIVE_INVESTIGATION_GUIDANCE",
        "instructions": body,
    }
