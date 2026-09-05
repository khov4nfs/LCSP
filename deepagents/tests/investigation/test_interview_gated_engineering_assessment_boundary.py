from __future__ import annotations

from types import SimpleNamespace

from tools.common.capabilities.assessment.investigation.engineering_rule.interview_gated_boundary import (
    InterviewGatedEngineeringAssessmentBoundary,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.managed_targeted_investigator import (
    ManagedTargetedInvestigatorPipeline,
)


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
        "evidence_payload": {
            "evidence_graph": {
                "coverage_state": "PARTIAL",
                "coverage_notes": ["dynamic configuration not fully observed"],
            }
        },
    }


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
        correlation_id="corr-1",
    )

    assert result is None
    assert len(dispatcher.calls) == 1
    instruction = dispatcher.calls[0]["instruction"]
    assert "INITIAL_INTERVIEW" in instruction
    assert "PARTIAL" in instruction
    assert "Missing technical evidence is not proof" in instruction
    assert api.seeded[0][0] == "assessment-1"
    assert api.seeded[0][1]["outcome"] == "WAITING_FOR_CUSTOMER"


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
        == "TECHNICAL_COVERAGE_UNAVAILABLE_RECOVERY"
    )
    assert "Do not enter Initial Interview" in root.calls[0][0]["messages"][0]["content"]


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
