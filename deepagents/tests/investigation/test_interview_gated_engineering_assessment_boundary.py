from __future__ import annotations

import re
from types import SimpleNamespace
import pytest

from tools.common.capabilities.assessment.investigation.engineering_rule.interview_gated_boundary import (
    InterviewGatedEngineeringAssessmentBoundary,
    _has_authoritative_customer_ai_context,
)
from tools.common.capabilities.agent_runtime.boundary import NonRetryableAgentBoundaryError
from tools.common.capabilities.platform.api_client import WorkerCallbackError
from orchestration.result_validation import SpecialistHandoffValidationError


class FakeApi:
    def __init__(self, state):
        self.state = state
        self.seeded = []
        self.ai_not_detected = []
        self.events = []

    def post_scan_runtime_event(self, scan_job_id, payload):
        self.events.append((scan_job_id, payload))

    def limitation_codes(self):
        return [p["summary"] for _, p in self.events if p["tool_name"].startswith("technical_limitation:")]

    def post_assessment_ai_not_detected(self, assessment_id, payload):
        self.ai_not_detected.append((assessment_id, payload))
        return {"assessment_id": assessment_id, "status": "AI_NOT_DETECTED"}

    def get_interview_worker_state(self, assessment_id):
        assert assessment_id == "assessment-1"
        return dict(self.state)

    def post_interview_initial_question(self, assessment_id, payload):
        self.seeded.append((assessment_id, payload))
        return payload


class FakeDispatcher:
    def __init__(self):
        self.calls = []

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


def _boundary(api, dispatcher):
    return InterviewGatedEngineeringAssessmentBoundary(
        SimpleNamespace(),
        api_client=api,
        interview_dispatcher=dispatcher,
        retriever=SimpleNamespace(),
        rule_service=SimpleNamespace(),
        triage_trigger_publisher=lambda _payload: None,
    )


def _report():
    return {
        "assessment_id": "assessment-1",
        "snapshot_id": "snapshot-1",
        "schema_version": "2.0.0",
        "user_id": "user-test-owner",
        "scan_job_id": "scan-1",
        "evidence_payload": {
            "evidence_graph": {
                "coverage_state": "PARTIAL",
                "coverage_notes": ["dynamic configuration not fully observed"],
                "partialCoveragePolicyDecision": {
                    "permittedForInterview": True,
                    "policyDecisionRef": "policy:snapshot-1",
                    "policyVersion": "v1",
                    "limitations": ["dynamic configuration not fully observed"],
                },
            }
        },
    }


def _ai_report(gate, findings, *, coverage="READY"):
    report = _report()
    graph = report["evidence_payload"]["evidence_graph"]
    graph["coverage_state"] = coverage
    graph["coverage_notes"] = []
    graph.pop("partialCoveragePolicyDecision", None)
    report["evidence_payload"]["ai_discovery"] = {
        "schema_version": "1.0.0",
        "gate": gate,
        "coverage_state": coverage,
        "findings": findings,
        "material_unresolved_frontiers": [],
    }
    return report


def _ai_finding(kind, clarification_kind, *, owner="CUSTOMER"):
    return {
        "evidence_id": "ai-evidence:stable-1",
        "state": (
            "POSSIBLE_AI_CALL"
            if clarification_kind == "OUTBOUND_AI_CONFIRMATION"
            else "CONFIRMED_AI_CALL"
        ),
        "resolution_state": "UNRESOLVED" if owner == "TECHNICAL" else "OBSERVED",
        "kind": kind,
        "clarification_owner": owner,
        "clarification_kind": clarification_kind,
        "evidence_refs": [],
        "snippet_ref": {
            "snapshot_id": "snapshot-1",
            "commit_sha": "abc123",
            "file_path": "src/ai.ts",
            "start_line": 42,
            "end_line": 42,
            "evidence_hash": "sha256:" + "a" * 64,
            "snippet_policy": "PINNED_SNAPSHOT_BOUNDED_REDACTED_V1",
        },
    }


