from __future__ import annotations

from tools.planner.investigation.engineering_rule_planner import (
    EngineeringRulePlanner,
    EngineeringRulePlanningCandidate,
)


def _candidate(rule_id: str, *, source_hits: int = 0) -> EngineeringRulePlanningCandidate:
    # Keep this fixture aligned with the full planner candidate contract, including
    # deterministic legal-reasoning metadata carried alongside technical scope.
    return EngineeringRulePlanningCandidate(
        engineering_rule_id=rule_id,
        concept=rule_id,
        legal_intent={},
        investigation_goals=(),
        required_evidence=(),
        legal_reasoning_contract={},
        starting_node_types=(),
        target_node_types=(),
        source_hit_count=source_hits,
        source_evidence_count=source_hits,
        source_node_types=("AI_MODEL_INVOCATION",) if source_hits else (),
    )


def test_plan_audit_records_requested_and_final_decision() -> None:
    plan = EngineeringRulePlanner._validate_plan(
        (_candidate("eng-1"), _candidate("eng-2")),
        {
            "decisions": [
                {
                    "engineeringRuleId": "eng-1",
                    "decision": "SELECT",
                    "reasonCode": "WIZARD_SCOPE_MATCH",
                    "basis": ["WIZARD"],
                },
                {
                    "engineeringRuleId": "eng-2",
                    "decision": "SKIP",
                    "reasonCode": "NO_WIZARD_OR_SOURCE_SCOPE_SIGNAL",
                    "basis": ["WIZARD", "RULE_CONTRACT"],
                },
            ]
        },
    )

    assert plan.selected_rule_ids == ("eng-1",)
    assert plan.skipped_rule_ids == ("eng-2",)
    assert [(row.requested_decision, row.final_decision) for row in plan.decision_audit] == [
        ("SELECT", "SELECT"),
        ("SKIP", "SKIP"),
    ]
    assert plan.decision_audit[1].reason_code == "NO_WIZARD_OR_SOURCE_SCOPE_SIGNAL"
    assert plan.decision_audit[1].validation_override is None


def test_plan_audit_explains_source_backed_skip_override() -> None:
    plan = EngineeringRulePlanner._validate_plan(
        (_candidate("eng-source", source_hits=2), _candidate("eng-other")),
        {
            "decisions": [
                {
                    "engineeringRuleId": "eng-source",
                    "decision": "SKIP",
                    "reasonCode": "WIZARD_SCOPE_EXCLUDES_RULE",
                    "basis": ["WIZARD"],
                },
                {
                    "engineeringRuleId": "eng-other",
                    "decision": "SELECT",
                    "reasonCode": "BASELINE_CONTROL_RELEVANT",
                    "basis": ["RULE_CONTRACT"],
                },
            ]
        },
    )

    audit = plan.decision_audit[0]
    assert audit.requested_decision == "SKIP"
    assert audit.final_decision == "SELECT"
    assert audit.validation_override == "SOURCE_BASIS_REQUIRED"
