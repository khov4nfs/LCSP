"""Checked-in non-normative investigation skills selected by observed capability."""
from __future__ import annotations

import hashlib
from tools.common.capabilities.agent_runtime.skill_loader import load_project_skill_for_locale
from orchestration.context import resolve_response_language

CATALOG = (
    ("assessment-system-boundaries", "Map actual system boundaries and source execution."),
    ("assessment-automated-outcomes", "Trace consequential automation and human oversight."),
    ("assessment-model-integrity", "Inspect relevant AI/ML model semantics and inference."),
    ("assessment-data-lifecycle", "Investigate selected duties concerning data processing."),
    ("assessment-controls-and-claims", "Verify relevant safeguards and product claims."),
)
ALLOWED = frozenset(name for name, _ in CATALOG)
CATALOG_VI = {
    "assessment-system-boundaries": "Lập bản đồ ranh giới hệ thống và đường thực thi trong source.",
    "assessment-automated-outcomes": "Truy vết tác động của tự động hóa và giám sát của con người.",
    "assessment-model-integrity": "Kiểm tra mô hình AI/ML và diễn giải kết quả inference khi liên quan rule.",
    "assessment-data-lifecycle": "Điều tra vòng đời dữ liệu trong phạm vi nghĩa vụ đã chọn.",
    "assessment-controls-and-claims": "Xác minh biện pháp bảo vệ và tuyên bố tính năng có liên quan.",
}


def list_skills(locale: str = "en") -> list[dict[str, str]]:
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
    from runtime_instruction_bundle import runtime_instruction
    import json
    catalog = json.loads(runtime_instruction("runtime.skill-catalogs"))
    return [{"name": name, "when_relevant": catalog[name]} for name, _ in CATALOG]


def load_skill(name: str, locale: str = "en") -> dict[str, object]:
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
    normalized = resolve_response_language(locale)
    from runtime_instruction_bundle import runtime_instruction
    body = runtime_instruction("skill." + name)
    return {
        "ok": True, "name": name, "locale": "en",
        "contentSha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
        "authority": "NON_NORMATIVE_INVESTIGATION_GUIDANCE",
        "instructions": body,
    }
