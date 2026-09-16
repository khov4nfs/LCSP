from __future__ import annotations

from tools.common.capabilities.assessment.planning.engineering_rule.engineering_rule_planner import (
    EngineeringRulePlanner,
    EngineeringRulePlanningCandidate,
)
from tools.common.capabilities.assessment.planning.engineering_rule.confirmed_business_context import (
    ConfirmedBusinessContextStatement,
    ConfirmedStructuredBusinessContext,
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


def _confirmed_context() -> ConfirmedStructuredBusinessContext:
    return ConfirmedStructuredBusinessContext(
        assessment_id="assessment-1",
        context_revision=3,
        statements=(
            ConfirmedBusinessContextStatement(
                statement_id="stmt-sector",
                topic="sector",
                statement="GENERAL_BUSINESS",
                normalized_value="GENERAL_BUSINESS",
                scope={"assessmentId": "assessment-1"},
                evidence_refs=("evidence:customer:1",),
                respondent_ref="actor:authenticated:1",
                created_at="2026-09-05T00:00:00Z",
                supersedes_statement_id=None,
            ),
        ),
    )


def test_plan_audit_records_requested_and_final_decision() -> None:
    plan = EngineeringRulePlanner._validate_plan(
        (_candidate("eng-1"), _candidate("eng-2")),
        {
            "decisions": [
                {
                    "engineeringRuleId": "eng-1",
                    "decision": "SELECT",
                    "reasonCode": "CUSTOMER_CONTEXT_SCOPE_MATCH",
                    "basis": ["CUSTOMER_CONTEXT"],
                },
                {
                    "engineeringRuleId": "eng-2",
                    "decision": "SKIP",
                    "reasonCode": "NO_CUSTOMER_CONTEXT_OR_SOURCE_SCOPE_SIGNAL",
                    "basis": ["CUSTOMER_CONTEXT", "RULE_CONTRACT"],
                },
            ]
        },
        confirmed_context=_confirmed_context(),
    )

    assert plan.selected_rule_ids == ("eng-1",)
    assert plan.skipped_rule_ids == ("eng-2",)
    assert [(row.requested_decision, row.final_decision) for row in plan.decision_audit] == [
        ("SELECT", "SELECT"),
        ("SKIP", "SKIP"),
    ]
    assert plan.decision_audit[1].reason_code == "NO_CUSTOMER_CONTEXT_OR_SOURCE_SCOPE_SIGNAL"
    assert plan.decision_audit[1].validation_override is None


def test_plan_audit_explains_source_backed_skip_override() -> None:
    plan = EngineeringRulePlanner._validate_plan(
        (_candidate("eng-source", source_hits=2), _candidate("eng-other")),
        {
            "decisions": [
                {
                    "engineeringRuleId": "eng-source",
                    "decision": "SKIP",
                    "reasonCode": "CUSTOMER_CONTEXT_SCOPE_EXCLUDES_RULE",
                    "basis": ["CUSTOMER_CONTEXT"],
                },
                {
                    "engineeringRuleId": "eng-other",
                    "decision": "SELECT",
                    "reasonCode": "BASELINE_CONTROL_RELEVANT",
                    "basis": ["RULE_CONTRACT"],
                },
            ]
        },
        confirmed_context=_confirmed_context(),
    )

    audit = plan.decision_audit[0]
    assert audit.requested_decision == "SKIP"
    assert audit.final_decision == "SELECT"
    assert audit.validation_override == "SOURCE_BASIS_REQUIRED"


def _rich_initial_interview_context() -> ConfirmedStructuredBusinessContext:
    statements = (
        ("stmt-ai-usage", "ai_usage", "Gemini analyzes repositories and drafts compliance findings."),
        (
            "stmt-decision-influence",
            "decision_influence",
            "AI never directly approves, blocks, or deploys changes.",
        ),
        (
            "stmt-human-oversight",
            "human_oversight",
            "A user reviews every finding before any remediation action.",
        ),
        ("stmt-affected-process", "operational_process", "Compliance assessment workflow."),
        ("stmt-data", "data_categories", "Repository source code and assessment metadata."),
    )
    return ConfirmedStructuredBusinessContext(
        assessment_id="assessment-1",
        context_revision=5,
        statements=tuple(
            ConfirmedBusinessContextStatement(
                statement_id=statement_id,
                topic=topic,
                statement=statement,
                normalized_value=statement,
                scope={"assessmentId": "assessment-1"},
                evidence_refs=("evidence:customer:1",),
                respondent_ref="actor:authenticated:1",
                created_at="2026-09-05T00:00:00Z",
                supersedes_statement_id=None,
            )
            for statement_id, topic, statement in statements
        ),
    )


def test_source_basis_override_still_selects_with_rich_initial_interview_context() -> None:
    context = _rich_initial_interview_context()
    plan = EngineeringRulePlanner._validate_plan(
        (_candidate("eng-source", source_hits=3), _candidate("eng-context-only")),
        {
            "decisions": [
                {
                    # The richer Customer context tempts a context-only SKIP, but the
                    # repository has material source hits the plan did not consider.
                    "engineeringRuleId": "eng-source",
                    "decision": "SKIP",
                    "reasonCode": "CUSTOMER_CONTEXT_SCOPE_EXCLUDES_RULE",
                    "basis": ["CUSTOMER_CONTEXT", "RULE_CONTRACT"],
                },
                {
                    "engineeringRuleId": "eng-context-only",
                    "decision": "SKIP",
                    "reasonCode": "CUSTOMER_CONTEXT_SCOPE_EXCLUDES_RULE",
                    "basis": ["CUSTOMER_CONTEXT"],
                },
            ]
        },
        confirmed_context=context,
    )

    source_audit, context_audit = plan.decision_audit
    assert plan.selected_rule_ids == ("eng-source",)
    assert plan.skipped_rule_ids == ("eng-context-only",)
    assert (source_audit.requested_decision, source_audit.final_decision) == ("SKIP", "SELECT")
    assert source_audit.validation_override == "SOURCE_BASIS_REQUIRED"
    assert context_audit.validation_override is None
    assert source_audit.interview_context_revision_used == 5
    assert source_audit.confirmed_statement_refs_used == context.confirmed_statement_refs
    assert len(source_audit.confirmed_statement_refs_used) == 5
