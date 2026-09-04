from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from contracts.handoffs import InvestigatorResult, PlannerResult
from orchestration.assessment_interview import (
    BusinessContextNeed,
    CustomerContextRevision,
    InterviewAgentDecision,
    InterviewQuestion,
    InvestigatorContinuation,
    TechnicalCoverage,
    initial_interview,
    targeted_interview,
    validate_continuation,
)
from orchestration.context import LCSPRunContext
from orchestration.dispatcher import RootSubagentDispatcher


def _planner_definition() -> dict:
    return {
        "name": "planner",
        "model": "test-model",
        "tools": [],
        "system_prompt": "planner prompt",
        "middleware": [],
        "response_format": PlannerResult,
    }


def _investigator_definition() -> dict:
    return {
        "name": "investigator",
        "model": "test-model",
        "tools": [],
        "system_prompt": "investigator prompt",
        "middleware": [],
        "response_format": InvestigatorResult,
    }


def _program_graph() -> dict:
    return {
        "graph_id": "graph-1",
        "snapshot_id": "snapshot-1",
        "commit_sha": "abc123",
        "node_count": 1,
        "edge_count": 0,
        "nodes": [
            {
                "node_id": "node:ai",
                "node_type": "AI_MODEL_INVOCATION",
                "label": "responses.create",
                "source": {},
                "attributes": {},
                "semantic_types": [],
                "evidence_refs": [],
                "origin": "STATIC_ANALYSIS",
                "resolution_state": "CORROBORATED",
                "support_refs": [],
            }
        ],
        "edges": [],
        "source_anchors": [],
        "evidence_refs": ["EV-7"],
        "graph_hash": "sha256:graph",
    }


def test_e2e_a_initial_interview_reaches_planner_after_guarded_context_ready() -> None:
    with pytest.raises(ValueError, match="recovery before Interview"):
        initial_interview(
            coverage=TechnicalCoverage(state="UNAVAILABLE", limitations=("PGE_UNAVAILABLE",)),
            customer_revisions=(),
        )

    waiting = initial_interview(
        coverage=TechnicalCoverage(
            state="PARTIAL",
            limitations=("dynamic_path_unresolved",),
            missing_evidence_refs=("EV-MISSING",),
        ),
        customer_revisions=(),
    )
    assert waiting.outcome == "WAITING_FOR_CUSTOMER"
    assert waiting.active_question is None
    assert waiting.flags == ("INTERVIEW_AGENT_DECISION_REQUIRED",)
    assert waiting.coverage_limitations == ("dynamic_path_unresolved",)
    assert waiting.missing_evidence_is_absence_proof is False

    ambiguous = initial_interview(
        coverage=TechnicalCoverage(state="PARTIAL", limitations=("dynamic_path_unresolved",)),
        customer_revisions=(
            CustomerContextRevision(
                revision=1,
                facts={"ai_use": "maybe customer support"},
                authority="UNCERTAIN",
            ),
        ),
        agent_decision=InterviewAgentDecision(
            outcome="WAITING_FOR_CUSTOMER",
            active_question=InterviewQuestion(
                id="agent-authored-clarify",
                intent="CLARIFY",
                prompt="Agent-authored clarification question",
            ),
        ),
    )
    assert ambiguous.outcome == "WAITING_FOR_CUSTOMER"
    assert ambiguous.active_question is not None
    assert ambiguous.active_question.intent == "CLARIFY"

    ready = initial_interview(
        coverage=TechnicalCoverage(state="PARTIAL", limitations=("dynamic_path_unresolved",)),
        customer_revisions=(
            CustomerContextRevision(
                revision=2,
                facts={"ai_use": "customer support assistant", "decision_role": "recommendation"},
                authority="CUSTOMER_CONFIRMED",
                confirmed_by_actor_id="actor-customer-1",
            ),
        ),
        agent_decision=InterviewAgentDecision(outcome="CONTEXT_READY"),
    )
    assert ready.outcome == "CONTEXT_READY"
    assert ready.confirmed_context == {
        "ai_use": "customer support assistant",
        "decision_role": "recommendation",
    }
    assert ready.engineering_rule_can_start is True
    assert ready.planner_can_start is True

    specialist = MagicMock()
    specialist.invoke.return_value = {
        "structured_response": {
            "status": "INVESTIGATE",
            "engineering_rule_ids": ["ENG-1"],
            "artifact_versions": {"technicalEvidenceReportId": "ter-1"},
            "coverage_state": "LIMITED",
            "selected_scope": [
                {"ref": "node:ai", "criterion": "AI invocation exists"},
            ],
            "unresolved_facts": [],
            "next_step": "INVESTIGATE",
        }
    }
    dispatcher = RootSubagentDispatcher(
        agent_factory=MagicMock(return_value=specialist),
        subagents={"planner": _planner_definition()},
    )
    result = dispatcher.dispatch(
        subagent_type="planner",
        instruction="Plan from Customer-confirmed context revision 2 and PARTIAL PGE limitations.",
        affected_rule_ids=["ENG-1"],
        metadata={"artifact_versions": {"technicalEvidenceReportId": "ter-1"}},
        context=LCSPRunContext(
            assessment_id="assessment-1",
            user_id="actor-customer-1",
            workflow_run_id="workflow-1",
            artifact_versions={"technicalEvidenceReportId": "ter-1"},
        ),
        reenter_root=False,
    )

    assert result["status"] == "COMPLETED"
    assert result["handoff"]["status"] == "INVESTIGATE"
    assert result["handoff"]["engineering_rule_ids"] == ["ENG-1"]
    assert result["handoff"]["coverage_state"] == "LIMITED"


