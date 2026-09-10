from __future__ import annotations

from types import SimpleNamespace
import pytest

from tools.common.capabilities.assessment.investigation.engineering_rule.interview_gated_boundary import (
    InterviewGatedEngineeringAssessmentBoundary,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.managed_targeted_investigator import (
    ManagedTargetedInvestigatorPipeline,
)
from tools.common.capabilities.managed.boundary import NonRetryableAgentBoundaryError
from tools.common.capabilities.platform.api_client import WorkerCallbackError


class FakeApi:
    def __init__(self, state):
        self.state = state
        self.seeded = []

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


class RecordingRoot:
    def __init__(self) -> None:
        self.calls = []

    def invoke(self, payload, config=None):
        self.calls.append((payload, config))
        return {"status": "ROOT_REENTERED"}


class NoopPipeline:
    def run(self, **kwargs):
        raise AssertionError("pipeline must not run during Initial Interview bootstrap")


class NoopWorkspace:
    def cleanup(self, _job_id):
        return None


def _boundary(api, dispatcher, recovery_root=None):
    return InterviewGatedEngineeringAssessmentBoundary(
        SimpleNamespace(),
        api_client=api,
        interview_dispatcher=dispatcher,
        recovery_root=recovery_root,
        investigation_pipeline=NoopPipeline(),
        snapshot_client=SimpleNamespace(),
        code_workspace=NoopWorkspace(),
        triage_trigger_publisher=lambda _payload: None,
    )


def _report():
    return {
        "assessment_id": "assessment-1",
        "snapshot_id": "snapshot-1",
        "schema_version": "2.0.0",
        "user_id": "user-test-owner",
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
    root = RecordingRoot()
    report = _report()
    report["evidence_payload"]["evidence_graph"]["partialCoveragePolicyDecision"] = invalid_policy
    _boundary(api, dispatcher, root)._prepare_interview(
        evidence_report=report, evidence_report_id="ter-1",
        assessment_id="assessment-1", correlation_id="corr",
    )
    assert dispatcher.calls == []
    assert api.seeded == []
    assert len(root.calls) == 1


def test_coverage_callback_rejection_routes_to_recovery(monkeypatch):
    from tools.common.capabilities.platform.api_client import InterviewCoverageCallbackError
    api = FakeApi({"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 0})
    def reject(*args):
        raise InterviewCoverageCallbackError("coverage changed")
    monkeypatch.setattr(api, "post_interview_initial_question", reject)
    dispatcher = FakeDispatcher()
    root = RecordingRoot()
    _boundary(api, dispatcher, root)._prepare_interview(
        evidence_report=_report(), evidence_report_id="ter-1",
        assessment_id="assessment-1", correlation_id="corr",
        workflow_run_id="workflow-1",
    )
    assert len(dispatcher.calls) == 1
    assert len(root.calls) == 1
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


def test_default_production_pipeline_uses_managed_targeted_investigator_bridge() -> None:
    boundary = InterviewGatedEngineeringAssessmentBoundary(
        SimpleNamespace(
            langgraph_checkpoint_database_url="postgresql://lcsp:lcsp@db/lcsp"
        ),
        api_client=FakeApi({"outcome": "CONTEXT_READY", "contextRevision": 1}),
        snapshot_client=SimpleNamespace(),
        code_workspace=NoopWorkspace(),
        triage_trigger_publisher=lambda _payload: None,
    )

    assert isinstance(boundary._pipeline, ManagedTargetedInvestigatorPipeline)
    assert boundary._pipeline._delegate.__class__.__name__ == "PlannedEngineeringInvestigationPipeline"


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


def test_unavailable_coverage_routes_to_orchestration_before_interview() -> None:
    api = FakeApi({"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 0})
    dispatcher = FakeDispatcher()
    root = RecordingRoot()
    boundary = _boundary(api, dispatcher, recovery_root=root)
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
    assert len(root.calls) == 1
    assert (
        root.calls[0][1]["metadata"]["trigger"]
        == "TECHNICAL_COVERAGE_RECOVERY_REQUIRED"
    )
    assert "Do not enter Initial Interview" in root.calls[0][0]["messages"][0]["content"]


def test_unknown_coverage_routes_to_recovery_before_interview() -> None:
    api = FakeApi({"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 0})
    dispatcher = FakeDispatcher()
    root = RecordingRoot()
    boundary = _boundary(api, dispatcher, recovery_root=root)
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
    assert root.calls[0][1]["metadata"]["trigger"] == "TECHNICAL_COVERAGE_RECOVERY_REQUIRED"
    assert "Coverage state: UNAVAILABLE" in root.calls[0][0]["messages"][0]["content"]


def test_partial_without_preserved_limitations_routes_to_recovery() -> None:
    api = FakeApi({"outcome": "WAITING_FOR_CUSTOMER", "contextRevision": 0})
    dispatcher = FakeDispatcher()
    root = RecordingRoot()
    boundary = _boundary(api, dispatcher, recovery_root=root)
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
    assert "Coverage state: PARTIAL" in root.calls[0][0]["messages"][0]["content"]


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
