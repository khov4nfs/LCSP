from types import SimpleNamespace

import pytest

from tools.common.capabilities.workflow.recovery.interview_boundary import (
    AssessmentInterviewResumeBoundary,
)
from tools.common.capabilities.workflow.recovery.post_guard_continuation import (
    EphemeralPostGuardContinuationStore,
)


def _confirmed_context() -> dict:
    return {
        "assessmentId": "assessment-1",
        "contextRevision": 2,
        "authority": "CUSTOMER_CONFIRMED_CONFIRMED_ONLY",
        "statements": [
            {
                "statementId": "stmt-decision-authority",
                "topic": "decision_authority",
                "statement": "human",
                "normalizedValue": "human",
                "scope": {"needId": "need-1"},
                "evidenceRefs": ["evidence:customer:1"],
                "respondentRef": "actor:authenticated:1",
                "createdAt": "2026-09-05T00:00:00Z",
                "source": "CUSTOMER_CONFIRMED",
                "resolutionState": "CONFIRMED",
            }
        ],
        "limitations": ["customer-confirmed current statements only"],
        "sourceVersionRef": "snapshot-1:abc",
        "pgeVersion": "ter-1:v1",
        "guidanceVersion": "guidance-1",
    }


READY_HANDOFF = {
    "mode": "INITIAL_INTERVIEW",
    "outcome": "CONTEXT_READY",
    "contextAuthority": "CONFIRMED",
    "confirmedContext": {"decision_authority": "human"},
    "flags": [],
    "blockedActions": [],
    "targetedResolution": {},
}

TARGETED_RESOLVED_HANDOFF = {
    "mode": "TARGETED_INTERVIEW",
    "outcome": "CONTEXT_RESOLVED",
    "contextAuthority": "CONFIRMED",
    "confirmedContext": _confirmed_context(),
    "flags": [],
    "blockedActions": [],
    "targetedResolution": {},
}

CONTINUATION = {
    "originatingInvestigationReference": "investigator:exec-17:need-1",
    "investigatorExecutionId": "exec-17",
    "workflowRunId": "investigator:exec-17",
    "checkpointId": "checkpoint-original",
    "affectedRuleIds": ["ENG-1"],
    "artifactVersions": {
        "technicalEvidenceReportId": "ter-1",
        "repositorySnapshotId": "snapshot-1",
        "legalRuleCatalogVersionId": "catalog-1",
        "legalCorpusVersionId": "corpus-1",
    },
    "sourceVersion": "snapshot-1:abc",
    "pgeVersion": "ter-1:v1",
}

def _message(*, targeted: bool = False) -> dict:
    return {
        "assessmentId": "assessment-1",
        "threadId": "interview:assessment-1",
        "questionId": "need-1" if targeted else "question-1",
        "contextRevision": 2,
        "sourceVersion": "snapshot-1:abc",
        "pgeVersion": "ter-1:v1",
        "resumeReason": (
            "TARGETED_INTERVIEW_REQUIRED"
            if targeted
            else "INTERVIEW_AGENT_DECISION_REQUIRED"
        ),
    }


class RecordingDispatcher:
    def __init__(self, handoff: dict) -> None:
        self.handoff = handoff
        self.calls: list[dict] = []

    def dispatch(self, **kwargs):
        self.calls.append(kwargs)
        return {"status": "COMPLETED", "handoff": dict(self.handoff)}


class MutableApi:
    def __init__(self, *, targeted: bool = False) -> None:
        self.status = "CURRENT"
        self.targeted = targeted
        self.public_state: dict = {
            "outcome": "WAITING_FOR_CUSTOMER",
            "contextRevision": 2,
            "orchestrationRequested": True,
        }
        self.decision_result: dict = {"outcome": "CONTEXT_READY"}
        self.decision_posts: list[dict] = []

    def get_interview_private_context(self, *args, **kwargs):
        _ = (args, kwargs)
        result = {
            "status": self.status,
            "threadId": "interview:assessment-1",
            "sourceVersion": "snapshot-1:abc",
            "pgeVersion": "ter-1:v1",
            "publicState": dict(self.public_state),
            "privateRevision": {"answer": {"freeText": "private customer context"}},
        }
        if self.targeted:
            result["targetedNeed"] = {
                "needId": "need-1",
                "businessContextNeed": "Who approves this decision?",
                "resolutionCriteria": ["decision_authority"],
                "originatingInvestigationReference": CONTINUATION[
                    "originatingInvestigationReference"
                ],
            }
        return result

    def post_interview_agent_decision(self, assessment_id, payload):
        _ = assessment_id
        self.decision_posts.append(dict(payload))
        return dict(self.decision_result)