def test_e2e_b_targeted_clarification_validates_then_resumes_exact_investigator() -> None:
    need = BusinessContextNeed(
        need_id="need-human-review",
        business_context_need="Who confirms high-impact AI recommendations?",
        resolution_criteria=("human_reviewer_role", "decision_authority"),
        originating_investigation_reference="investigation:step-3",
        affected_rule_ids=("ENG-7",),
    )
    continuation = InvestigatorContinuation(
        token="opaque-continuation-token",
        originating_investigation_reference="investigation:step-3",
        investigator_execution_id="investigator:ENG-7:original",
        affected_rule_ids=("ENG-7",),
        artifact_versions={"technicalEvidenceReportId": "ter-7"},
    )

    waiting = targeted_interview(
        need=need,
        continuation=continuation,
        customer_revisions=(),
    )
    assert waiting.outcome == "WAITING_FOR_CUSTOMER"
    assert waiting.active_question is None
    assert waiting.flags == ("INTERVIEW_AGENT_DECISION_REQUIRED",)
    assert "opaque" not in str(waiting.interview_payload)
    assert "ENG-7" not in str(waiting.interview_payload)
    assert "checkpoint" not in str(waiting.interview_payload).lower()

    unresolved = targeted_interview(
        need=need,
        continuation=continuation,
        customer_revisions=(
            CustomerContextRevision(
                revision=3,
                facts={"human_reviewer_role": "operations lead"},
                authority="CUSTOMER_STATED",
            ),
        ),
        agent_decision=InterviewAgentDecision(
            outcome="WAITING_FOR_CUSTOMER",
            active_question=InterviewQuestion(
                id="agent-targeted-clarify",
                intent="CLARIFY",
                prompt="Agent-authored targeted clarification",
                need_id="need-human-review",
            ),
        ),
    )
    assert unresolved.outcome == "WAITING_FOR_CUSTOMER"
    assert unresolved.active_question is not None
    assert unresolved.active_question.intent == "CLARIFY"

    blocked = targeted_interview(
        need=need,
        continuation=continuation,
        customer_revisions=(),
        agent_decision=InterviewAgentDecision(outcome="BLOCKED_OR_UNRESOLVED"),
    )
    assert blocked.outcome == "BLOCKED_OR_UNRESOLVED"
    assert blocked.blocked_actions == (
        "PROVIDE_MORE_CONTEXT",
        "CHECK_INTERNALLY",
        "SAVE_AND_EXIT",
    )

    with pytest.raises(ValueError, match="stale continuation"):
        validate_continuation(
            need=need,
            continuation=continuation,
            current_artifact_versions={"technicalEvidenceReportId": "ter-stale"},
        )

    with pytest.raises(ValueError, match="origin"):
        validate_continuation(
            need=BusinessContextNeed(
                need_id="need-other",
                business_context_need="Different question",
                resolution_criteria=("decision_authority",),
                originating_investigation_reference="investigation:other",
                affected_rule_ids=("ENG-7",),
            ),
            continuation=continuation,
            current_artifact_versions={"technicalEvidenceReportId": "ter-7"},
        )

    consumed = validate_continuation(
        need=need,
        continuation=continuation,
        current_artifact_versions={"technicalEvidenceReportId": "ter-7"},
    )
    with pytest.raises(ValueError, match="resolution criteria"):
        targeted_interview(
            need=need,
            continuation=consumed,
            customer_revisions=(
                CustomerContextRevision(
                    revision=4,
                    facts={"unrelated_confirmed_fact": "yes"},
                    authority="CUSTOMER_CONFIRMED",
                    confirmed_by_actor_id="actor-customer-2",
                ),
            ),
            agent_decision=InterviewAgentDecision(outcome="CONTEXT_RESOLVED"),
        )
    with pytest.raises(ValueError, match="duplicate"): 
        validate_continuation(
            need=need,
            continuation=consumed,
            current_artifact_versions={"technicalEvidenceReportId": "ter-7"},
        )

    resolved = targeted_interview(
        need=need,
        continuation=consumed,
        customer_revisions=(
            CustomerContextRevision(
                revision=4,
                facts={
                    "human_reviewer_role": "operations lead",
                    "decision_authority": "human must approve before action",
                },
                authority="CUSTOMER_CONFIRMED",
                confirmed_by_actor_id="actor-customer-2",
            ),
        ),
        agent_decision=InterviewAgentDecision(outcome="CONTEXT_RESOLVED"),
    )
    assert resolved.outcome == "CONTEXT_RESOLVED"
    assert resolved.flags == ("DOWNSTREAM_IMPACT",)
    assert "DOWNSTREAM_IMPACT" != resolved.outcome
    assert resolved.resume == {
        "investigatorExecutionId": "investigator:ENG-7:original",
        "originatingInvestigationReference": "investigation:step-3",
        "affectedRuleIds": ["ENG-7"],
    }

    specialist = MagicMock()
    specialist.invoke.return_value = {
        "structured_response": {
            "status": "READY",
            "artifact_versions": {"technicalEvidenceReportId": "ter-7"},
            "claims": [
                {
                    "claim_id": "claim-7",
                    "engineering_rule_id": "ENG-7",
                    "claim_type": "UNRESOLVED_ENGINEERING_FACT",
                    "value": None,
                    "evidence_refs": ["EV-7"],
                    "graph_path_refs": ["node:ai"],
                    "source_anchor_refs": [],
                    "confidence": 0.91,
                    "limitations": [],
                    "criterion": "Human approval is required before action",
                }
            ],
            "limitations": [],
            "missing_input": None,
            "next_step": "GATE",
        }
    }
    factory = MagicMock(return_value=specialist)
    dispatcher = RootSubagentDispatcher(
        agent_factory=factory,
        subagents={"investigator": _investigator_definition()},
    )
    resumed = dispatcher.dispatch(
        subagent_type="investigator",
        instruction=(
            "Resume investigator execution investigator:ENG-7:original after "
            "orchestration-validated targeted Interview context resolution."
        ),
        affected_rule_ids=["ENG-7"],
        metadata={"artifact_versions": {"technicalEvidenceReportId": "ter-7"}},
        context=LCSPRunContext(
            assessment_id="assessment-7",
            user_id="actor-customer-2",
            workflow_run_id="workflow-7",
            artifact_versions={"technicalEvidenceReportId": "ter-7"},
        ),
        program_graph=_program_graph(),
        reenter_root=False,
    )

    assert resumed["status"] == "COMPLETED"
    assert resumed["handoff"]["claims"][0]["engineering_rule_id"] == "ENG-7"
    invoke_prompt = specialist.invoke.call_args.args[0]["messages"][0]["content"]
    assert "investigator:ENG-7:original" in invoke_prompt
    assert "opaque-continuation-token" not in invoke_prompt
