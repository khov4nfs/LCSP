"""Persist Planner execution rationale with the direct EngineeringRule assessment result."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from tools.engineer_rule.investigation.pipeline import EngineeringInvestigationResult


@dataclass(frozen=True)
class PlannedEngineeringInvestigationResult(EngineeringInvestigationResult):
    """Assessment result with non-authoritative Planner observability metadata.

    Planner metadata explains investigation scope only. It is deliberately separate
    from deterministic EngineeringRule evaluations and must never be interpreted as a
    legal applicability, risk-tier, or compliance decision.
    """

    planner_fallback_used: bool = False
    planner_decisions: tuple[dict[str, Any], ...] = ()

    def to_assessment_data(self) -> dict[str, Any]:
        payload = super().to_assessment_data()
        decisions = [dict(row) for row in self.planner_decisions]
        payload["planner"] = {
            "fallback_used": self.planner_fallback_used,
            "candidate_count": len(decisions),
            "selected_count": sum(
                1 for row in decisions if row.get("final_decision") == "SELECT"
            ),
            "skipped_count": sum(
                1 for row in decisions if row.get("final_decision") == "SKIP"
            ),
            "validation_override_count": sum(
                1 for row in decisions if row.get("validation_override")
            ),
            "authority": "TECHNICAL_INVESTIGATION_SCOPE_ONLY",
        }
        payload["planner_decisions"] = decisions
        return payload
