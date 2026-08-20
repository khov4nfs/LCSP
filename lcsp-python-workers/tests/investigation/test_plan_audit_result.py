from __future__ import annotations

from lcsp_workers.investigation.plan_audit_result import (
    PlannedEngineeringInvestigationResult,
)


def test_planner_decision_rationale_is_persisted_in_assessment_data() -> None:
    result = PlannedEngineeringInvestigationResult(
        status="COMPLETE",
        legal_rule_catalog_version_id="catalog",
        legal_corpus_version_id="corpus",
        rules_considered=2,
        engineering_rules_executed=1,
        engineering_rule_cache_hits=2,
        planner_fallback_used=False,
        planner_decisions=(
            {
                "engineering_rule_id": "eng-selected",
                "requested_decision": "SKIP",
                "final_decision": "SELECT",
                "reason_code": "WIZARD_SCOPE_EXCLUDES_RULE",
                "basis": ["WIZARD"],
                "validation_override": "SOURCE_BASIS_REQUIRED",
                "material_source_hit_count": 2,
                "material_source_evidence_count": 2,
                "material_source_node_types": ["BUSINESS_DECISION"],
                "scope_coverage_state": "SUFFICIENT",
                "scoped_truncated_query_count": 0,
                "scoped_unresolved_frontier_count": 0,
            },
            {
                "engineering_rule_id": "eng-skipped",
                "requested_decision": "SKIP",
                "final_decision": "SKIP",
                "reason_code": "NO_WIZARD_OR_SOURCE_SCOPE_SIGNAL",
                "basis": ["WIZARD", "RULE_CONTRACT"],
                "validation_override": None,
                "material_source_hit_count": 0,
                "material_source_evidence_count": 0,
                "material_source_node_types": [],
                "scope_coverage_state": "SUFFICIENT",
                "scoped_truncated_query_count": 0,
                "scoped_unresolved_frontier_count": 0,
            },
        ),
    )

    payload = result.to_assessment_data()

    assert payload["planner"] == {
        "fallback_used": False,
        "candidate_count": 2,
        "selected_count": 1,
        "skipped_count": 1,
        "validation_override_count": 1,
        "authority": "TECHNICAL_INVESTIGATION_SCOPE_ONLY",
    }
    assert payload["planner_decisions"][0]["engineering_rule_id"] == "eng-selected"
    assert payload["planner_decisions"][0]["validation_override"] == "SOURCE_BASIS_REQUIRED"
    assert payload["planner_decisions"][1]["reason_code"] == "NO_WIZARD_OR_SOURCE_SCOPE_SIGNAL"
