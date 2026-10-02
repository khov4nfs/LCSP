"""Interview runtime end-to-end coverage on the current boundary modules.

The deleted ``orchestration/assessment_interview.py`` state machine
(``initial_interview`` / ``investigator_resolution`` / ``orchestrator_transition`` /
``validate_continuation``) and the Planner/Investigator handoffs are gone. The same
boundaries are now owned by:

- ``tools/.../investigation/engineering_rule/interview_gated_boundary.py``
  (Initial Interview gate before any per-rule analysis),
- ``tools/.../workflow/recovery/interview_boundary.py``
  (guarded resume turns: authority preflight, minimum-context gate,
  confirmation synthesis),
- ``tools/.../planning/engineering_rule/confirmed_business_context.py``
  (guarded state -> confirmed-only envelope),
- ``rule_assessment/run.py`` (per-rule analyze/finalize + business-need registration).

PlannerResult/InvestigatorResult were intentionally deleted; only the interview
(InterviewResult) and triage handoffs remain, and the Repository Analyst delivers
its result through the governed ``submit_rule_assessment`` tool (no response_format).
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from contracts.handoffs import SPECIALIST_RESPONSE_FORMATS, InterviewResult
from orchestration.context import LCSPRunContext
from orchestration.dispatcher import RootSubagentDispatcher
from subagents.interview.definition import SUBAGENT as INTERVIEW_SUBAGENT
from subagents.repository_analyst.definition import SUBAGENT as REPOSITORY_ANALYST_SUBAGENT
from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_LIMITATION_CODES,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.interview_gated_boundary import (
    InterviewGatedEngineeringAssessmentBoundary,
    _ai_discovery,
    _can_start_initial_interview,
    _persistable_evidence_refs,
    _technical_coverage,
)
from tools.common.capabilities.assessment.planning.engineering_rule.confirmed_business_context import (
    normalize_confirmed_structured_business_context,
)
from tools.common.capabilities.assessment.rule_assessment.run import (
    analyze_rule,
    finalize_rule_results,
    register_business_needs,
    rule_runtime_version,
)
from tools.common.capabilities.assessment.rule_assessment.values import (
    RULE_ANALYSIS_STATUSES,
    RULE_ASSESSMENT_VALIDATOR_ID,
    RULE_CRITERION_STATUSES,
    RULE_EVIDENCE_KINDS,
)
from tools.common.capabilities.workflow.recovery.interview_boundary import (
    _apply_authority_preflight,
    _missing_initial_planning_context_dimensions,
)
from tools.legal.corpus.engineering_rules.contract.models import EngineeringRule


def _interview_definition() -> dict:
    return {
        "name": "interview",
        "model": "test-model",
        "tools": [],
        "system_prompt": "interview prompt",
        "middleware": [],
        "response_format": InterviewResult,
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
                "origin": "DEEP_AGENT",
                "resolution_state": "CORROBORATED",
                "support_refs": [],
            }
        ],
        "edges": [],
        "source_anchors": [],
        "evidence_refs": ["EV-7"],
        "graph_hash": "sha256:graph",
    }


def _evidence_report() -> dict:
    return {
        "assessment_id": "assessment-1",
        "snapshot_id": "snapshot-1",
        "user_id": "actor-customer-1",
        "scan_job_id": "scan-1",
        "evidence_payload": {
            "evidence_graph": {
                "coverage_state": "READY",
                "coverage_notes": [],
            }
        },
    }


def _confirmed_state() -> dict:
    return {
        "outcome": "CONTEXT_READY",
        "contextRevision": 2,
        "confirmedContext": {
            "assessmentId": "assessment-1",
            "contextRevision": 2,
            "statements": [
                {
                    "statementId": "stmt-decision-authority",
                    "topic": "decision_authority",
                    "statement": "a human approves every customer-facing action",
                    "normalizedValue": "human",
                    "scope": {},
                    "evidenceRefs": ["technicalEvidenceReport:ter-1"],
                    "respondentRef": "actor:authenticated-1",
                    "createdAt": "2026-09-05T00:00:00Z",
                    "source": "CUSTOMER_CONFIRMED",
                    "resolutionState": "CONFIRMED",
                }
            ],
        },
    }


def test_interview_gate_matrix_and_partial_policy_contract() -> None:
    ready = _evidence_report()
    assert _can_start_initial_interview(*_technical_coverage(ready), ready) is True

    unavailable = {"evidence_payload": {"evidence_graph": {"coverage_state": "UNAVAILABLE"}}}
    assert _can_start_initial_interview(*_technical_coverage(unavailable), unavailable) is False

    partial_without_policy = {
        "evidence_payload": {"evidence_graph": {"coverage_state": "PARTIAL"}}
    }
    with pytest.raises(ValueError, match="does not permit"):
        _require_policy(partial_without_policy)
    assert (
        _can_start_initial_interview(
            *_technical_coverage(partial_without_policy), partial_without_policy
        )
        is False
    )

    partial_permitted = {
        "evidence_payload": {
            "evidence_graph": {
                "coverage_state": "PARTIAL",
                "partialCoveragePolicyDecision": {
                    "permittedForInterview": True,
                    "policyDecisionRef": "coverage-policy:assessment-1:rev-1",
                    "policyVersion": "partial-coverage-v1",
                    "limitations": ["dynamic_path_unresolved"],
                },
            }
        }
    }
    coverage_state, notes = _technical_coverage(partial_permitted)
    assert _can_start_initial_interview(coverage_state, notes, partial_permitted) is True
    assert notes == ["dynamic_path_unresolved"]

    partial_denied = {
        "evidence_payload": {
            "evidence_graph": {
                "coverage_state": "PARTIAL",
                "partialCoveragePolicyDecision": {
                    "permittedForInterview": False,
                    "policyDecisionRef": "coverage-policy:assessment-1:rev-3",
                    "policyVersion": "partial-coverage-v1",
                    "limitations": ["dynamic_path_unresolved"],
                },
            }
        }
    }
    assert (
        _can_start_initial_interview(
            *_technical_coverage(partial_denied), partial_denied
        )
        is False
    )

    # Missing technical evidence is never absence proof: an absent-AI gate without
    # READY coverage stays AI_UNKNOWN, so no rule is excluded on missing evidence.
    absent_without_ready = {
        "evidence_payload": {
            "evidence_graph": {"coverage_state": "PARTIAL"},
            "ai_discovery": {"gate": "AI_ABSENT_CONFIRMED", "coverage_state": "READY"},
        }
    }
    assert _ai_discovery(absent_without_ready)["gate"] == "AI_UNKNOWN"

    # The persisted-refs set is exact: the report, its snapshot, the Interview
    # runtime, and graph refs verbatim; anything else is rejected downstream.
    refs = _persistable_evidence_refs(_evidence_report_with_graph(), "ter-1")
    assert "technicalEvidenceReport:ter-1" in refs
    assert "repositorySnapshot:snapshot-1" in refs
    assert "interviewRuntime:assessment-interview-runtime-v1" in refs
    assert "EV-7" in refs

    # Authority without provenance is downgraded, never trusted: the candidate's
    # confirmed context is dropped while the persisted answer survives server-side.
    downgraded, _ = _apply_authority_preflight(
        {
            "outcome": "WAITING_FOR_CUSTOMER",
            "contextAuthority": "CUSTOMER_CONFIRMED",
            "confirmedContext": {"statements": [{"statementId": "s1"}]},
            "activeQuestion": None,
            "mode": "INITIAL_INTERVIEW",
        },
        {},
    )
    assert downgraded["contextAuthority"] == "CUSTOMER_STATED"
    assert downgraded["confirmedContext"] == {}

    # CONTEXT_READY without minimum planning context still waits: every dimension
    # is missing until the customer actually covers it.
    missing = _missing_initial_planning_context_dimensions(
        {"outcome": "CONTEXT_READY", "confirmedContext": {}}, None
    )
    assert set(missing) == {
        "aiUsage",
        "operationalProcess",
        "decisionInfluence",
        "humanOversight",
        "affectedSubjects",
        "dataCategories",
    }


def _require_policy(report: dict) -> None:
    permitted = (
        (report.get("evidence_payload") or {})
        .get("evidence_graph", {})
        .get("partialCoveragePolicyDecision")
    )
    if not isinstance(permitted, dict) or permitted.get("permittedForInterview") is not True:
        raise ValueError("partial coverage does not permit Initial Interview")


def _evidence_report_with_graph() -> dict:
    return {
        "assessment_id": "assessment-1",
        "snapshot_id": "snapshot-1",
        "evidence_payload": {"evidence_graph": _program_graph()},
    }


def test_specialist_contracts_are_interview_and_triage_only() -> None:
    assert set(SPECIALIST_RESPONSE_FORMATS) == {"interview", "triage"}
    assert SPECIALIST_RESPONSE_FORMATS["interview"] is InterviewResult
    # The Repository Analyst delivers its result through the governed
    # submit_rule_assessment tool, never through a response_format handoff.
    assert "response_format" not in REPOSITORY_ANALYST_SUBAGENT
    tool_names = {
        getattr(tool, "name", getattr(tool, "__name__", ""))
        for tool in REPOSITORY_ANALYST_SUBAGENT["tools"]
    }
    assert "submit_rule_assessment" in tool_names
    assert INTERVIEW_SUBAGENT["response_format"] is InterviewResult


def test_e2e_a_initial_interview_gates_per_rule_analysis() -> None:
    waiting_api = _FakeInterviewApi(
        {
            "outcome": "WAITING_FOR_CUSTOMER",
            "contextRevision": 0,
            "activeQuestion": None,
            "authenticatedActorId": "actor-customer-1",
        }
    )
    dispatcher = _FakeInterviewDispatcher()
    boundary = InterviewGatedEngineeringAssessmentBoundary(
        SimpleNamespace(),
        api_client=waiting_api,
        interview_dispatcher=dispatcher,
        retriever=SimpleNamespace(),
        rule_service=SimpleNamespace(),
        triage_trigger_publisher=lambda _payload: None,
    )

    gated = boundary._prepare_interview(
        evidence_report=_evidence_report(),
        evidence_report_id="ter-1",
        assessment_id="assessment-1",
        correlation_id="corr-1",
        workflow_run_id="workflow-1",
    )

    # No confirmed context: the gate posts the first customer question and no
    # EngineeringRule analysis may start.
    assert gated is None
    assert len(waiting_api.seeded) == 1
    question = waiting_api.seeded[0][1]["activeQuestion"]
    assert question["frontier"]["owner"] == "CUSTOMER"
    assert question["frontier"]["materiality"] == "MATERIAL"
    assert "ENG-1" not in str(waiting_api.seeded[0][1])
    assert "checkpoint" not in str(waiting_api.seeded[0][1]).lower()

    # Guarded CONTEXT_READY normalizes to the confirmed-only envelope, which is
    # the only context per-rule analysis may consume.
    ready_api = _FakeInterviewApi(_confirmed_state())
    ready_boundary = InterviewGatedEngineeringAssessmentBoundary(
        SimpleNamespace(),
        api_client=ready_api,
        interview_dispatcher=dispatcher,
        retriever=SimpleNamespace(),
        rule_service=SimpleNamespace(),
        triage_trigger_publisher=lambda _payload: None,
    )
    confirmed = ready_boundary._prepare_interview(
        evidence_report=_evidence_report(),
        evidence_report_id="ter-1",
        assessment_id="assessment-1",
        correlation_id="corr-1",
        workflow_run_id="workflow-1",
    )
    assert confirmed is not None
    assert confirmed.context_revision == 2
    assert confirmed.confirmed_statement_refs == ("stmt-decision-authority",)

    # The confirmed envelope feeds one Repository Analyst task; the persisted
    # criterion finalizes deterministically to COMPLIANT.
    rule = _engineering_rule("ENG-1")
    ledger = _MemoryRuleApi()
    row = analyze_rule(
        rule=rule,
        context=LCSPRunContext(
            assessment_id="assessment-1",
            user_id="actor-customer-1",
            workflow_run_id="workflow-1",
            commit_sha="abc123",
            artifact_versions={"technicalEvidenceReportId": "ter-1"},
        ),
        dispatcher=_FakeAnalystDispatcher(ledger, "assessment-1", "abc123"),
        api=ledger,
        confirmed_context=confirmed,
    )
    assert row["status"] == RULE_ANALYSIS_STATUSES["completed"]
    (evaluation,) = finalize_rule_results(
        assessment_id="assessment-1",
        rules=[rule],
        api=MagicMock(),
        applicability_facts={},
        context_revision=2,
        assessments=[row],
        applicability={"ENG-1": {"status": "MATCHED"}},
        commit_sha="abc123",
    )
    assert evaluation.status == "COMPLIANT"

    # The Interview specialist itself dispatches under the shared lifecycle and
    # returns a validated candidate handoff.
    specialist = MagicMock()
    specialist.invoke.return_value = {
        "structured_response": {
            "expectedContextRevision": 0,
            "mode": "INITIAL_INTERVIEW",
            "outcome": "WAITING_FOR_CUSTOMER",
            "activeQuestion": {
                "id": "agent-authored-clarify",
                "intent": "CLARIFY",
                "control": "FREE_TEXT",
                "prompt": "Agent-authored clarification question",
                "frontier": {
                    "owner": "CUSTOMER",
                    "materiality": "MATERIAL",
                    "description": "Approval threshold and authority",
                    "evidenceRefs": [],
                },
            },
            "contextAuthority": "CUSTOMER_STATED",
        }
    }
    root_dispatcher = RootSubagentDispatcher(
        agent_factory=MagicMock(return_value=specialist),
        subagents={"interview": _interview_definition()},
    )
    result = root_dispatcher.dispatch(
        subagent_type="interview",
        instruction="Run INITIAL_INTERVIEW from PARTIAL coverage limitations.",
        affected_rule_ids=["ENG-1"],
        metadata={"artifact_versions": {"technicalEvidenceReportId": "ter-1"}},
        context=LCSPRunContext(
            assessment_id="assessment-1",
            user_id="actor-customer-1",
            workflow_run_id="workflow-1",
            artifact_versions={"technicalEvidenceReportId": "ter-1"},
        ),
    )
    assert result["status"] == "COMPLETED"
    assert result["handoff"]["outcome"] == "WAITING_FOR_CUSTOMER"
    assert result["handoff"]["activeQuestion"]["intent"] == "CLARIFY"


def test_e2e_b_targeted_business_context_resolves_and_resumes_same_rule() -> None:
    rule = _engineering_rule("ENG-7")
    need_id = "need:ENG-7:HUMAN_OVERSIGHT:0123456789ab"
    waiting_assessment = {
        "resultId": "rar-ENG-7-waiting",
        "assessmentId": "assessment-7",
        "engineeringRuleId": "ENG-7",
        "engineeringRuleVersion": rule_runtime_version(rule),
        "repositoryVersion": "abc123",
        "contextRevision": 3,
        "status": RULE_ANALYSIS_STATUSES["needsContext"],
        "criteria": [
            {
                "criterionId": "HUMAN_OVERSIGHT",
                "status": RULE_CRITERION_STATUSES["businessContextRequired"],
                "evidenceRefs": [],
                "evidence": [],
                "technicalFacts": [],
                "limitations": [],
                "businessContextNeed": {
                    "needId": need_id,
                    "question": "Who confirms high-impact recommendations before action?",
                    "observation": "Whether a person reviews recommendations is unresolved.",
                    "resolutionCriterionIds": ["HUMAN_OVERSIGHT"],
                },
            }
        ],
        "limitations": [],
        "execution": {"attempt": 1},
    }

    ledger = _MemoryRuleApi()
    context = LCSPRunContext(
        assessment_id="assessment-7",
        user_id="actor-customer-2",
        workflow_run_id="workflow-7",
        commit_sha="abc123",
        artifact_versions={"technicalEvidenceReportId": "ter-7"},
    )
    registered = register_business_needs(
        rule=rule,
        assessment=waiting_assessment,
        context=context,
        api=ledger,
        user_id="actor-customer-2",
    )
    assert registered == [need_id]
    assert ledger.needs[0]["needId"] == need_id
    assert "ENG-7" not in ledger.needs[0]["question"]

    (waiting_evaluation,) = finalize_rule_results(
        assessment_id="assessment-7",
        rules=[rule],
        api=MagicMock(),
        applicability_facts={},
        context_revision=3,
        assessments=[waiting_assessment],
        applicability={"ENG-7": {"status": "MATCHED"}},
        commit_sha="abc123",
    )
    assert waiting_evaluation.status == "UNKNOWN"
    assert (
        ENGINEERING_LIMITATION_CODES["active_customer_condition_pending"]
        in waiting_evaluation.limitations
    )

    # A failed resume never erases the rule's previously accepted result.
    class _FailingDispatcher:
        def dispatch(self, **kwargs):
            raise RuntimeError("model failed")

    confirmed = SimpleNamespace(context_revision=4, to_prompt_dict=lambda: {})
    resumed_prior = analyze_rule(
        rule=rule,
        context=context,
        dispatcher=_FailingDispatcher(),
        api=ledger,
        confirmed_context=confirmed,
        prior_result=waiting_assessment,
    )
    assert resumed_prior == waiting_assessment

    # After the customer answer, the same rule re-analyzes and concludes.
    ledger2 = _MemoryRuleApi()
    resolved_row = analyze_rule(
        rule=rule,
        context=context,
        dispatcher=_FakeAnalystDispatcher(ledger2, "assessment-7", "abc123"),
        api=ledger2,
        confirmed_context=confirmed,
        prior_result=waiting_assessment,
    )
    (resolved_evaluation,) = finalize_rule_results(
        assessment_id="assessment-7",
        rules=[rule],
        api=MagicMock(),
        applicability_facts={},
        context_revision=4,
        assessments=[resolved_row],
        applicability={"ENG-7": {"status": "MATCHED"}},
        commit_sha="abc123",
    )
    assert resolved_evaluation.status == "COMPLIANT"
    assert resolved_evaluation.engineering_rule_id == "ENG-7"

    # A targeted CONTEXT_RESOLVED state normalizes exactly like CONTEXT_READY.
    resolved_state = {
        "outcome": "CONTEXT_RESOLVED",
        "contextRevision": 4,
        "confirmedContext": {
            "assessmentId": "assessment-7",
            "contextRevision": 4,
            "statements": [
                {
                    "statementId": "stmt-human-review",
                    "topic": "decision_authority",
                    "statement": "operations lead approves before action",
                    "normalizedValue": "human",
                    "scope": {"needId": need_id},
                    "evidenceRefs": ["evidence:customer:7"],
                    "respondentRef": "actor:authenticated-2",
                    "createdAt": "2026-09-05T00:00:00Z",
                    "source": "CUSTOMER_CONFIRMED",
                    "resolutionState": "CONFIRMED",
                }
            ],
        },
    }
    normalized = normalize_confirmed_structured_business_context(
        resolved_state, assessment_id="assessment-7"
    )
    assert normalized.context_revision == 4
    assert normalized.confirmed_statement_refs == ("stmt-human-review",)


def test_guarded_context_without_statements_fails_closed() -> None:
    with pytest.raises(ValueError, match="no usable confirmed structured statements"):
        normalize_confirmed_structured_business_context(
            {
                "outcome": "CONTEXT_READY",
                "contextRevision": 2,
                "confirmedContext": {
                    "assessmentId": "assessment-1",
                    "contextRevision": 2,
                    # Only CUSTOMER_CONFIRMED/CONFIRMED statements are usable;
                    # anything else leaves the envelope with nothing to consume.
                    "statements": [
                        {
                            "statementId": "stmt-uncertain",
                            "topic": "decision_authority",
                            "statement": "maybe a human approves",
                            "normalizedValue": "uncertain",
                            "scope": {},
                            "evidenceRefs": [],
                            "respondentRef": "actor:authenticated-1",
                            "createdAt": "2026-09-05T00:00:00Z",
                            "source": "CUSTOMER_STATED",
                            "resolutionState": "CONFIRMED",
                        }
                    ],
                },
            },
            assessment_id="assessment-1",
        )


def _engineering_rule(rule_id: str) -> EngineeringRule:
    return EngineeringRule(
        engineering_rule_id=rule_id,
        legal_rule_id="legal-1",
        legal_rule_catalog_version_id="catalog-v1",
        legal_corpus_version_id="corpus-v1",
        concept="HUMAN_OVERSIGHT",
        legal_intent={},
        investigation_goals=("Find review controls",),
        starting_node_types=(),
        target_node_types=(),
        edge_strategies=(),
        graph_queries=(),
        required_evidence=("HUMAN_OVERSIGHT",),
        source_chunk_ids=("LAW:A1",),
        source_locators=("art-1::cl-1",),
    )


class _FakeInterviewApi:
    def __init__(self, state: dict):
        self.state = state
        self.seeded: list = []
        self.ai_not_detected: list = []

    def get_interview_worker_state(self, assessment_id):
        assert assessment_id == "assessment-1"
        return dict(self.state)

    def post_interview_initial_question(self, assessment_id, payload):
        self.seeded.append((assessment_id, payload))
        return payload

    def post_assessment_ai_not_detected(self, assessment_id, payload):
        self.ai_not_detected.append((assessment_id, payload))
        return {"assessment_id": assessment_id, "status": "AI_NOT_DETECTED"}

    def post_scan_runtime_event(self, scan_job_id, payload):
        return None


class _FakeInterviewDispatcher:
    def __init__(self):
        self.calls: list = []

    def dispatch(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "status": "COMPLETED",
            "handoff": {
                "expectedContextRevision": 0,
                "mode": "INITIAL_INTERVIEW",
                "outcome": "WAITING_FOR_CUSTOMER",
                "activeQuestion": {
                    "id": "question-1",
                    "intent": "ASK",
                    "control": "FREE_TEXT",
                    "prompt": "Who approves this business action?",
                    "frontier": {
                        "owner": "CUSTOMER",
                        "materiality": "MATERIAL",
                        "description": "Approval threshold and authority",
                        "evidenceRefs": [],
                    },
                },
                "confirmedContext": {},
                "flags": [],
                "blockedActions": [],
                "targetedResolution": {},
            },
        }


class _MemoryRuleApi:
    """In-memory rule-assessment ledger plus targeted-need registration."""

    def __init__(self):
        self.rows: list[dict] = []
        self.needs: list[dict] = []

    def list_rule_assessments(self, assessment_id):
        return [row for row in self.rows if row.get("assessmentId") == assessment_id]

    def put_rule_assessment(self, assessment_id, rule_id, payload):
        self.rows.append(payload)
        return payload

    def post_interview_targeted_need(self, assessment_id, payload):
        self.needs.append(payload)
        return {"registered": True}

    def post_scan_runtime_event(self, scan_job_id, payload):
        return None


class _FakeAnalystDispatcher:
    """One Repository Analyst turn: persist an accepted EVIDENCE_FOUND row."""

    def __init__(self, api: _MemoryRuleApi, assessment_id: str, commit_sha: str):
        self.api = api
        self.assessment_id = assessment_id
        self.commit_sha = commit_sha

    def dispatch(self, **kwargs):
        context = kwargs["context"]
        rule_id = kwargs["affected_rule_ids"][0]
        entry = {
            "ref": "ref:review-control",
            "path": "src/review.py",
            "startLine": 10,
            "endLine": 20,
            "symbol": "review_control",
            "provenance": {
                "assessmentId": context.assessment_id,
                "repositoryVersion": context.commit_sha,
                "engineeringRuleId": rule_id,
                "criterionId": "HUMAN_OVERSIGHT",
                "validator": RULE_ASSESSMENT_VALIDATOR_ID,
            },
        }
        row = {
            "resultId": f"rar-{rule_id}-resolved",
            "assessmentId": context.assessment_id,
            "engineeringRuleId": rule_id,
            "engineeringRuleVersion": context.engineering_rule_version,
            "repositoryVersion": context.commit_sha,
            "contextRevision": int(getattr(context, "context_revision", 0) or 0),
            "status": RULE_ANALYSIS_STATUSES["completed"],
            "criteria": [
                {
                    "criterionId": "HUMAN_OVERSIGHT",
                    "status": RULE_CRITERION_STATUSES["evidenceFound"],
                    "evidenceKind": RULE_EVIDENCE_KINDS["supportsRequirement"],
                    "evidenceRefs": [entry["ref"]],
                    "evidence": [entry],
                    "technicalFacts": [],
                    "limitations": [],
                }
            ],
            "limitations": [],
            "execution": {"attempt": 1, "runId": kwargs["thread_id"]},
        }
        self.api.put_rule_assessment(context.assessment_id, rule_id, row)
        return {"status": "COMPLETED"}