def test_context_ready_crash_after_guard_retries_without_interview_model() -> None:
    store = EphemeralPostGuardContinuationStore()
    api = MutableApi()
    dispatcher = RecordingDispatcher(READY_HANDOFF)
    downstream_calls: list[str] = []

    def crashing_downstream(_payload, _correlation_id):
        downstream_calls.append("crash")
        raise RuntimeError("worker crashed after guarded persistence")

    first = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        api_client=api,
        dispatcher=dispatcher,
        downstream_handler=crashing_downstream,
        continuation_store=store,
    )

    with pytest.raises(RuntimeError, match="worker crashed"):
        first.handle(_message(), "corr-1")

    pending = store.get(
        assessment_id="assessment-1",
        context_revision=2,
        outcome="CONTEXT_READY",
    )
    assert pending is not None and not pending.completed
    assert len(dispatcher.calls) == 1
    assert len(api.decision_posts) == 1

    api.status = "DUPLICATE"
    api.public_state = {
        "outcome": "CONTEXT_READY",
        "contextRevision": 2,
        "orchestrationRequested": False,
        "confirmedContext": _confirmed_context(),
    }

    def successful_downstream(_payload, _correlation_id):
        downstream_calls.append("success")

    retry = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        api_client=api,
        dispatcher=dispatcher,
        downstream_handler=successful_downstream,
        continuation_store=store,
    )
    retry.handle(_message(), "corr-2")

    completed = store.get(
        assessment_id="assessment-1",
        context_revision=2,
        outcome="CONTEXT_READY",
    )
    assert completed is not None and completed.completed
    assert downstream_calls == ["crash", "success"]
    assert len(dispatcher.calls) == 1
    assert len(api.decision_posts) == 1

    # A broker duplicate after durable completion is a true no-op.
    retry.handle(_message(), "corr-3")
    assert downstream_calls == ["crash", "success"]
    assert len(dispatcher.calls) == 1


def test_context_resolved_crash_retries_exact_continuation_without_interview_model() -> None:
    store = EphemeralPostGuardContinuationStore()
    api = MutableApi(targeted=True)
    api.decision_result = {
        "outcome": "CONTEXT_RESOLVED",
        "confirmedContext": _confirmed_context(),
        "continuation": dict(CONTINUATION),
        "flags": [],
    }
    dispatcher = RecordingDispatcher(TARGETED_RESOLVED_HANDOFF)
    resume_calls: list[str] = []
    completion_calls: list[str] = []

    def exact_resumer(**_kwargs):
        resume_calls.append("resume")
        return {
            "executionId": "exec-17",
            "threadId": "investigator:exec-17",
            "fromCheckpointId": "checkpoint-original",
            "checkpointId": f"checkpoint-{len(resume_calls)}",
            "handoff": {"status": "READY"},
        }

    def crashing_completer(**_kwargs):
        completion_calls.append("crash")
        raise RuntimeError("crash before continuation ACK")

    first = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        api_client=api,
        dispatcher=dispatcher,
        investigator_resumer=exact_resumer,
        investigation_completer=crashing_completer,
        continuation_store=store,
    )

    with pytest.raises(RuntimeError, match="crash before continuation ACK"):
        first.handle(_message(targeted=True), "corr-1")

    pending = store.get(
        assessment_id="assessment-1",
        context_revision=2,
        outcome="CONTEXT_RESOLVED",
    )
    assert pending is not None and not pending.completed
    assert pending.payload["continuation"]["investigatorExecutionId"] == "exec-17"
    assert len(dispatcher.calls) == 1

    api.status = "DUPLICATE"
    api.public_state = {
        "outcome": "CONTEXT_RESOLVED",
        "contextRevision": 2,
        "orchestrationRequested": False,
        "confirmedContext": _confirmed_context(),
        "flags": [],
    }

    def successful_completer(**_kwargs):
        completion_calls.append("success")

    retry = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        api_client=api,
        dispatcher=dispatcher,
        investigator_resumer=exact_resumer,
        investigation_completer=successful_completer,
        continuation_store=store,
    )
    retry.handle(_message(targeted=True), "corr-2")

    completed = store.get(
        assessment_id="assessment-1",
        context_revision=2,
        outcome="CONTEXT_RESOLVED",
    )
    assert completed is not None and completed.completed
    assert completion_calls == ["crash", "success"]
    assert resume_calls == ["resume", "resume"]
    assert len(dispatcher.calls) == 1
    assert len(api.decision_posts) == 1


def test_downstream_impact_is_orchestration_owned_and_skips_exact_resume() -> None:
    store = EphemeralPostGuardContinuationStore()
    api = MutableApi(targeted=True)
    api.decision_result = {
        "outcome": "CONTEXT_RESOLVED",
        "confirmedContext": _confirmed_context(),
        "continuation": dict(CONTINUATION),
        "flags": ["DOWNSTREAM_IMPACT"],
    }
    dispatcher = RecordingDispatcher(
        {**TARGETED_RESOLVED_HANDOFF, "flags": ["DOWNSTREAM_IMPACT"]}
    )
    impact_calls: list[dict] = []

    def forbidden_exact_resume(**_kwargs):
        raise AssertionError("DOWNSTREAM_IMPACT must not exact-resume the old Investigator")

    def impact_handler(**kwargs):
        impact_calls.append(kwargs)

    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        api_client=api,
        dispatcher=dispatcher,
        investigator_resumer=forbidden_exact_resume,
        downstream_impact_handler=impact_handler,
        continuation_store=store,
    )
    boundary.handle(_message(targeted=True), "corr-impact")

    assert len(impact_calls) == 1
    assert impact_calls[0]["continuation"]["affectedRuleIds"] == ["ENG-1"]
    assert impact_calls[0]["confirmed_context"].context_revision == 2
    assert impact_calls[0]["confirmed_context"].to_legacy_customer_context()[
        "answers"
    ] == {"decision_authority": "human"}
    completed = store.get(
        assessment_id="assessment-1",
        context_revision=2,
        outcome="CONTEXT_RESOLVED",
    )
    assert completed is not None and completed.completed