def test_stale_accepted_evidence_event_is_terminal_before_interview_dispatch() -> None:
    api = FakeApi({"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 0})
    api.get_accepted_technical_evidence_report = lambda _report_id: (_ for _ in ()).throw(
        WorkerCallbackError(
            "VALIDATION_FAILED: Callback failed with client error 404.", status_code=404
        )
    )
    dispatcher = FakeDispatcher()
    boundary = _boundary(api, dispatcher)

    with pytest.raises(NonRetryableAgentBoundaryError, match="client error 404"):
        boundary.handle(
            {"evidenceReportId": "stale-ter", "assessmentId": "assessment-1"},
            "corr-stale",
        )

    assert dispatcher.calls == []
    assert api.seeded == []


@pytest.mark.parametrize("invalid_policy", [None, {},
    {"permittedForInterview": False, "policyDecisionRef": "ref", "policyVersion": "v1", "limitations": ["gap"]},
    {"permittedForInterview": True, "policyDecisionRef": " ", "policyVersion": "v1", "limitations": ["gap"]},
    {"permittedForInterview": True, "policyDecisionRef": "ref", "policyVersion": "v1", "limitations": [" ", 3]},
])
def test_invalid_partial_policy_never_dispatches_interview(invalid_policy):
    api = FakeApi({"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 0})
    dispatcher = FakeDispatcher()
    report = _report()
    report["evidence_payload"]["evidence_graph"]["partialCoveragePolicyDecision"] = invalid_policy
    _boundary(api, dispatcher)._prepare_interview(
        evidence_report=report, evidence_report_id="ter-1",
        assessment_id="assessment-1", correlation_id="corr",
    )
    assert dispatcher.calls == []
    assert api.seeded == []
    # Fail closed with a typed activity (no root/model prompt, nothing queued).
    assert api.limitation_codes() == ["TECHNICAL_COVERAGE_RECOVERY_REQUIRED"]


def test_coverage_callback_rejection_emits_recovery_activity_without_seeding(monkeypatch):
    from tools.common.capabilities.platform.api_client import InterviewCoverageCallbackError
    api = FakeApi({"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 0})
    def reject(*args):
        raise InterviewCoverageCallbackError("coverage changed")
    monkeypatch.setattr(api, "post_interview_initial_question", reject)
    dispatcher = FakeDispatcher()
    _boundary(api, dispatcher)._prepare_interview(
        evidence_report=_report(), evidence_report_id="ter-1",
        assessment_id="assessment-1", correlation_id="corr",
        workflow_run_id="workflow-1",
    )
    assert len(dispatcher.calls) == 1
    assert api.limitation_codes() == ["TECHNICAL_COVERAGE_RECOVERY_REQUIRED"]
    assert api.seeded == []


@pytest.mark.parametrize("graph_key", ["evidence_graph", "evidenceGraph", "programEvidenceGraph", "program_evidence_graph"])
def test_payload_policy_limitations_authorize_partial_without_graph_notes(graph_key):
    report = _report()
    payload = report["evidence_payload"]
    graph = payload.pop("evidence_graph")
    payload[graph_key] = graph
    policy = graph.pop("partialCoveragePolicyDecision")
    policy["limitations"] = ["bounded policy limitation"]
    payload["partial_coverage_policy_decision"] = policy
    graph["coverage_notes"] = []
    api = FakeApi({"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 0})
    dispatcher = FakeDispatcher()
    _boundary(api, dispatcher)._prepare_interview(
        evidence_report=report, evidence_report_id="ter-1",
        assessment_id="assessment-1", correlation_id="corr",
        workflow_run_id="workflow-1",
    )
    assert len(api.seeded) == 1
    assert "bounded policy limitation" in dispatcher.calls[0]["instruction"]


def _structured_context(*, revision: int = 2):
    return {
        "assessmentId": "assessment-1",
        "contextRevision": revision,
        "authority": "CUSTOMER_CONFIRMED_CONFIRMED_ONLY",
        "statements": [
            {
                "statementId": "stmt-decision-authority",
                "assessmentId": "assessment-1",
                "topic": "decision_authority",
                "statement": "human approval",
                "normalizedValue": "human approval",
                "scope": {"assessmentId": "assessment-1"},
                "evidenceRefs": ["evidence:customer:1"],
                "respondentRef": "actor:authenticated:1",
                "createdAt": "2026-09-05T00:00:00Z",
                "source": "CUSTOMER_CONFIRMED",
                "resolutionState": "CONFIRMED",
            }
        ],
        "limitations": ["customer-confirmed current statements only"],
        "sourceVersionRef": "snapshot-1:abc123",
        "pgeVersion": "ter-1:v1",
        "guidanceVersion": "guidance-1",
    }


def test_rule_scope_message_is_forwarded_to_the_scoped_rule_run(monkeypatch) -> None:
    api = FakeApi(
        {
            "outcome": "CONTEXT_READY",
            "contextRevision": 2,
            "confirmedContext": _structured_context(revision=2),
        }
    )
    api.get_accepted_technical_evidence_report = lambda _report_id: _report()
    boundary = _boundary(api, FakeDispatcher())
    seen = {}
    monkeypatch.setattr(
        boundary,
        "run_assessment",
        lambda message, corr, *, confirmed_context, rule_scope=None: seen.update(
            scope=rule_scope, revision=confirmed_context.context_revision
        ),
    )

    boundary.handle(
        {"evidenceReportId": "ter-1", "assessmentId": "assessment-1", "ruleScope": ["rule-a"]},
        "corr-scope",
    )

    assert seen == {"scope": ("rule-a",), "revision": 2}


def test_initial_pge_event_bootstraps_interview_and_stops_before_pipeline() -> None:
    api = FakeApi(
        {
            "outcome": "WAITING_FOR_CUSTOMER",
            "contextRevision": 0,
            "answerHistory": [],
        }
    )
    dispatcher = FakeDispatcher()
    boundary = _boundary(api, dispatcher)

    result = boundary._prepare_interview(
        evidence_report=_report(),
        evidence_report_id="ter-1",
        assessment_id="assessment-1",
        correlation_id="00000000-0000-0000-0000-000000000001",
        workflow_run_id="10000000-0000-0000-0000-000000000001",
    )

    assert result is None
    assert len(dispatcher.calls) == 1
    instruction = dispatcher.calls[0]["instruction"]
    assert "INITIAL_INTERVIEW" in instruction
    assert "PARTIAL" in instruction
    assert "Missing technical evidence is not proof" in instruction
    assert api.seeded[0][0] == "assessment-1"
    assert api.seeded[0][1]["outcome"] == "WAITING_FOR_CUSTOMER"
    assert api.seeded[0][1]["technicalEvidenceReportId"] == "ter-1"


def test_ready_no_ai_gate_short_circuits_before_interview_dispatch() -> None:
    api = FakeApi({"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 0})
    dispatcher = FakeDispatcher()

    result = _boundary(api, dispatcher)._prepare_interview(
        evidence_report=_ai_report("AI_ABSENT_CONFIRMED", []),
        evidence_report_id="ter-no-ai",
        assessment_id="assessment-1",
        correlation_id="corr-no-ai",
        workflow_run_id="workflow-no-ai",
    )

    assert result is None
    assert dispatcher.calls == []
    assert api.seeded == []
    # The assessment ends as "AI not detected" instead of waiting for a question.
    assert api.ai_not_detected == [
        ("assessment-1", {"technicalEvidenceReportId": "ter-no-ai"})
    ]


def test_unrelated_customer_business_model_does_not_block_no_ai_gate() -> None:
    assert not _has_authoritative_customer_ai_context(
        {
            "confirmedContext": {
                "statements": [
                    {
                        "topic": "pricing",
                        "statement": "Our subscription business model charges monthly.",
                        "normalizedValue": "subscription business model",
                        "source": "CUSTOMER_CONFIRMED",
                        "resolutionState": "CONFIRMED",
                    }
                ]
            }
        }
    )


def test_ready_no_ai_gate_early_stops_with_unrelated_customer_business_model() -> None:
    api = FakeApi(
        {
            "outcome": "CONTEXT_READY",
            "contextRevision": 1,
            "confirmedContext": {
                "statements": [
                    {
                        "topic": "pricing",
                        "statement": "Our subscription business model charges monthly.",
                        "normalizedValue": "subscription business model",
                        "source": "CUSTOMER_CONFIRMED",
                        "resolutionState": "CONFIRMED",
                    }
                ]
            },
        }
    )
    dispatcher = FakeDispatcher()
    result = _boundary(api, dispatcher)._prepare_interview(
        evidence_report=_ai_report("AI_ABSENT_CONFIRMED", []),
        evidence_report_id="ter-business-model",
        assessment_id="assessment-1",
        correlation_id="corr-business-model",
    )
    assert result is None
    assert dispatcher.calls == []
    assert api.ai_not_detected == [
        ("assessment-1", {"technicalEvidenceReportId": "ter-business-model"})
    ]


def test_ai_not_detected_rejection_fails_the_boundary_instead_of_waiting() -> None:
    api = FakeApi({"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 0})

    def reject(*_args):
        raise WorkerCallbackError("absence not proven", status_code=409)

    api.post_assessment_ai_not_detected = reject

    with pytest.raises(WorkerCallbackError):
        _boundary(api, FakeDispatcher())._prepare_interview(
            evidence_report=_ai_report("AI_ABSENT_CONFIRMED", []),
            evidence_report_id="ter-stale",
            assessment_id="assessment-1",
            correlation_id="corr-stale",
        )


def test_explicit_customer_external_ai_context_blocks_no_ai_gate() -> None:
    assert _has_authoritative_customer_ai_context(
        {
            "confirmedContext": {
                "statements": [
                    {
                        "topic": "external_ai_usage",
                        "statement": "A hosted external AI service is used.",
                        "normalizedValue": "true",
                        "source": "CUSTOMER_CONFIRMED",
                        "resolutionState": "CONFIRMED",
                    }
                ]
            }
        }
    )


def test_customer_negative_ai_statement_does_not_block_no_ai_gate() -> None:
    assert not _has_authoritative_customer_ai_context(
        {
            "confirmedContext": {
                "statements": [
                    {
                        "topic": "ai_usage",
                        "statement": "We do not use generative AI.",
                        "normalizedValue": "false",
                        "source": "CUSTOMER_CONFIRMED",
                        "resolutionState": "CONFIRMED",
                    }
                ]
            }
        }
    )



def test_no_ai_gate_does_not_override_authoritative_customer_confirmed_ai_context() -> None:
    context = _structured_context(revision=3)
    context["statements"][0].update(
        {
            "statementId": "stmt-ai-usage",
            "topic": "ai_usage",
            "statement": "An external AI service is used outside the scanned repository.",
            "normalizedValue": "external_ai_service",
        }
    )
    api = FakeApi(
        {
            "outcome": "CONTEXT_READY",
            "contextRevision": 3,
            "confirmedContext": context,
        }
    )

    result = _boundary(api, FakeDispatcher())._prepare_interview(
        evidence_report=_ai_report("AI_ABSENT_CONFIRMED", []),
        evidence_report_id="ter-no-repo-ai",
        assessment_id="assessment-1",
        correlation_id="corr-external-ai",
        workflow_run_id="workflow-external-ai",
    )

    assert result is not None
    assert result.context_revision == 3
    assert result.confirmed_statement_refs == ("stmt-ai-usage",)
    assert api.ai_not_detected == []


def test_technical_ai_uncertainty_never_blocks_ready_context_and_emits_typed_activity() -> None:
    customer = _ai_finding("OUTBOUND_API", "OUTBOUND_AI_CONFIRMATION")
    technical = _ai_finding(
        "DYNAMIC_TARGET", "TARGETED_TECHNICAL_REANALYSIS", owner="TECHNICAL"
    )
    report = _ai_report("AI_UNKNOWN", [customer, technical])
    report["evidence_payload"]["ai_discovery"]["material_unresolved_frontiers"] = [
        "frontier:dynamic-1"
    ]
    api = FakeApi(
        {
            "outcome": "CONTEXT_READY",
            "contextRevision": 2,
            "confirmedContext": _structured_context(revision=2),
        }
    )

    result = _boundary(api, FakeDispatcher())._prepare_interview(
        evidence_report=report,
        evidence_report_id="ter-mixed",
        assessment_id="assessment-1",
        correlation_id="corr-mixed",
        workflow_run_id="workflow-mixed",
    )

    # No root recovery prompt: the gate stays UNKNOWN (gated rules become pending
    # deterministically) and ungated rules still run.
    assert result is not None and result.context_revision == 2
    assert api.limitation_codes() == ["AI_DISCOVERY_UNRESOLVED"]


def test_runtime_guard_asks_only_assessed_environment_reachability() -> None:
    api = FakeApi({"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 0})
    dispatcher = FakeDispatcher()
    finding = _ai_finding("SDK_INVOCATION", "AI_RUNTIME_REACHABILITY")
    finding["runtime_guard"] = "ENABLE_AI"

    _boundary(api, dispatcher)._prepare_interview(
        evidence_report=_ai_report("AI_UNKNOWN", [finding]),
        evidence_report_id="ter-guarded",
        assessment_id="assessment-1",
        correlation_id="corr-guarded",
        workflow_run_id="workflow-guarded",
    )

    question = api.seeded[0][1]["activeQuestion"]
    assert question["control"] == "SINGLE_SELECT"
    assert [choice["id"] for choice in question["choices"]] == ["YES", "NO", "UNSURE"]
    assert "ENABLE_AI" in question["prompt"]
    assert "production environment" in question["prompt"]


def test_custom_outbound_candidate_uses_yes_no_unsure_and_stable_identity() -> None:
    api = FakeApi({"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 0})
    dispatcher = FakeDispatcher()
    finding = _ai_finding("OUTBOUND_API", "OUTBOUND_AI_CONFIRMATION")
    report = _ai_report("AI_UNKNOWN", [finding])
    boundary = _boundary(api, dispatcher)

    for _ in range(2):
        boundary._prepare_interview(
            evidence_report=report,
            evidence_report_id="ter-gateway",
            assessment_id="assessment-1",
            correlation_id="corr-gateway",
            workflow_run_id="workflow-gateway",
        )

    first = api.seeded[0][1]["activeQuestion"]
    second = api.seeded[1][1]["activeQuestion"]
    assert first["id"] == second["id"]
    assert [choice["id"] for choice in first["choices"]] == ["YES", "NO", "UNSURE"]
    assert first["choices"][0]["requiresFreeText"] is True
    assert "provider" in first["prompt"]
    assert first["snippetRef"] == finding["snippet_ref"]
    assert "source" not in first
    assert "raw_source" not in first
    assert dispatcher.calls == []


def test_technical_ai_unknown_emits_activity_and_does_not_invent_a_customer_question() -> None:
    api = FakeApi({"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 0})
    dispatcher = FakeDispatcher()
    finding = _ai_finding(
        "PROVIDER_REFERENCE", "TARGETED_TECHNICAL_REANALYSIS", owner="TECHNICAL"
    )

    _boundary(api, dispatcher)._prepare_interview(
        evidence_report=_ai_report("AI_UNKNOWN", [finding]),
        evidence_report_id="ter-provider-ref",
        assessment_id="assessment-1",
        correlation_id="corr-provider-ref",
        workflow_run_id="workflow-provider-ref",
    )

    assert api.limitation_codes() == ["AI_DISCOVERY_UNRESOLVED"]
    # The technical finding is never turned into a deterministic customer AI question.
    assert all(
        "PROVIDER_REFERENCE" not in str(call["instruction"]).split("aiDiscovery")[0]
        for call in dispatcher.calls
    )


def test_unavailable_coverage_fails_closed_before_interview() -> None:
    api = FakeApi({"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 0})
    dispatcher = FakeDispatcher()
    boundary = _boundary(api, dispatcher)
    report = _report()
    report["evidence_payload"]["evidence_graph"]["coverage_state"] = "UNAVAILABLE"

    result = boundary._prepare_interview(
        evidence_report=report,
        evidence_report_id="ter-1",
        assessment_id="assessment-1",
        correlation_id="corr-1",
    )

    assert result is None
    assert dispatcher.calls == []
    assert api.seeded == []
    assert api.limitation_codes() == ["TECHNICAL_COVERAGE_RECOVERY_REQUIRED"]
    assert api.events[0][1]["output_summary"]["coverageState"] == "UNAVAILABLE"


def test_unknown_coverage_fails_closed_before_interview() -> None:
    api = FakeApi({"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 0})
    dispatcher = FakeDispatcher()
    boundary = _boundary(api, dispatcher)
    report = _report()
    report["evidence_payload"]["evidence_graph"]["coverage_state"] = "unknown"

    boundary._prepare_interview(
        evidence_report=report,
        evidence_report_id="ter-1",
        assessment_id="assessment-1",
        correlation_id="corr-unknown",
    )

    assert dispatcher.calls == []
    assert api.seeded == []
    assert api.events[0][1]["output_summary"]["coverageState"] == "UNAVAILABLE"


def test_partial_without_preserved_limitations_fails_closed() -> None:
    api = FakeApi({"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 0})
    dispatcher = FakeDispatcher()
    boundary = _boundary(api, dispatcher)
    report = _report()
    report["evidence_payload"]["evidence_graph"]["coverage_notes"] = []
    report["evidence_payload"]["evidence_graph"]["partialCoveragePolicyDecision"]["limitations"] = []

    boundary._prepare_interview(
        evidence_report=report,
        evidence_report_id="ter-1",
        assessment_id="assessment-1",
        correlation_id="corr-partial-without-limitations",
    )

    assert dispatcher.calls == []
    assert api.seeded == []
    assert api.events[0][1]["output_summary"]["coverageState"] == "PARTIAL"


def test_limited_pge_coverage_normalizes_to_permitted_partial() -> None:
    api = FakeApi({"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 0})
    dispatcher = FakeDispatcher()
    boundary = _boundary(api, dispatcher)
    report = _report()
    report["evidence_payload"]["evidence_graph"]["coverage_state"] = " LIMITED "

    boundary._prepare_interview(
        evidence_report=report,
        evidence_report_id="ter-1",
        assessment_id="assessment-1",
        correlation_id="00000000-0000-0000-0000-000000000002",
        workflow_run_id="10000000-0000-0000-0000-000000000002",
    )

    assert len(dispatcher.calls) == 1
    assert '"coverageState": "PARTIAL"' in dispatcher.calls[0]["instruction"]


def test_guarded_ready_state_is_the_only_initial_path_to_confirmed_context() -> None:
    api = FakeApi(
        {
            "outcome": "CONTEXT_READY",
            "contextRevision": 2,
            "confirmedContext": _structured_context(revision=2),
        }
    )
    dispatcher = FakeDispatcher()
    boundary = _boundary(api, dispatcher)

    result = boundary._prepare_interview(
        evidence_report=_report(),
        evidence_report_id="ter-1",
        assessment_id="assessment-1",
        correlation_id="corr-1",
    )

    assert result is not None
    assert result.context_revision == 2
    assert result.confirmed_statement_refs == ("stmt-decision-authority",)
    assert result.to_legacy_customer_context()["answers"] == {
        "decision_authority": "human approval"
    }
    assert dispatcher.calls == []
    assert api.seeded == []


def test_guarded_ready_state_rejects_plain_confirmed_context() -> None:
    api = FakeApi(
        {
            "outcome": "CONTEXT_READY",
            "contextRevision": 2,
            "confirmedContext": {"decision_authority": "human approval"},
        }
    )
    dispatcher = FakeDispatcher()
    boundary = _boundary(api, dispatcher)

    try:
        boundary._prepare_interview(
            evidence_report=_report(),
            evidence_report_id="ter-1",
            assessment_id="assessment-1",
            correlation_id="corr-1",
        )
    except ValueError as error:
        assert "confirmed structured" in str(error)
    else:
        raise AssertionError("plain dict context must not become Planner authority")


def test_existing_waiting_question_never_reboots_initial_interview() -> None:
    api = FakeApi(
        {
            "outcome": "WAITING_FOR_CUSTOMER",
            "contextRevision": 0,
            "activeQuestion": {"id": "already-waiting"},
        }
    )
    dispatcher = FakeDispatcher()
    boundary = _boundary(api, dispatcher)

    assert (
        boundary._prepare_interview(
            evidence_report=_report(),
            evidence_report_id="ter-1",
            assessment_id="assessment-1",
            correlation_id="corr-1",
        )
        is None
    )
    assert dispatcher.calls == []
    assert api.seeded == []


def test_api_client_posts_ai_not_detected_to_internal_route(monkeypatch) -> None:
    from tools.common.capabilities.platform.api_client import WorkerApiClient

    client = WorkerApiClient("http://api.test", "worker-key")
    calls = []

    def fake_post(path, payload, **kwargs):
        calls.append((path, payload, kwargs))
        return {"assessment_id": "assessment-1", "status": "AI_NOT_DETECTED"}

    monkeypatch.setattr(client, "_post_with_retry", fake_post)

    result = client.post_assessment_ai_not_detected(
        "assessment-1", {"technicalEvidenceReportId": "ter-1"}
    )

    assert result["status"] == "AI_NOT_DETECTED"
    assert calls == [
        (
            "/internal/assessment-interviews/assessment-1/ai-not-detected",
            {"technicalEvidenceReportId": "ter-1"},
            {"redact": False},
        )
    ]


def test_backstop_sdk_references_start_interview_instead_of_parked_reanalysis(tmp_path) -> None:
    """Assessment 7976a135 regression: backstop findings must reach the Customer.

    The scanner claimed AI absence, the deterministic backstop found AI SDKs in
    product code, and routing that to technical recovery parked the pipeline on an
    approval-gated reanalysis that nothing approves. The scanner already failed to
    trace a call, so whether the SDK is used is one bounded Customer question.
    """
    from deepagents.backends import LocalShellBackend

    from tools.common.capabilities.evidence.repository_analysis.analyzer import (
        enforce_ai_absence_backstop,
    )
    from tools.common.capabilities.evidence.repository_analysis.models import (
        RepositoryAnalysisResult,
    )

    (tmp_path / "app.py").write_text("from langchain_openai import ChatOpenAI\n", encoding="utf-8")
    absent = RepositoryAnalysisResult.model_validate(
        {
            "summary": "No AI usage found",
            "coverage_state": "READY",
            "ai_discovery": {"gate": "AI_ABSENT_CONFIRMED", "coverage_state": "READY"},
        }
    )
    discovery = enforce_ai_absence_backstop(
        LocalShellBackend(root_dir=str(tmp_path), virtual_mode=True), absent
    ).ai_discovery.model_dump()
    report = _ai_report("AI_UNKNOWN", discovery["findings"])
    report["evidence_payload"]["ai_discovery"]["material_unresolved_frontiers"] = discovery[
        "material_unresolved_frontiers"
    ]
    api = FakeApi({"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 0})
    dispatcher = FakeDispatcher()

    result = _boundary(api, dispatcher)._prepare_interview(
        evidence_report=report,
        evidence_report_id="ter-1",
        assessment_id="assessment-1",
        correlation_id="corr",
        workflow_run_id="workflow-1",
    )

    assert result is None
    assert dispatcher.calls == []
    assert len(api.seeded) == 1
    question = api.seeded[0][1]["activeQuestion"]
    assert question["control"] == "SINGLE_SELECT"
    assert [choice["id"] for choice in question["choices"]] == ["YES", "NO", "UNSURE"]
    assert "SDK" in question["prompt"]
    assert "outbound API call" not in question["prompt"]
    assert question["frontier"]["owner"] == "CUSTOMER"


def test_finding_snippet_ref_is_bounded_to_the_interview_locator_limit(tmp_path) -> None:
    """Assessment 7976a135 regression: symbol-wide anchors broke the interview handoff.

    Anchors cover whole symbols (lines 30-80), but the Interview contract and the API
    snippet resolver accept at most seven lines, so the copied locator failed schema
    validation and the engineering assessment run errored.
    """
    from deepagents.backends import LocalShellBackend

    from contracts.handoffs import InterviewSnippetRef
    from tools.common.capabilities.evidence.repository_analysis.analyzer import (
        RepositoryDeepAnalyzer,
    )
    from tools.common.capabilities.evidence.repository_analysis.models import (
        RepositoryAnalysisResult,
    )

    (tmp_path / "model_policy.py").write_text("x = 1\n" * 90, encoding="utf-8")
    result = RepositoryAnalysisResult.model_validate(
        {
            "summary": "AI invocation",
            "coverage_state": "READY",
            "source_anchors": [
                {
                    "anchor_id": "anchor-1",
                    "file_path": "model_policy.py",
                    "start_line": 30,
                    "end_line": 80,
                }
            ],
            "ai_discovery": {
                "gate": "AI_CONFIRMED",
                "coverage_state": "READY",
                "findings": [
                    {
                        "evidence_id": "finding-1",
                        "state": "CONFIRMED_AI_CALL",
                        "resolution_state": "OBSERVED",
                        "kind": "SDK_INVOCATION",
                        "anchor_id": "anchor-1",
                    }
                ],
            },
        }
    )

    payload = RepositoryDeepAnalyzer._evidence_payload(
        LocalShellBackend(root_dir=str(tmp_path), virtual_mode=True),
        result,
        snapshot_id="snapshot-1",
        commit_sha="abc123",
        scan_job_id="scan-1",
    )

    snippet_ref = payload["ai_discovery"]["findings"][0]["snippet_ref"]
    assert (snippet_ref["start_line"], snippet_ref["end_line"]) == (30, 36)
    InterviewSnippetRef.model_validate(snippet_ref)


def test_inexact_evidence_ref_gets_one_specialist_correction_never_a_substitute() -> None:
    source_ref = "packages/api/src/features/ai/service.ts"

    class CorrectingDispatcher(FakeDispatcher):
        def dispatch(self, **kwargs):
            result = super().dispatch(**kwargs)
            question = result["handoff"]["activeQuestion"]
            if len(self.calls) == 1:
                # Authorized by the turn ledger (tool-visible) but not persistable.
                question["whyEvidenceRefs"] = [source_ref]
                question["frontier"]["evidenceRefs"] = ["ev-agent-loop"]
            else:
                question["whyEvidenceRefs"] = ["node-ref-1"]
                question["frontier"]["evidenceRefs"] = ["node-ref-1"]
            return result

    api = FakeApi({"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 0, "answerHistory": []})
    report = _report()
    report["evidence_payload"]["evidence_graph"]["nodes"] = [{"evidence_refs": ["node-ref-1"]}]
    report["evidence_payload"]["findings"] = [{"evidence_refs": [source_ref]}]
    dispatcher = CorrectingDispatcher()

    result = _boundary(api, dispatcher)._prepare_interview(
        evidence_report=report,
        evidence_report_id="ter-1",
        assessment_id="assessment-1",
        correlation_id="00000000-0000-0000-0000-000000000001",
        workflow_run_id="10000000-0000-0000-0000-000000000001",
    )

    assert result is None
    first, correction = dispatcher.calls
    assert '"node-ref-1"' in first["instruction"]
    assert source_ref not in first["instruction"]
    assert correction["idempotency_key"].endswith(":schema-correction:1")
    assert "ev-agent-loop" in correction["instruction"]
    assert source_ref in correction["instruction"]
    assert len(api.seeded) == 1
    question = api.seeded[0][1]["activeQuestion"]
    # The specialist's corrected refs are persisted verbatim; nothing substituted.
    assert question["whyEvidenceRefs"] == ["node-ref-1"]
    assert question["frontier"]["evidenceRefs"] == ["node-ref-1"]


def test_repeated_inexact_evidence_ref_fails_closed() -> None:
    from orchestration.result_validation import SpecialistHandoffValidationError

    class FabricatingDispatcher(FakeDispatcher):
        def dispatch(self, **kwargs):
            result = super().dispatch(**kwargs)
            result["handoff"]["activeQuestion"]["frontier"]["evidenceRefs"] = ["ev-agent-loop"]
            return result

    api = FakeApi({"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 0, "answerHistory": []})
    dispatcher = FabricatingDispatcher()

    with pytest.raises(SpecialistHandoffValidationError, match="ev-agent-loop"):
        _boundary(api, dispatcher)._prepare_interview(**_initial_interview_kwargs())

    assert len(dispatcher.calls) == 2
    assert api.seeded == []


def _initial_interview_kwargs():
    return {
        "evidence_report": _report(),
        "evidence_report_id": "ter-1",
        "assessment_id": "assessment-1",
        "correlation_id": "00000000-0000-0000-0000-000000000001",
        "workflow_run_id": "10000000-0000-0000-0000-000000000001",
    }


def test_missing_initial_handoff_gets_one_bounded_schema_correction() -> None:
    from orchestration.result_validation import SpecialistHandoffValidationError

    class FlakyDispatcher(FakeDispatcher):
        def dispatch(self, **kwargs):
            if not self.calls:
                self.calls.append(kwargs)
                raise SpecialistHandoffValidationError(
                    "interview did not return a structured_response handoff"
                )
            return super().dispatch(**kwargs)

    api = FakeApi({"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 0, "answerHistory": []})
    dispatcher = FlakyDispatcher()

    assert _boundary(api, dispatcher)._prepare_interview(**_initial_interview_kwargs()) is None

    first, repair = dispatcher.calls
    assert repair["idempotency_key"] == f"{first['idempotency_key']}:schema-correction:1"
    assert repair["instruction"].startswith(first["instruction"])
    assert "INTERVIEW_HANDOFF_SCHEMA_VIOLATION" in repair["instruction"]
    assert "did not return a structured_response handoff" in repair["instruction"]
    assert "INTERVIEW_HANDOFF_SCHEMA_VIOLATION" not in first["instruction"]
    assert len(api.seeded) == 1


def test_second_initial_handoff_violation_propagates() -> None:
    from orchestration.result_validation import SpecialistHandoffValidationError

    class BrokenDispatcher(FakeDispatcher):
        def dispatch(self, **kwargs):
            self.calls.append(kwargs)
            raise SpecialistHandoffValidationError(
                "interview did not return a structured_response handoff"
            )

    api = FakeApi({"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 0, "answerHistory": []})
    dispatcher = BrokenDispatcher()

    with pytest.raises(SpecialistHandoffValidationError):
        _boundary(api, dispatcher)._prepare_interview(**_initial_interview_kwargs())

    assert len(dispatcher.calls) == 2
    assert api.seeded == []


def test_persistable_refs_mirror_the_api_governed_evidence_refs() -> None:
    from tools.common.capabilities.assessment.investigation.engineering_rule.interview_gated_boundary import (
        _persistable_evidence_refs,
    )

    report = {
        "snapshot_id": "snap-1",
        "evidence_payload": {
            "evidence_refs": ["payload-ref"],
            "findings": [{"evidence_refs": ["finding-only-ref"]}],
            "evidence_graph": {
                "evidenceRefs": ["graph-ref"],
                "nodes": [{"evidence_refs": ["node-ref"]}, {"evidenceRefs": ["node-camel-ref"]}],
                "edges": [{"evidence_refs": ["edge-ref", ""]}],
            },
        },
    }

    assert _persistable_evidence_refs(report, "ter-1") == {
        "technicalEvidenceReport:ter-1",
        "repositorySnapshot:snap-1",
        "interviewRuntime:assessment-interview-runtime-v1",
        "payload-ref",
        "graph-ref",
        "node-ref",
        "node-camel-ref",
        "edge-ref",
    }


# UC-M04-01 A1 / CODE-M04-04: optional-question initial decision.
class ReadyDispatcher(FakeDispatcher):
    def dispatch(self, **kwargs):
        self.calls.append(kwargs)
        from contracts.handoffs import InterviewResult
        candidate = InterviewResult.model_validate({
            "expectedContextRevision": 2,
            "mode": "INITIAL_INTERVIEW", "outcome": "CONTEXT_READY",
            "contextAuthority": None, "confirmedContext": {"statements": []},
        })
        return {"status": "COMPLETED", "handoff": candidate.model_dump(mode="json")}


class SavingReadyApi(FakeApi):
    def post_interview_initial_question(self, assessment_id, payload):
        self.seeded.append((assessment_id, dict(payload)))
        # Only API-owned stored context, not proposed model facts, is returned.
        self.state = {**self.state, "outcome": "CONTEXT_READY", "activeQuestion": None}
        return dict(self.state)


def _existing_initial_context_state():
    context = _structured_context(revision=2)
    context["statements"][0]["statement"] = (
        "The AI drafts recommendations for customer onboarding. A human reviews and approves "
        "each action affecting customers, using customer profile records and business documents."
    )
    return {"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 2,
            "confirmedContext": context, "orchestrationRequested": False,
            "answerHistory": []}


def _prepare_existing(api, dispatcher, report=None):
    return _boundary(api, dispatcher)._prepare_interview(
        evidence_report=report or _report(), evidence_report_id="ter-1",
        assessment_id="assessment-1", correlation_id="corr-zero-question",
        workflow_run_id="10000000-0000-4000-8000-000000000004",
    )


def test_zero_question_initial_persists_ready_without_a_synthetic_answer():
    api = SavingReadyApi(_existing_initial_context_state())
    dispatcher = ReadyDispatcher()
    context = _prepare_existing(api, dispatcher)
    assert context.context_revision == 2
    assert len(api.seeded) == 1
    payload = api.seeded[0][1]
    assert payload["outcome"] == "CONTEXT_READY"
    assert payload["expectedContextRevision"] == 2
    assert "activeQuestion" not in payload
    assert "answer" not in payload
    assert "confirmedContext" not in payload
    assert api.state["answerHistory"] == []
    instruction = dispatcher.calls[0]["instruction"]
    assert "no minimum question count" in instruction
    assert "currentConfirmedBusinessContext" in instruction
    assert "human reviews" in instruction
    assert dispatcher.calls[0]["idempotency_key"].endswith(":context:2")


def test_zero_question_initial_handle_continues_engineering_only_with_saved_context(monkeypatch):
    api = SavingReadyApi(_existing_initial_context_state())
    api.get_accepted_technical_evidence_report = lambda _id: _report()
    boundary = _boundary(api, ReadyDispatcher())
    seen = []
    def run(message, correlation, *, confirmed_context, rule_scope=None):
        assert api.seeded and api.state["outcome"] == "CONTEXT_READY"
        seen.append(confirmed_context.context_revision)
    monkeypatch.setattr(boundary, "run_assessment", run)
    boundary.handle({"assessmentId": "assessment-1", "evidenceReportId": "ter-1",
                     "workflowRunId": "10000000-0000-4000-8000-000000000004"}, "corr-ready")
    assert seen == [2]


def test_existing_context_is_considered_before_asking_discovery_question_again():
    api = SavingReadyApi(_existing_initial_context_state())
    dispatcher = ReadyDispatcher()
    finding = _ai_finding("MODEL_INVOCATION", "AI_PURPOSE_FEATURE_MAPPING")
    result = _prepare_existing(api, dispatcher, _ai_report("AI_PRESENT_CONFIRMED", [finding]))
    assert result is not None
    assert len(dispatcher.calls) == 1
    assert "activeQuestion" not in api.seeded[0][1]


def test_existing_context_can_still_need_one_focused_question():
    api = FakeApi(_existing_initial_context_state())
    assert _prepare_existing(api, FakeDispatcher()) is None
    assert api.seeded[0][1]["outcome"] == "WAITING_FOR_CUSTOMER"
    assert api.seeded[0][1]["expectedContextRevision"] == 2
    assert api.seeded[0][1]["activeQuestion"]["id"] == "question-1"


def test_model_cannot_skip_questions_using_technical_evidence_as_customer_authority():
    api = FakeApi({"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 0})
    with pytest.raises(SpecialistHandoffValidationError, match="Customer-confirmed context"):
        _prepare_existing(api, ReadyDispatcher())
    assert api.seeded == []


@pytest.mark.parametrize("changes", [
    {"activeQuestion": {"id": "unexpected"}},
    {"contextUpdates": [{"statement": "invented business fact"}]},
    {"unresolved": [{"topic": "human approval"}]},
    {"confirmedContext": {"statements": [{"statement": "invented"}]}},
])
def test_zero_question_handoff_rejects_invented_or_unresolved_context(changes):
    class InvalidReady(ReadyDispatcher):
        def dispatch(self, **kwargs):
            result = super().dispatch(**kwargs)
            result["handoff"].update(changes)
            return result
    api = SavingReadyApi(_existing_initial_context_state())
    with pytest.raises(SpecialistHandoffValidationError):
        _prepare_existing(api, InvalidReady())
    assert api.seeded == []


def test_zero_question_initial_does_not_continue_when_persistence_fails():
    api = SavingReadyApi(_existing_initial_context_state())
    def reject(*_args):
        raise WorkerCallbackError("stale context", status_code=409)
    api.post_interview_initial_question = reject
    with pytest.raises(WorkerCallbackError):
        _prepare_existing(api, ReadyDispatcher())


def test_zero_question_initial_checks_server_returned_revision():
    api = SavingReadyApi(_existing_initial_context_state())
    api.post_interview_initial_question = lambda *_args: {
        **api.state, "outcome": "CONTEXT_READY", "contextRevision": 3,
    }
    with pytest.raises(ValueError, match="different context revision"):
        _prepare_existing(api, ReadyDispatcher())


def test_existing_context_does_not_interrupt_a_pending_agent_turn():
    api = SavingReadyApi({**_existing_initial_context_state(), "orchestrationRequested": True})
    dispatcher = ReadyDispatcher()
    assert _prepare_existing(api, dispatcher) is None
    assert dispatcher.calls == [] and api.seeded == []


def test_zero_question_initial_accepts_the_actual_typed_handoff_defaults():
    dispatcher = ReadyDispatcher()
    api = SavingReadyApi(_existing_initial_context_state())
    result = _prepare_existing(api, dispatcher)
    assert result is not None and result.context_revision == 2
    assert api.state["confirmedContext"] == _existing_initial_context_state()["confirmedContext"]
    assert len(dispatcher.calls) == 1
