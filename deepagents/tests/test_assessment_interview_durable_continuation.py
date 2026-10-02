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
                "evidenceRefs": ["technicalEvidenceReport:ter-1"],
                "respondentRef": "actor:authenticated:1",
                "createdAt": "2026-09-05T00:00:00Z",
                "source": "CUSTOMER_CONFIRMED",
                "resolutionState": "CONFIRMED",
                "sourceNeedId": "need-1",
                "resolvedCriterionIds": ["CONTROL"],
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
    # Initial CONTEXT_READY must carry the minimum planning context.
    "confirmedContext": {
        "statements": [
            {
                "statementId": "stmt-initial-planning",
                "topic": "initial_planning_context",
                "statement": (
                    "The AI model drafts recommendations in the customer onboarding "
                    "workflow; a human reviewer approves every customer-facing action "
                    "before any status update, affected subjects are customers, and "
                    "material data sources are customer profile records and "
                    "repository code."
                ),
            }
        ]
    },
    "flags": [],
    "blockedActions": [],
    "targetedResolution": {},
}

TARGETED_RESOLVED_HANDOFF = {
    "mode": "BUSINESS_CONTEXT_RESOLUTION",
    "outcome": "CONTEXT_RESOLVED",
    "contextAuthority": "CONFIRMED",
    "confirmedContext": _confirmed_context(),
    "flags": [],
    "blockedActions": [],
    "targetedResolution": {},
}

CONTINUATION = {
    "needId": "need-1",
    "engineeringRuleId": "ENG-1",
    "criterionId": "CONTROL",
    "resolutionCriterionIds": ["CONTROL"],
    "sourceVersion": "snapshot-1:abc",
    "pgeVersion": "ter-1:v1",
}

