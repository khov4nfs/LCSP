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
    return [{"name": name, "when_relevant": when} for name, when in CATALOG]


def load_skill(name: str) -> dict[str, object]:
    if name not in ALLOWED:
        return {"ok": False, "code": "UNKNOWN_ASSESSMENT_SKILL"}
    body = load_project_skill(name)
    return {
        "ok": True, "name": name,
        "contentSha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
        "authority": "NON_NORMATIVE_INVESTIGATION_GUIDANCE",
        "instructions": body,
    }