def _message(*, targeted: bool = False) -> dict:
    return {
        "assessmentId": "assessment-1",
        "threadId": "interview:assessment-1",
        "workflowRunId": "c0000000-0000-0000-0000-000000000001",
        "authenticatedActorId": "user-actor-test",
        "questionId": "need-1" if targeted else "question-1",
        "contextRevision": 2,
        "sourceVersion": "snapshot-1:abc",
        "pgeVersion": "ter-1:v1",
        "resumeReason": (
            "BUSINESS_CONTEXT_RESOLUTION_REQUIRED"
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
            "workflowRunId": "c0000000-0000-0000-0000-000000000001",
            "authenticatedActorId": "user-actor-test",
            "actorId": "user-actor-test",
            "sourceVersion": "snapshot-1:abc",
            "pgeVersion": "ter-1:v1",
            "technicalCoverageState": "READY",
            "coverageLimitations": [],
            "publicState": dict(self.public_state),
            "confirmedContext": getattr(self, "confirmed_context", None),
            "rootWorkflowRunId": "c0000000-0000-0000-0000-000000000001",
            # Pre-existing gap (predates lcsp-tighten-direct-lossless.md): this
            # fixture lacked questionIntent/questionControl entirely, so it was
            # already never directLossless under either the old or the tightened
            # _authority_provenance mirror. These tests are about crash/retry
            # mechanics, not authority provenance, so use a genuinely
            # non-interpretive direct-ASK answer (predefined choice, no comment).
            "privateRevision": {
                "actorId": "user-actor-test",
                "questionIntent": "ASK",
                "questionControl": "BOOLEAN",
                "answer": {"selectedChoiceIds": ["yes"]},
            },
        }
        if self.targeted:
            result["targetedNeed"] = {
                "needId": "need-1",
                "engineeringRuleId": "ENG-1",
                "criterionId": "CONTROL",
                "resolutionCriterionIds": ["CONTROL"],
                "actorId": "user-actor-test",
                "businessContextNeed": "Who approves this decision?",
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
    # Root cause: the old test retried an investigator exact-resume
    # (investigator_resumer/investigation_completer) for a deleted pipeline.
    # Fix: the new durable path is guard + EphemeralPostGuardContinuationStore +
    # downstream_handler. A crash after the guard leaves PENDING with the
    # server-owned continuation; the DUPLICATE retry reuses the stored
    # continuation without a new Interview model turn, then COMPLETES.
    store = EphemeralPostGuardContinuationStore()
    api = MutableApi(targeted=True)
    api.decision_result = {
        "outcome": "CONTEXT_RESOLVED",
        "confirmedContext": _confirmed_context(),
        "continuation": dict(CONTINUATION),
        "flags": [],
    }
    dispatcher = RecordingDispatcher(TARGETED_RESOLVED_HANDOFF)
    downstream_calls: list[str] = []

    def crashing_downstream(_payload, _correlation_id):
        downstream_calls.append("crash")
        raise RuntimeError("crash before continuation ACK")

    first = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        api_client=api,
        dispatcher=dispatcher,
        downstream_handler=crashing_downstream,
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
    assert pending.payload["continuation"]["needId"] == "need-1"
    assert pending.payload["continuation"]["engineeringRuleId"] == "ENG-1"
    assert len(dispatcher.calls) == 1

    api.status = "DUPLICATE"
    api.public_state = {
        "outcome": "CONTEXT_RESOLVED",
        "contextRevision": 2,
        "orchestrationRequested": False,
        "flags": [],
    }
    api.confirmed_context = _confirmed_context()

    def successful_downstream(_payload, _correlation_id):
        downstream_calls.append("success")

    retry = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        api_client=api,
        dispatcher=dispatcher,
        downstream_handler=successful_downstream,
        continuation_store=store,
    )
    retry.handle(_message(targeted=True), "corr-2")

    completed = store.get(
        assessment_id="assessment-1",
        context_revision=2,
        outcome="CONTEXT_RESOLVED",
    )
    assert completed is not None and completed.completed
    assert downstream_calls == ["crash", "success"]
    assert len(dispatcher.calls) == 1
    assert len(api.decision_posts) == 1


def test_downstream_impact_is_orchestration_owned_and_skips_exact_resume() -> None:
    # Root cause: the old test asserted a deleted downstream_impact_handler vs
    # investigator_resumer split for the deleted investigator pipeline.
    # Fix: DOWNSTREAM_IMPACT is now an orchestration-owned flag on the guarded
    # CONTEXT_RESOLVED state. The boundary forwards it via downstream_handler
    # (no exact investigator resume exists); the per-rule loop would resume
    # unscoped (rule_scope=None) so every landed answer is resumed, otherwise
    # only the bound rule. Strict binding still applies.
    from tools.common.capabilities.workflow.recovery.interview_boundary import (
        _bind_answer_to_need,
        _has_downstream_impact,
    )
    from tools.common.capabilities.assessment.planning.engineering_rule.confirmed_business_context import (
        normalize_confirmed_structured_business_context,
    )

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
    downstream_calls: list[tuple[dict, str]] = []

    def downstream(payload, correlation_id):
        downstream_calls.append((payload, correlation_id))

    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        api_client=api,
        dispatcher=dispatcher,
        downstream_handler=downstream,
        continuation_store=store,
    )
    boundary.handle(_message(targeted=True), "corr-impact")

    assert len(downstream_calls) == 1
    payload, _corr = downstream_calls[0]
    assert payload["outcome"] == "CONTEXT_RESOLVED"
    assert "DOWNSTREAM_IMPACT" in payload["flags"]
    assert _has_downstream_impact({"flags": ["DOWNSTREAM_IMPACT"]}) is True
    assert _has_downstream_impact({"flags": []}) is False
    # Orchestration-owned: unscoped resume when impacted, else scoped to the
    # single bound rule.
    assert (None if _has_downstream_impact({"flags": payload["flags"]}) else ("ENG-1",)) is None
    assert (None if _has_downstream_impact({"flags": []}) else ("ENG-1",)) == ("ENG-1",)
    # Strict binding still holds for the impacted answer.
    typed = normalize_confirmed_structured_business_context(
        {
            "outcome": "CONTEXT_RESOLVED",
            "contextRevision": 2,
            "confirmedContext": _confirmed_context(),
        },
        assessment_id="assessment-1",
    )
    assert typed.to_legacy_customer_context()["answers"] == {
        "decision_authority": "human"
    }
    assert _bind_answer_to_need(dict(CONTINUATION), typed) == "ENG-1"
    completed = store.get(
        assessment_id="assessment-1",
        context_revision=2,
        outcome="CONTEXT_RESOLVED",
    )
    assert completed is not None and completed.completed
