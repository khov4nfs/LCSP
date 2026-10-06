from types import SimpleNamespace
from copy import deepcopy
import json
from unittest.mock import Mock

import pytest

from contracts.handoffs import InterviewResult
from orchestration.context import LCSPRunContext
from orchestration.dispatcher import RootSubagentDispatcher
from orchestration.result_validation import SpecialistHandoffValidationError
from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_LIMITATION_CODES,
)
from tools.common.capabilities.agent_runtime.invocation import invocation_boundary_manifest
from tools.common.capabilities.platform.api_client import (
    InterviewContextReadyAuthorityCallbackError,
    InterviewDecisionRepairableCallbackError,
    InterviewResolutionCallbackError,
    WorkerCallbackError,
)
from tools.common.capabilities.workflow.recovery.interview_boundary import (
    AssessmentInterviewResumeBoundary,
    INTERVIEW_RESUME_COMMAND,
    _apply_authority_preflight,
    _authority_provenance,
    _confirmation_or_original,
    _confirmation_question_id,
    _synthesize_confirmation_question,
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
            }
        ],
        "limitations": ["customer-confirmed current statements only"],
        "sourceVersionRef": "snapshot-1:abc",
        "pgeVersion": "ter-1:v1",
        "guidanceVersion": "guidance-1",
    }


def _minimum_planning_confirmed_context() -> dict:
    return {
        "statements": [
            {
                "statementId": "stmt-initial-planning",
                "topic": "initial_planning_context",
                "statement": (
                    "The AI model drafts recommendations in the customer onboarding "
                    "workflow; a human reviewer approves every customer-facing action "
                    "before any status update or workflow gate changes, affected "
                    "subjects are customers and their organizations, and material "
                    "data sources are customer profile records, support tickets, "
                    "repository code, and business documents."
                ),
                "normalizedValue": "rich_initial_planning_context",
            }
        ]
    }


WAITING_HANDOFF = {
    "expectedContextRevision": 0,
    "mode": "INITIAL_INTERVIEW",
    "outcome": "WAITING_FOR_CUSTOMER",
    "activeQuestion": {
        "id": "agent-question-next",
        "intent": "ASK",
        "control": "FREE_TEXT",
        "prompt": "Please provide the missing business context.",
        "frontier": {
            "owner": "CUSTOMER",
            "materiality": "MATERIAL",
            "description": "Missing business context clarification",
            "evidenceRefs": [],
        },
    },
    "contextAuthority": "CUSTOMER_STATED",
    "confirmedContext": {},
    "flags": [],
    "blockedActions": [],
    "targetedResolution": {},
}


class RecordingRoot:
    def __init__(self, result=None, order=None) -> None:
        self.calls = []
        self._result = result or {"status": "ROOT_REENTERED"}
        self._order = order

    def invoke(self, payload, config=None, context=None):
        if self._order is not None:
            self._order.append("root")
        self.calls.append((payload, config, context))
        return self._result


class RecordingDispatcher:
    def __init__(self, handoff=None, order=None) -> None:
        self.calls = []
        self._handoff = handoff or WAITING_HANDOFF
        self._order = order

    def dispatch(self, **kwargs):
        if self._order is not None:
            self._order.append("interview")
        self.calls.append(kwargs)
        return {"status": "COMPLETED", "handoff": dict(self._handoff)}


class RecordingApi:
    def __init__(self, status="CURRENT", order=None, public_state=None) -> None:
        self.status = status
        self.private_context_calls = []
        self.decision_posts = []
        self._order = order
        self.public_state = public_state

    def get_interview_private_context(
        self,
        assessment_id,
        context_revision,
        *,
        source_version=None,
        pge_version=None,
    ):
        self.private_context_calls.append(
            (assessment_id, context_revision, source_version, pge_version)
        )
        return {
            "status": self.status,
            "threadId": "interview:assessment-1",
            "workflowRunId": "a0000000-0000-0000-0000-000000000001",
            "authenticatedActorId": "user-test-actor",
            "actorId": "user-test-actor",
            "sourceVersion": "snapshot-1:abc",
            "pgeVersion": "ter-1:v1",
            "technicalCoverageState": "READY",
            "coverageLimitations": [],
            "guidanceVersion": "guidance-v1",
            "workingStrategy": {
                "terminologyMap": {"human oversight": "manual review"},
                "avoidReaskingTopics": ["governance"],
                "effectiveQuestionPatterns": [],
                "observedAmbiguities": [],
                "interactionNotes": [],
            },
            "publicState": self.public_state
            or {
                "outcome": "WAITING_FOR_CUSTOMER",
                "contextRevision": context_revision,
                "orchestrationRequested": True,
            },
            "privateRevision": {
                "actorId": "user-test-actor",
                "questionIntent": "ASK",
                "questionControl": "FREE_TEXT",
                "answer": {"freeText": "raw"},
            },
        }

    def post_interview_agent_decision(self, assessment_id, payload):
        if self._order is not None:
            self._order.append("guard")
        self.decision_posts.append((assessment_id, payload))
        return {"outcome": payload.get("outcome")}


def _message(*, reason="INTERVIEW_AGENT_DECISION_REQUIRED", revision=2):
    return {
        "assessmentId": "assessment-1",
        "threadId": "interview:assessment-1",
        "workflowRunId": "a0000000-0000-0000-0000-000000000001",
        "authenticatedActorId": "user-test-actor",
        "questionId": "agent-question-1",
        "contextRevision": revision,
        "sourceVersion": "snapshot-1:abc",
        "pgeVersion": "ter-1:v1",
        "resumeReason": reason,
    }




@pytest.mark.parametrize(
    ("intent", "control", "answer", "expected_customer_confirmed", "expected_confirmed"),
    [
        ("CLARIFY", "BOOLEAN", {"selectedChoiceIds": ["yes"]}, False, False),
        ("CLARIFY", "SINGLE_SELECT", {"selectedChoiceIds": ["yes"]}, False, False),
        ("CLARIFY", "CONFIRM_ADJUST", {"confirmed": True}, True, False),
        ("CLARIFY", "CONFIRM_ADJUST", {"adjusted": True, "freeText": "change"}, False, False),
        # FREE_TEXT always needs interpretation, even on a direct ASK answer: tightened
        # per docs/../lcsp-tighten-direct-lossless.md, no longer directly lossless.
        ("ASK", "FREE_TEXT", {"freeText": "yes"}, False, False),
        ("ASK", "SINGLE_SELECT", {"selectedChoiceIds": ["yes"]}, True, True),
        ("ASK", "SINGLE_SELECT", {"selectedChoiceIds": ["yes"], "adjusted": True}, False, False),
        # A non-empty comment always needs interpretation, regardless of control/choice.
        (
            "ASK",
            "SINGLE_SELECT",
            {"selectedChoiceIds": ["standard"], "comment": "Mostly standard, except admin approval."},
            False,
            False,
        ),
        # Selecting an Other-like choice always carries a comment (the API rejects an
        # empty one for a requiresFreeText choice), so it is caught the same way.
        (
            "ASK",
            "SINGLE_SELECT",
            {"selectedChoiceIds": ["other"], "comment": "Hosted in a customer-managed region."},
            False,
            False,
        ),
    ],
)
def test_authority_preflight_matches_api_provenance_matrix(
    intent,
    control,
    answer,
    expected_customer_confirmed,
    expected_confirmed,
):
    provenance = _authority_provenance({
        "questionIntent": intent,
        "questionControl": control,
        "answer": answer,
    })

    assert provenance == {
        "customer_confirmed": expected_customer_confirmed,
        "confirmed": expected_confirmed,
    }


def test_authority_preflight_honors_persisted_interpretation_flag_without_comment():
    # The API persists answerRequiresInterpretation for a requiresFreeText choice at
    # answer-recording time. The mirror cannot re-derive choice.requiresFreeText from
    # the private revision alone, so it must trust this authoritative flag directly
    # rather than only falling back to raw comment/freeText detection.
    provenance = _authority_provenance({
        "questionIntent": "ASK",
        "questionControl": "SINGLE_SELECT",
        "answer": {"selectedChoiceIds": ["other"]},
        "answerRequiresInterpretation": True,
    })

    assert provenance == {"customer_confirmed": False, "confirmed": False}


def test_authority_preflight_downgrades_nonterminal_without_losing_private_revision():
    private_revision = {
        "questionIntent": "CLARIFY",
        "questionControl": "BOOLEAN",
        "answer": {"selectedChoiceIds": ["yes"]},
    }
    decision = {
        **deepcopy(WAITING_HANDOFF),
        "contextAuthority": "CUSTOMER_CONFIRMED",
        "confirmedContext": {"statements": [{"topic": "authority"}]},
    }

    prepared, feedback = _apply_authority_preflight(
        decision, {"privateRevision": private_revision}
    )

    assert feedback is None
    assert prepared["contextAuthority"] == "CUSTOMER_STATED"
    assert prepared["confirmedContext"] == {}
    assert private_revision["answer"] == {"selectedChoiceIds": ["yes"]}
    assert decision["confirmedContext"] == {"statements": [{"topic": "authority"}]}

@pytest.mark.parametrize("corrected_outcome", ["WAITING_FOR_CUSTOMER", "CONTEXT_RESOLVED"])
def test_resolution_rejection_gets_one_private_correction_before_continuation(corrected_outcome):
    api = RecordingApi()
    context = api.get_interview_private_context("assessment-1", 2)
    context["privateRevision"] = {
        "actorId": "user-test-actor",
        "questionIntent": "ASK",
        "questionControl": "SINGLE_SELECT",
        "answer": {"selectedChoiceIds": ["yes"]},
    }
    context["targetedNeed"] = {
        "needId": "need-1",
        "businessContextNeed": "Clarify the status of external data sources.",
        "resolutionCriteria": [
            "Explicit confirmation or denial regarding external data sources.",
        ],
    }
    api.get_interview_private_context = Mock(return_value=context)
    original_context = deepcopy(context)
    api.post_interview_progress = Mock()
    rejected = {
        **deepcopy(WAITING_HANDOFF),
        "mode": "BUSINESS_CONTEXT_RESOLUTION",
        "outcome": "CONTEXT_RESOLVED",
        "activeQuestion": None,
        "contextAuthority": "CUSTOMER_CONFIRMED",
    }
    corrected = {
        **deepcopy(WAITING_HANDOFF),
        "mode": "BUSINESS_CONTEXT_RESOLUTION",
        "outcome": corrected_outcome,
    }
    if corrected_outcome == "CONTEXT_RESOLVED":
        corrected["activeQuestion"] = None
        corrected["contextAuthority"] = "CUSTOMER_CONFIRMED"
    dispatcher = RecordingDispatcher()
    dispatcher.dispatch = Mock(side_effect=[{"handoff": rejected}, {"handoff": corrected}])
    missing = "Explicit confirmation or denial regarding external data sources."
    accepted = {"outcome": corrected_outcome}
    api.post_interview_agent_decision = Mock(side_effect=[
        InterviewResolutionCallbackError("rejected", missing=missing), accepted,
    ])
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(), api_client=api, dispatcher=dispatcher
    )
    boundary._run_guarded_continuation = Mock()

    boundary.handle(_message(), "corr-1")

    first, repair = [call.kwargs for call in dispatcher.dispatch.call_args_list]
    payload = json.loads(repair["instruction"].split("\n\n", 1)[1])
    assert payload["decisionValidationFeedback"]["missingCriteria"] == missing
    assert (
        payload["decisionValidationFeedback"]["rejectedDecision"]["outcome"]
        == "CONTEXT_RESOLVED"
    )
    assert payload["targetedNeed"] == context["targetedNeed"]
    assert context == original_context
    assert "decisionValidationFeedback" not in first["instruction"].split("\n\n", 1)[1]
    assert first["thread_id"] == repair["thread_id"]
    assert first["idempotency_key"] != repair["idempotency_key"]
    assert repair["context"].idempotency_key == repair["idempotency_key"]
    for call in api.post_interview_agent_decision.call_args_list:
        assert call.args[1]["expectedContextRevision"] == 2
        assert "decisionValidationFeedback" not in call.args[1]
    boundary._run_guarded_continuation.assert_called_once()
    assert boundary._run_guarded_continuation.call_args.kwargs["guarded_state"] is accepted
    assert all(call.args[-1] != "FAILED" for call in api.post_interview_progress.call_args_list)


@pytest.mark.parametrize("error,attempts,outcome", [
    (InterviewResolutionCallbackError("criteria missing"), 2, "CONTEXT_RESOLVED"),
    (InterviewContextReadyAuthorityCallbackError("requires authority"), 2, "CONTEXT_READY"),
    (
        InterviewDecisionRepairableCallbackError(
            "direct confirmation required",
            error_code="INTERVIEW_CUSTOMER_CONFIRMED_REQUIRES_DIRECT_OR_EXPLICIT_CONFIRMATION",
        ),
        2,
        "CONTEXT_READY",
    ),
    (
        WorkerCallbackError(
            "INTERVIEW_DECISION_STALE_REVISION: client error", status_code=409
        ),
        1,
        "CONTEXT_RESOLVED",
    ),
    (
        WorkerCallbackError("INTERVIEW_SESSION_MISMATCH: client error", status_code=409),
        1,
        "CONTEXT_RESOLVED",
    ),
    (
        WorkerCallbackError("INTERVIEW_UNKNOWN_NEW_CODE: client error", status_code=409),
        1,
        "CONTEXT_RESOLVED",
    ),
    (WorkerCallbackError("forbidden", status_code=403), 1, "CONTEXT_RESOLVED"),
])
def test_rejected_correction_is_bounded_and_unrelated_errors_are_not_repaired(
    error, attempts, outcome
):
    api = RecordingApi()
    context = api.get_interview_private_context("assessment-1", 2)
    context["privateRevision"] = {
        "actorId": "user-test-actor",
        "questionIntent": "ASK",
        "questionControl": "SINGLE_SELECT",
        "answer": {"selectedChoiceIds": ["yes"]},
    }
    api.get_interview_private_context = Mock(return_value=context)
    api.post_interview_progress = Mock()
    api.post_interview_agent_decision = Mock(side_effect=error)
    handoff = {
        **deepcopy(WAITING_HANDOFF),
        "outcome": outcome,
        "activeQuestion": None,
        "contextAuthority": "CUSTOMER_CONFIRMED",
    }
    if outcome == "CONTEXT_READY":
        handoff["confirmedContext"] = _minimum_planning_confirmed_context()
    dispatcher = RecordingDispatcher(handoff)
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(), api_client=api, dispatcher=dispatcher
    )
    boundary._run_guarded_continuation = Mock()

    with pytest.raises(type(error)) as caught:
        boundary.handle(_message(), "corr-1")

    assert caught.value is error
    assert len(dispatcher.calls) == attempts
    assert api.post_interview_agent_decision.call_count == attempts
    boundary._run_guarded_continuation.assert_not_called()
    assert api.post_interview_progress.call_args.args[-1] == "FAILED"



def test_allowlisted_api_rejection_gets_one_private_correction_with_safe_log(caplog):
    api = RecordingApi()
    api.post_interview_progress = Mock()
    rejected = {
        **deepcopy(WAITING_HANDOFF),
        "mode": "INITIAL_INTERVIEW",
    }
    corrected = {**deepcopy(WAITING_HANDOFF), "mode": "INITIAL_INTERVIEW"}
    dispatcher = RecordingDispatcher()
    dispatcher.dispatch = Mock(side_effect=[{"handoff": rejected}, {"handoff": corrected}])
    accepted = {"outcome": "WAITING_FOR_CUSTOMER"}
    api.post_interview_agent_decision = Mock(side_effect=[
        InterviewDecisionRepairableCallbackError(
            "targeted need was non-neutral: leaked phrase",
            error_code="INTERVIEW_TARGETED_NEED_NON_NEUTRAL",
            meta={"text": "leaked phrase"},
        ),
        accepted,
    ])
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(), api_client=api, dispatcher=dispatcher
    )
    boundary._run_guarded_continuation = Mock()

    with caplog.at_level(
        "WARNING", logger="tools.common.capabilities.workflow.recovery.interview_boundary"
    ):
        boundary.handle(_message(), "corr-1")

    first, repair = [call.kwargs for call in dispatcher.dispatch.call_args_list]
    payload = json.loads(repair["instruction"].split("\n\n", 1)[1])
    assert payload["decisionValidationFeedback"] == {
        "code": "INTERVIEW_TARGETED_NEED_NON_NEUTRAL",
        "rejectedDecision": rejected,
    }
    assert "decisionValidationFeedback" not in first["instruction"].split("\n\n", 1)[1]
    assert "INTERVIEW_AGENT_DECISION_REJECTION_REPAIRED" in caplog.text
    assert "error_code=INTERVIEW_TARGETED_NEED_NON_NEUTRAL" in caplog.text
    assert "leaked phrase" not in caplog.text
    assert api.post_interview_agent_decision.call_count == 2
    boundary._run_guarded_continuation.assert_called_once()




def _authority_candidate(statement: str = "Human review approves AI decisions") -> dict:
    return {
        **deepcopy(WAITING_HANDOFF),
        "outcome": "CONTEXT_READY",
        "activeQuestion": None,
        "contextAuthority": "CUSTOMER_CONFIRMED",
        "confirmedContext": {
            "statements": [
                {
                    "statementId": "stmt-authority",
                    "topic": "decision_authority",
                    "statement": statement,
                    "normalizedValue": statement,
                    "evidenceRefs": [],
                }
            ]
        },
    }


def test_confirmation_synthesis_produces_valid_confirm_adjust_without_static_copy(caplog):
    statement = "Human review approves AI decisions"
    decision = _authority_candidate(statement)
    context = {
        "privateRevision": {
            "questionId": "previous-question",
            "questionIntent": "CLARIFY",
            "questionControl": "BOOLEAN",
            "answer": {"selectedChoiceIds": ["yes"]},
        }
    }

    with caplog.at_level(
        "WARNING", logger="tools.common.capabilities.workflow.recovery.interview_boundary"
    ):
        synthesized = _confirmation_or_original(decision, context)

    InterviewResult.model_validate(synthesized)
    question = synthesized["activeQuestion"]
    assert synthesized["outcome"] == "WAITING_FOR_CUSTOMER"
    assert synthesized["contextAuthority"] == "CUSTOMER_STATED"
    assert synthesized["confirmedContext"] == {"statements": []}
    assert question["id"] == _confirmation_question_id(statement)
    assert question["intent"] == "CLARIFY"
    assert question["control"] == "CONFIRM_ADJUST"
    assert question["prompt"] == statement
    assert question["proposedInterpretation"] == statement
    assert question["frontier"] == {
        "owner": "CUSTOMER",
        "materiality": "MATERIAL",
        "description": statement,
        "evidenceRefs": [],
    }
    choices = {choice["id"]: choice for choice in question["choices"]}
    assert choices["CONFIRM"]["requiresFreeText"] is False
    assert choices["ADJUST"]["requiresFreeText"] is True
    assert "Please confirm" not in question["prompt"]
    assert "INTERVIEW_CONFIRMATION_QUESTION_SYNTHESIZED" in caplog.text
    assert statement not in caplog.text


def test_synthetic_confirm_answer_satisfies_customer_confirmed_mirror():
    statement = "Human review approves AI decisions"
    question_id = _confirmation_question_id(statement)

    assert _authority_provenance({
        "questionId": question_id,
        "questionIntent": "CLARIFY",
        "questionControl": "CONFIRM_ADJUST",
        "answer": {"confirmed": True},
    }) == {"customer_confirmed": True, "confirmed": False}


def test_synthetic_adjust_answer_does_not_confirm_authority():
    statement = "Human review approves AI decisions"
    question_id = _confirmation_question_id(statement)

    assert _authority_provenance({
        "questionId": question_id,
        "questionIntent": "CLARIFY",
        "questionControl": "CONFIRM_ADJUST",
        "answer": {"adjusted": True, "freeText": "Only some decisions"},
    }) == {"customer_confirmed": False, "confirmed": False}


def test_confirmation_synthesis_merges_multiple_statements(caplog):
    # A FREE_TEXT answer volunteering several facts in one turn is common after the
    # FREE_TEXT/Other authority tightening (e.g. "A recruiter approves every
    # rejection. For senior positions, the hiring manager must also approve.").
    # Synthesis must cover all of them in one CONFIRM_ADJUST turn, not fail closed.
    decision = _authority_candidate()
    decision["confirmedContext"] = {
        "statements": [
            {"statement": "A recruiter approves every rejection.", "statementId": "one", "topic": "a"},
            {"statement": "For senior positions, the hiring manager must also approve.", "statementId": "two", "topic": "b"},
        ]
    }
    context = {"privateRevision": {"questionControl": "BOOLEAN", "answer": {}}}

    with caplog.at_level(
        "WARNING", logger="tools.common.capabilities.workflow.recovery.interview_boundary"
    ):
        synthesized = _synthesize_confirmation_question(decision, context)

    InterviewResult.model_validate(synthesized)
    question = synthesized["activeQuestion"]
    merged = (
        "- A recruiter approves every rejection.\n"
        "- For senior positions, the hiring manager must also approve."
    )
    assert question["prompt"] == merged
    assert question["proposedInterpretation"] == merged
    assert question["frontier"]["description"] == merged
    assert question["id"] == _confirmation_question_id(merged)
    # No narration/connecting words were added — only the model's own statement
    # text, verbatim, joined by a neutral dash-bullet newline.
    assert "A recruiter approves every rejection." in merged
    assert "For senior positions, the hiring manager must also approve." in merged
    assert "statement_count=2" in caplog.text


def test_confirmation_synthesis_rejects_too_many_statements():
    decision = _authority_candidate()
    decision["confirmedContext"] = {
        "statements": [
            {"statement": f"Fact {i}", "statementId": f"s{i}", "topic": f"t{i}"}
            for i in range(6)
        ]
    }

    synthesized = _synthesize_confirmation_question(
        decision,
        {"privateRevision": {"questionControl": "BOOLEAN", "answer": {}}},
    )

    assert synthesized is None


def test_confirmation_synthesis_rejects_ambiguous_or_empty_statement_among_multiple():
    decision = _authority_candidate()
    decision["confirmedContext"] = {
        "statements": [
            {"statement": "A recruiter approves every rejection.", "statementId": "one", "topic": "a"},
            {"statement": "   ", "statementId": "two", "topic": "b"},
        ]
    }

    synthesized = _synthesize_confirmation_question(
        decision,
        {"privateRevision": {"questionControl": "BOOLEAN", "answer": {}}},
    )

    # Fail closed on the whole candidate rather than silently drop the empty one.
    assert synthesized is None


def test_confirmation_synthesis_rejects_merged_statement_over_length_limit():
    decision = _authority_candidate()
    decision["confirmedContext"] = {
        "statements": [
            {"statement": "x" * 250, "statementId": f"s{i}", "topic": f"t{i}"}
            for i in range(5)
        ]
    }

    synthesized = _synthesize_confirmation_question(
        decision,
        {"privateRevision": {"questionControl": "BOOLEAN", "answer": {}}},
    )

    assert synthesized is None


def test_confirmed_synthetic_question_rejected_fails_closed(caplog):
    statement = "Human review approves AI decisions"
    decision = {**_authority_candidate(statement), "contextAuthority": "CONFIRMED"}
    question_id = _confirmation_question_id(statement)

    with caplog.at_level(
        "ERROR", logger="tools.common.capabilities.workflow.recovery.interview_boundary"
    ), pytest.raises(RuntimeError, match="synthetic CONFIRM_ADJUST confirmation was rejected"):
        _confirmation_or_original(
            decision,
            {
                "privateRevision": {
                    "questionId": question_id,
                    "questionIntent": "CLARIFY",
                    "questionControl": "CONFIRM_ADJUST",
                    "answer": {"confirmed": True},
                }
            },
        )

    assert "INTERVIEW_CONFIRMATION_SYNTHESIS_REJECTED" in caplog.text
    assert question_id in caplog.text
    assert statement not in caplog.text


def test_confirmed_synthetic_question_with_incomplete_minimum_context_is_not_reasked(caplog):
    # Reproduces a real stuck interview: the customer already confirmed the
    # synthesized CONFIRM_ADJUST statement, the authority is valid, but the statement
    # alone still lacks planning dimensions (decisionInfluence, humanOversight).
    # Re-asking the same confirmation can never supply those, so it must not be
    # synthesized again (that looped, then hit the fail-closed guard and killed the
    # run). The decision goes to the API final guard, which owns the repair path.
    statement = (
        "LibreChat uses OpenAI models to provide user-initiated conversational AI "
        "responses, agent workflows, and file or code-related tasks as described."
    )
    decision = {**_authority_candidate(statement), "contextAuthority": "CUSTOMER_CONFIRMED"}
    decision["mode"] = "INITIAL_INTERVIEW"
    question_id = _confirmation_question_id(statement)
    context = {
        "privateRevision": {
            "questionId": question_id,
            "questionIntent": "CLARIFY",
            "questionControl": "CONFIRM_ADJUST",
            "answer": {"confirmed": True, "questionId": question_id},
        }
    }

    with caplog.at_level(
        "WARNING", logger="tools.common.capabilities.workflow.recovery.interview_boundary"
    ):
        result = _confirmation_or_original(decision, context)

    assert result == decision
    assert result["outcome"] == "CONTEXT_READY"
    assert "INTERVIEW_CONFIRMATION_REASK_SKIPPED" in caplog.text
    assert question_id in caplog.text
    assert statement not in caplog.text


def test_confirmed_synthetic_question_with_incomplete_context_reaches_api_repair_not_crash():
    # End-to-end for the stuck interview: customer already confirmed the synthesized
    # statement, the specialist keeps returning the same incomplete CONTEXT_READY, and
    # the turn used to die with "synthetic CONFIRM_ADJUST confirmation was rejected".
    # Now the API final guard rejects it with the missing dimensions and the specialist
    # gets its private correction, which asks the follow-up question.
    statement = (
        "LibreChat uses OpenAI models to provide user-initiated conversational AI "
        "responses, agent workflows, and file or code-related tasks as described."
    )
    question_id = _confirmation_question_id(statement)
    api = RecordingApi()
    context = api.get_interview_private_context("assessment-1", 2)
    context["privateRevision"] = {
        "actorId": "user-test-actor",
        "questionId": question_id,
        "questionIntent": "CLARIFY",
        "questionControl": "CONFIRM_ADJUST",
        "answer": {"confirmed": True, "questionId": question_id},
    }
    api.get_interview_private_context = Mock(return_value=context)
    api.post_interview_progress = Mock()
    incomplete = {
        **_authority_candidate(statement),
        "mode": "INITIAL_INTERVIEW",
        "contextAuthority": "CUSTOMER_CONFIRMED",
    }
    follow_up = {**deepcopy(WAITING_HANDOFF), "mode": "INITIAL_INTERVIEW"}
    dispatcher = RecordingDispatcher()
    dispatcher.dispatch = Mock(
        side_effect=[
            {"handoff": incomplete},   # first candidate
            {"handoff": incomplete},   # local-preflight correction: still incomplete
            {"handoff": follow_up},    # API-rejection correction: asks the follow-up
        ]
    )
    accepted = {"outcome": "WAITING_FOR_CUSTOMER"}
    api.post_interview_agent_decision = Mock(
        side_effect=[
            InterviewDecisionRepairableCallbackError(
                "minimum context incomplete",
                error_code="INTERVIEW_MINIMUM_CONTEXT_INCOMPLETE",
                meta={"missingDimensions": "decisionInfluence,humanOversight"},
            ),
            accepted,
        ]
    )
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(), api_client=api, dispatcher=dispatcher
    )
    boundary._run_guarded_continuation = Mock()

    boundary.handle(_message(), "corr-1")  # must not raise RuntimeError

    assert dispatcher.dispatch.call_count == 3
    last_payload = json.loads(
        dispatcher.dispatch.call_args_list[2].kwargs["instruction"].split("\n\n", 1)[1]
    )
    feedback = last_payload["decisionValidationFeedback"]
    assert feedback["code"] == "INTERVIEW_MINIMUM_CONTEXT_INCOMPLETE"
    assert feedback["missingDimensions"] == ["decisionInfluence", "humanOversight"]
    # The incomplete decision was posted unchanged (no synthesized re-confirmation),
    # and the corrected follow-up is what finally reached the API.
    first_post, second_post = [c.args[1] for c in api.post_interview_agent_decision.call_args_list]
    assert first_post["outcome"] == "CONTEXT_READY"
    assert second_post["outcome"] == "WAITING_FOR_CUSTOMER"
    assert "activeQuestion" not in first_post or first_post["activeQuestion"] is None
    boundary._run_guarded_continuation.assert_called_once()
    assert all(call.args[-1] != "FAILED" for call in api.post_interview_progress.call_args_list)


def test_unconfirmed_incomplete_minimum_context_still_synthesizes_confirmation():
    # The narrow fix must not change the first-time behavior: until the customer has
    # confirmed the synthesized statement, incomplete context still converges to one
    # CONFIRM_ADJUST turn.
    statement = "The AI model drafts recommendations in the onboarding workflow."
    decision = {**_authority_candidate(statement), "contextAuthority": "CUSTOMER_CONFIRMED"}
    decision["mode"] = "INITIAL_INTERVIEW"
    context = {
        "privateRevision": {
            "questionId": "some-earlier-question",
            "questionIntent": "CLARIFY",
            "questionControl": "CONFIRM_ADJUST",
            "answer": {"confirmed": True},
        }
    }

    result = _confirmation_or_original(decision, context)

    assert result["outcome"] == "WAITING_FOR_CUSTOMER"
    assert result["activeQuestion"]["control"] == "CONFIRM_ADJUST"


def test_local_authority_preflight_gives_confirm_adjust_feedback_before_post(caplog):
    api = RecordingApi()
    context = api.get_interview_private_context("assessment-1", 2)
    context["privateRevision"] = {
        "actorId": "user-test-actor",
        "questionIntent": "CLARIFY",
        "questionControl": "BOOLEAN",
        "answer": {"selectedChoiceIds": ["yes"]},
    }
    api.get_interview_private_context = Mock(return_value=context)
    api.post_interview_progress = Mock()
    rejected = {
        **deepcopy(WAITING_HANDOFF),
        "mode": "INITIAL_INTERVIEW",
        "outcome": "CONTEXT_READY",
        "activeQuestion": None,
        "contextAuthority": "CUSTOMER_CONFIRMED",
        "confirmedContext": {"statements": [{"topic": "decision_authority"}]},
    }
    corrected = {**deepcopy(WAITING_HANDOFF), "mode": "INITIAL_INTERVIEW"}
    dispatcher = RecordingDispatcher()
    dispatcher.dispatch = Mock(side_effect=[{"handoff": rejected}, {"handoff": corrected}])
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(), api_client=api, dispatcher=dispatcher
    )
    boundary._run_guarded_continuation = Mock()

    with caplog.at_level(
        "WARNING", logger="tools.common.capabilities.workflow.recovery.interview_boundary"
    ):
        boundary.handle(_message(), "corr-1")

    assert len(api.decision_posts) == 1
    assert api.decision_posts[0][1]["outcome"] == "WAITING_FOR_CUSTOMER"
    repair_payload = json.loads(
        dispatcher.dispatch.call_args_list[1].kwargs["instruction"].split("\n\n", 1)[1]
    )
    feedback = repair_payload["decisionValidationFeedback"]
    assert feedback["code"] == (
        "INTERVIEW_CUSTOMER_CONFIRMED_REQUIRES_DIRECT_OR_EXPLICIT_CONFIRMATION"
    )
    assert feedback["instructionKey"] == (
        "CONFIRMATION_PROVENANCE_REQUIRES_CONFIRM_ADJUST_OR_DIRECT_ASK"
    )
    assert "CONFIRM_ADJUST" in feedback["instruction"]
    assert "CLARIFY BOOLEAN or SINGLE_SELECT" in feedback["instruction"]
    assert "INTERVIEW_AUTHORITY_PROVENANCE_REPAIRED" in caplog.text
    assert "instruction_key=CONFIRMATION_PROVENANCE_REQUIRES_CONFIRM_ADJUST_OR_DIRECT_ASK" in caplog.text


def test_local_minimum_context_preflight_asks_only_missing_dimensions_before_post():
    api = RecordingApi()
    context = api.get_interview_private_context("assessment-1", 2)
    context["privateRevision"] = {
        "actorId": "user-test-actor",
        "questionIntent": "ASK",
        "questionControl": "SINGLE_SELECT",
        "answer": {"selectedChoiceIds": ["yes"]},
    }
    api.get_interview_private_context = Mock(return_value=context)
    api.post_interview_progress = Mock()
    rejected = {
        **deepcopy(WAITING_HANDOFF),
        "mode": "INITIAL_INTERVIEW",
        "outcome": "CONTEXT_READY",
        "activeQuestion": None,
        "contextAuthority": "CONFIRMED",
        "confirmedContext": {
            "statements": [
                {
                    "statementId": "stmt-ai-usage",
                    "topic": "ai_usage",
                    "statement": (
                        "The AI model drafts recommendations in the onboarding workflow."
                    ),
                    "normalizedValue": "ai_model_recommendations",
                }
            ]
        },
    }
    corrected = {**deepcopy(WAITING_HANDOFF), "mode": "INITIAL_INTERVIEW"}
    dispatcher = RecordingDispatcher()
    dispatcher.dispatch = Mock(side_effect=[{"handoff": rejected}, {"handoff": corrected}])
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(), api_client=api, dispatcher=dispatcher
    )
    boundary._run_guarded_continuation = Mock()

    boundary.handle(_message(), "corr-1")

    assert len(api.decision_posts) == 1
    assert api.decision_posts[0][1]["outcome"] == "WAITING_FOR_CUSTOMER"
    repair_payload = json.loads(
        dispatcher.dispatch.call_args_list[1].kwargs["instruction"].split("\n\n", 1)[1]
    )
    feedback = repair_payload["decisionValidationFeedback"]
    assert feedback["code"] == "INTERVIEW_MINIMUM_CONTEXT_INCOMPLETE"
    assert feedback["instructionKey"] == "MINIMUM_PLANNING_CONTEXT_REQUIRES_FOLLOW_UP"
    assert "humanOversight" in feedback["missingDimensions"]
    assert "dataCategories" in feedback["missingDimensions"]
    assert "aiUsage" not in feedback["missingDimensions"]


def test_invalid_authority_after_private_feedback_synthesizes_confirm_adjust_question():
    api = RecordingApi()
    context = api.get_interview_private_context("assessment-1", 2)
    context["privateRevision"] = {
        "actorId": "user-test-actor",
        "questionId": "previous-question",
        "questionIntent": "CLARIFY",
        "questionControl": "BOOLEAN",
        "answer": {"selectedChoiceIds": ["yes"]},
    }
    api.get_interview_private_context = Mock(return_value=context)
    api.post_interview_progress = Mock()
    rejected = {
        **deepcopy(WAITING_HANDOFF),
        "mode": "INITIAL_INTERVIEW",
        "outcome": "CONTEXT_READY",
        "activeQuestion": None,
        "contextAuthority": "CUSTOMER_CONFIRMED",
        "confirmedContext": {"statements": [{"statement": "Human review approves AI decisions", "statementId": "stmt", "topic": "decision_authority"}]},
    }
    corrected = deepcopy(rejected)
    dispatcher = RecordingDispatcher()
    dispatcher.dispatch = Mock(side_effect=[{"handoff": rejected}, {"handoff": corrected}])
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(), api_client=api, dispatcher=dispatcher
    )
    boundary._run_guarded_continuation = Mock()

    boundary.handle(_message(), "corr-1")

    assert len(api.decision_posts) == 1
    posted = api.decision_posts[0][1]
    assert posted["outcome"] == "WAITING_FOR_CUSTOMER"
    assert posted["contextAuthority"] == "CUSTOMER_STATED"
    assert posted["confirmedContext"] == {"statements": []}
    assert posted["activeQuestion"]["control"] == "CONFIRM_ADJUST"
    assert posted["activeQuestion"]["prompt"] == "Human review approves AI decisions"
    assert posted["activeQuestion"]["frontier"]["evidenceRefs"] == []
    assert dispatcher.dispatch.call_count == 2


def test_interpretive_other_answer_synthesizes_confirm_adjust_without_ever_posting_context_ready():
    # Boundary from docs/../lcsp-tighten-direct-lossless.md: a direct ASK answer that
    # selected an Other/requiresFreeText choice with a comment always needed
    # interpretation, so it can never be directLosslessCustomerStatement even though
    # questionIntent is ASK. If the specialist still claims CUSTOMER_CONFIRMED +
    # CONTEXT_READY twice in a row, the worker must converge locally to a
    # CONFIRM_ADJUST question and must never post CONTEXT_READY to the guard.
    api = RecordingApi()
    context = api.get_interview_private_context("assessment-1", 2)
    context["privateRevision"] = {
        "actorId": "user-test-actor",
        "questionId": "previous-question",
        "questionIntent": "ASK",
        "questionControl": "SINGLE_SELECT",
        "answer": {
            "selectedChoiceIds": ["other"],
            "comment": "Hosted in a customer-managed region.",
        },
        "answerRequiresInterpretation": True,
    }
    api.get_interview_private_context = Mock(return_value=context)
    api.post_interview_progress = Mock()
    rejected = {
        **deepcopy(WAITING_HANDOFF),
        "mode": "INITIAL_INTERVIEW",
        "outcome": "CONTEXT_READY",
        "activeQuestion": None,
        "contextAuthority": "CUSTOMER_CONFIRMED",
        "confirmedContext": {
            "statements": [
                {
                    "statement": "Hosted in a customer-managed region.",
                    "statementId": "stmt",
                    "topic": "hosting_location",
                }
            ]
        },
    }
    # The repaired candidate is still wrong the second time: no automatic third
    # model call, so convergence must come from local synthesis, not another retry.
    corrected = deepcopy(rejected)
    dispatcher = RecordingDispatcher()
    dispatcher.dispatch = Mock(side_effect=[{"handoff": rejected}, {"handoff": corrected}])
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(), api_client=api, dispatcher=dispatcher
    )

    boundary.handle(_message(), "corr-1")

    assert dispatcher.dispatch.call_count == 2
    assert len(api.decision_posts) == 1
    posted = api.decision_posts[0][1]
    assert posted["outcome"] == "WAITING_FOR_CUSTOMER"
    assert posted["contextAuthority"] == "CUSTOMER_STATED"
    assert posted["activeQuestion"]["control"] == "CONFIRM_ADJUST"
    assert posted["activeQuestion"]["prompt"] == "Hosted in a customer-managed region."
    # Exactly one post happened and it is WAITING_FOR_CUSTOMER: CONTEXT_READY never
    # reached the guard on either the first or the repaired attempt, and the real
    # (unmocked) guarded continuation correctly no-ops on a non-terminal outcome.


def test_volunteered_multi_fact_free_text_converges_via_merged_confirm_adjust():
    # Mirrors eval "volunteered-context": a FREE_TEXT answer volunteering two facts
    # in one turn. Turn 1: the specialist wrongly claims CUSTOMER_CONFIRMED +
    # CONTEXT_READY directly from the raw FREE_TEXT answer; the worker must converge
    # locally to ONE CONFIRM_ADJUST covering both facts, never posting CONTEXT_READY.
    # Turn 2: after the customer's real CONFIRM, the specialist resubmits both
    # original facts and CONTEXT_READY is accepted — the mirror's explicit-confirm
    # path does not care how many statements confirmedContext carries.
    fact_one = (
        "The AI model drafts recommendations in the customer onboarding workflow "
        "for customers and organizations."
    )
    fact_two = (
        "A human reviewer approves every customer-facing action before any status "
        "update or workflow gate changes, using customer profile data, support "
        "tickets, repository code, and business documents."
    )
    merged = f"- {fact_one}\n- {fact_two}"

    api_turn_1 = RecordingApi()
    context = api_turn_1.get_interview_private_context("assessment-1", 2)
    context["privateRevision"] = {
        "actorId": "user-test-actor",
        "questionId": "previous-question",
        "questionIntent": "ASK",
        "questionControl": "FREE_TEXT",
        "answer": {"freeText": f"{fact_one} {fact_two}"},
    }
    api_turn_1.get_interview_private_context = Mock(return_value=context)
    api_turn_1.post_interview_progress = Mock()
    rejected = {
        **deepcopy(WAITING_HANDOFF),
        "mode": "INITIAL_INTERVIEW",
        "outcome": "CONTEXT_READY",
        "activeQuestion": None,
        "contextAuthority": "CUSTOMER_CONFIRMED",
        "confirmedContext": {
            "statements": [
                {"statement": fact_one, "statementId": "stmt-1", "topic": "decision_authority"},
                {"statement": fact_two, "statementId": "stmt-2", "topic": "senior_approval"},
            ]
        },
    }
    # The repaired candidate is still wrong the second time: convergence must come
    # from local synthesis, not a third model call.
    corrected = deepcopy(rejected)
    dispatcher_1 = RecordingDispatcher()
    dispatcher_1.dispatch = Mock(side_effect=[{"handoff": rejected}, {"handoff": corrected}])
    boundary_1 = AssessmentInterviewResumeBoundary(
        SimpleNamespace(), api_client=api_turn_1, dispatcher=dispatcher_1
    )

    boundary_1.handle(_message(), "corr-1")

    assert dispatcher_1.dispatch.call_count == 2
    assert len(api_turn_1.decision_posts) == 1
    posted_turn_1 = api_turn_1.decision_posts[0][1]
    assert posted_turn_1["outcome"] == "WAITING_FOR_CUSTOMER"
    assert posted_turn_1["contextAuthority"] == "CUSTOMER_STATED"
    assert posted_turn_1["activeQuestion"]["control"] == "CONFIRM_ADJUST"
    assert posted_turn_1["activeQuestion"]["prompt"] == merged
    assert posted_turn_1["activeQuestion"]["proposedInterpretation"] == merged

    # --- Turn 2: the customer selected CONFIRM on the merged question ---
    api_turn_2 = RecordingApi()
    context_2 = api_turn_2.get_interview_private_context("assessment-1", 3)
    context_2["privateRevision"] = {
        "actorId": "user-test-actor",
        "questionId": posted_turn_1["activeQuestion"]["id"],
        "questionIntent": "CLARIFY",
        "questionControl": "CONFIRM_ADJUST",
        "answer": {"confirmed": True},
    }
    api_turn_2.get_interview_private_context = Mock(return_value=context_2)
    api_turn_2.post_interview_progress = Mock()
    ready = {
        **deepcopy(WAITING_HANDOFF),
        "mode": "INITIAL_INTERVIEW",
        "outcome": "CONTEXT_READY",
        "activeQuestion": None,
        "contextAuthority": "CUSTOMER_CONFIRMED",
        "confirmedContext": deepcopy(rejected["confirmedContext"]),
    }
    dispatcher_2 = RecordingDispatcher(ready)
    downstream_calls = []

    def downstream(payload, correlation_id):
        downstream_calls.append((payload, correlation_id))

    boundary_2 = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        api_client=api_turn_2,
        dispatcher=dispatcher_2,
        downstream_handler=downstream,
    )

    boundary_2.handle(_message(revision=3), "corr-2")

    assert len(dispatcher_2.calls) == 1
    assert len(api_turn_2.decision_posts) == 1
    posted_turn_2 = api_turn_2.decision_posts[0][1]
    assert posted_turn_2["outcome"] == "CONTEXT_READY"
    assert posted_turn_2["contextAuthority"] == "CUSTOMER_CONFIRMED"
    assert len(posted_turn_2["confirmedContext"]["statements"]) == 2
    assert len(downstream_calls) == 1
    assert downstream_calls[0][0]["outcome"] == "CONTEXT_READY"


def test_context_ready_without_authority_gets_one_private_correction_before_posting():
    api = RecordingApi()
    api.post_interview_progress = Mock()
    rejected = {
        **deepcopy(WAITING_HANDOFF),
        "mode": "INITIAL_INTERVIEW",
        "outcome": "CONTEXT_READY",
        "contextAuthority": "CUSTOMER_STATED",
        "activeQuestion": None,
    }
    corrected = {**deepcopy(WAITING_HANDOFF), "mode": "INITIAL_INTERVIEW"}
    dispatcher = RecordingDispatcher()
    dispatcher.dispatch = Mock(side_effect=[{"handoff": rejected}, {"handoff": corrected}])
    accepted = {"outcome": "WAITING_FOR_CUSTOMER"}
    api.post_interview_agent_decision = Mock(return_value=accepted)
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(), api_client=api, dispatcher=dispatcher
    )
    boundary._run_guarded_continuation = Mock()

    boundary.handle(_message(), "corr-1")

    first, repair = [call.kwargs for call in dispatcher.dispatch.call_args_list]
    payload = json.loads(repair["instruction"].split("\n\n", 1)[1])
    assert (
        payload["decisionValidationFeedback"]["code"]
        == "INTERVIEW_CONTEXT_READY_REQUIRES_AUTHORITY"
    )
    assert payload["decisionValidationFeedback"]["rejectedDecision"]["outcome"] == "CONTEXT_READY"
    assert "decisionValidationFeedback" not in first["instruction"].split("\n\n", 1)[1]
    assert first["thread_id"] == repair["thread_id"]
    assert first["idempotency_key"] != repair["idempotency_key"]
    assert repair["context"].idempotency_key == repair["idempotency_key"]
    api.post_interview_agent_decision.assert_called_once()
    assert (
        api.post_interview_agent_decision.call_args.args[1]["outcome"]
        == "WAITING_FOR_CUSTOMER"
    )
    boundary._run_guarded_continuation.assert_called_once()
    assert boundary._run_guarded_continuation.call_args.kwargs["guarded_state"] is accepted
    assert all(call.args[-1] != "FAILED" for call in api.post_interview_progress.call_args_list)


def test_handoff_schema_violation_gets_one_correction_before_continuation(caplog):
    api = RecordingApi()
    api.post_interview_progress = Mock()
    corrected = {**deepcopy(WAITING_HANDOFF), "mode": "INITIAL_INTERVIEW"}
    dispatcher = RecordingDispatcher()
    schema_error = SpecialistHandoffValidationError(
        "interview handoff failed schema validation: "
        "activeQuestion: Value error, ADJUST choice must require free text"
    )
    dispatcher.dispatch = Mock(side_effect=[schema_error, {"handoff": corrected}])
    boundary = AssessmentInterviewResumeBoundary(SimpleNamespace(), api_client=api, dispatcher=dispatcher)
    boundary._run_guarded_continuation = Mock()

    with caplog.at_level(
        "WARNING", logger="tools.common.capabilities.workflow.recovery.interview_boundary"
    ):
        boundary.handle(_message(), "corr-1")

    first, repair = [call.kwargs for call in dispatcher.dispatch.call_args_list]
    payload = json.loads(repair["instruction"].split("\n\n", 1)[1])
    assert payload["decisionValidationFeedback"]["code"] == "INTERVIEW_HANDOFF_SCHEMA_VIOLATION"
    assert "ADJUST choice must require free text" in payload["decisionValidationFeedback"]["rejectedReason"]
    assert "decisionValidationFeedback" not in first["instruction"].split("\n\n", 1)[1]
    assert first["thread_id"] == repair["thread_id"]
    assert first["idempotency_key"] != repair["idempotency_key"]
    assert repair["context"].idempotency_key == repair["idempotency_key"]
    assert "INTERVIEW_HANDOFF_VALIDATION_REPAIRED" in caplog.text
    assert "rule=ADJUST choice must require free text" in caplog.text
    boundary._run_guarded_continuation.assert_called_once()
    assert boundary._run_guarded_continuation.call_args.kwargs["guarded_state"]["outcome"] == corrected["outcome"]
    assert all(call.args[-1] != "FAILED" for call in api.post_interview_progress.call_args_list)


def test_schema_violation_during_guard_correction_gets_its_own_repair(caplog):
    api = RecordingApi()
    api.post_interview_progress = Mock()
    rejected = {
        **deepcopy(WAITING_HANDOFF),
        "mode": "INITIAL_INTERVIEW",
        "outcome": "CONTEXT_READY",
        "contextAuthority": "CUSTOMER_STATED",
        "activeQuestion": None,
    }
    corrected = {**deepcopy(WAITING_HANDOFF), "mode": "INITIAL_INTERVIEW"}
    schema_error = SpecialistHandoffValidationError(
        "interview handoff failed schema validation: "
        "activeQuestion: Value error, select Interview controls require choices"
    )
    dispatcher = RecordingDispatcher()
    dispatcher.dispatch = Mock(
        side_effect=[{"handoff": rejected}, schema_error, {"handoff": corrected}]
    )
    api.post_interview_agent_decision = Mock(return_value={"outcome": "WAITING_FOR_CUSTOMER"})
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(), api_client=api, dispatcher=dispatcher
    )
    boundary._run_guarded_continuation = Mock()

    with caplog.at_level(
        "WARNING", logger="tools.common.capabilities.workflow.recovery.interview_boundary"
    ):
        boundary.handle(_message(), "corr-1")

    _, guard_correction, schema_correction = [
        call.kwargs for call in dispatcher.dispatch.call_args_list
    ]
    feedback = json.loads(schema_correction["instruction"].split("\n\n", 1)[1])[
        "decisionValidationFeedback"
    ]
    assert feedback["code"] == "INTERVIEW_CONTEXT_READY_REQUIRES_AUTHORITY"
    assert feedback["schemaViolation"]["code"] == "INTERVIEW_HANDOFF_SCHEMA_VIOLATION"
    assert "require choices" in feedback["schemaViolation"]["rejectedReason"]
    assert schema_correction["idempotency_key"] != guard_correction["idempotency_key"]
    assert "rule=select Interview controls require choices" in caplog.text
    api.post_interview_agent_decision.assert_called_once()
    boundary._run_guarded_continuation.assert_called_once()
    assert all(call.args[-1] != "FAILED" for call in api.post_interview_progress.call_args_list)


def test_missing_structured_response_is_a_repairable_handoff_error():
    with pytest.raises(SpecialistHandoffValidationError, match="structured_response"):
        RootSubagentDispatcher._validated_handoff(
            subagent_type="interview",
            response_format=object(),
            invocation_result={"messages": []},
        )


def test_handoff_schema_violation_repair_is_bounded():
    api = RecordingApi()
    api.post_interview_progress = Mock()
    dispatcher = RecordingDispatcher()
    error = SpecialistHandoffValidationError(
        "interview handoff failed schema validation: "
        "activeQuestion: Value error, ADJUST choice must require free text"
    )
    dispatcher.dispatch = Mock(side_effect=error)
    boundary = AssessmentInterviewResumeBoundary(SimpleNamespace(), api_client=api, dispatcher=dispatcher)
    boundary._run_guarded_continuation = Mock()

    with pytest.raises(SpecialistHandoffValidationError) as caught:
        boundary.handle(_message(), "corr-1")

    assert caught.value is error
    assert dispatcher.dispatch.call_count == 2
    boundary._run_guarded_continuation.assert_not_called()
    assert api.post_interview_progress.call_args.args[-1] == "FAILED"


def test_unrelated_dispatch_error_is_not_repaired():
    api = RecordingApi()
    api.post_interview_progress = Mock()
    dispatcher = RecordingDispatcher()
    error = ValueError(
        "Assessment Interview resume requires a trusted authenticated principal / actorId"
    )
    dispatcher.dispatch = Mock(side_effect=error)
    boundary = AssessmentInterviewResumeBoundary(SimpleNamespace(), api_client=api, dispatcher=dispatcher)
    boundary._run_guarded_continuation = Mock()

    with pytest.raises(ValueError) as caught:
        boundary.handle(_message(), "corr-1")

    assert caught.value is error
    assert dispatcher.dispatch.call_count == 1
    boundary._run_guarded_continuation.assert_not_called()
    assert api.post_interview_progress.call_args.args[-1] == "FAILED"


def test_interview_resume_command_is_managed_boundary() -> None:
    manifest = invocation_boundary_manifest()

    entry = next(
        item for item in manifest if item["name"] == "assessment_interview_resume_requested"
    )
    assert entry["source_event"] == INTERVIEW_RESUME_COMMAND
    assert entry["target"].endswith("AssessmentInterviewResumeBoundary")


def test_interview_resume_boundary_passes_private_context_only_to_interview_and_persists_waiting() -> None:
    api = RecordingApi()
    dispatcher = RecordingDispatcher()
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        api_client=api,
        dispatcher=dispatcher,
    )

    boundary.handle(_message(), "corr-1")

    assert api.private_context_calls == [
        ("assessment-1", 2, "snapshot-1:abc", "ter-1:v1")
    ]
    assert len(dispatcher.calls) == 1
    instruction = dispatcher.calls[0]["instruction"]
    assert '"freeText": "raw"' in instruction
    assert "private worker-only input" in instruction
    assert "must not be copied into Customer-safe evidence or downstream prompts" in instruction
    assert '"guidanceVersion": "guidance-v1"' in instruction
    assert '"workingStrategy"' in instruction
    assert '"human oversight": "manual review"' in instruction
    assert "use the session-local workingStrategy only to adapt terminology and phrasing" in instruction
    assert "every WAITING_FOR_CUSTOMER activeQuestion MUST include frontier" in instruction
    assert "CLARIFY BOOLEAN or SINGLE_SELECT answers never grant CUSTOMER_CONFIRMED" in instruction
    assert "control=CONFIRM_ADJUST" in instruction
    assert "never use sourceVersion, pgeVersion, raw artifact ids" in instruction
    assert len(api.decision_posts) == 1
    assessment_id, decision = api.decision_posts[0]
    assert assessment_id == "assessment-1"
    assert decision["expectedContextRevision"] == 2
    assert decision["outcome"] == "WAITING_FOR_CUSTOMER"
    assert decision["activeQuestion"]["id"] == "agent-question-next"


def test_interview_resume_boundary_rejects_a_non_server_thread() -> None:
    api = RecordingApi()
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        api_client=api,
        dispatcher=RecordingDispatcher(),
    )
    message = _message()
    message["threadId"] = "interview:other-assessment"

    with pytest.raises(ValueError, match="server-owned Interview thread"):
        boundary.handle(message, "corr-wrong-thread")
    assert api.decision_posts == []


def test_guard_persists_before_any_downstream_continuation() -> None:
    order = []
    ready = {
        "expectedContextRevision": 0,
        "mode": "INITIAL_INTERVIEW",
        "outcome": "CONTEXT_READY",
        "contextAuthority": "CUSTOMER_CONFIRMED",
        "confirmedContext": _minimum_planning_confirmed_context(),
        "flags": [],
        "blockedActions": [],
        "targetedResolution": {},
    }
    api = RecordingApi(order=order)
    # Non-interpretive direct-ASK answer: this test is about guard/downstream
    # ordering, not authority-provenance tightening, so it must not trip the
    # (now-tightened) local preflight into a repair round-trip.
    context = api.get_interview_private_context("assessment-1", 2)
    context["privateRevision"] = {
        "actorId": "user-test-actor",
        "questionIntent": "ASK",
        "questionControl": "BOOLEAN",
        "answer": {"selectedChoiceIds": ["yes"]},
    }
    api.get_interview_private_context = Mock(return_value=context)
    dispatcher = RecordingDispatcher(ready, order=order)
    downstream_calls = []

    def downstream(payload, correlation_id):
        order.append("downstream")
        downstream_calls.append((payload, correlation_id))

    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        api_client=api,
        dispatcher=dispatcher,
        downstream_handler=downstream,
    )

    boundary.handle(_message(), "corr-1")

    assert order == ["interview", "guard", "downstream"]
    assert downstream_calls[0][0]["outcome"] == "CONTEXT_READY"


def test_interview_resume_boundary_duplicate_delivery_is_idempotent() -> None:
    api = RecordingApi(status="DUPLICATE")
    dispatcher = RecordingDispatcher()
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(), api_client=api, dispatcher=dispatcher
    )

    boundary.handle(_message(), "corr-1")

    assert dispatcher.calls == []
    assert api.decision_posts == []


def test_interview_resume_boundary_stale_provenance_reenters_root_revalidation() -> None:
    from tools.common.capabilities.workflow.recovery.interview_boundary import (
        InterviewRevalidationRequired,
    )

    api = RecordingApi(status="STALE_PROVENANCE")
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(), api_client=api, dispatcher=RecordingDispatcher()
    )

    with pytest.raises(
        InterviewRevalidationRequired,
        match="ASSESSMENT_INTERVIEW_REVALIDATION_REQUIRED",
    ):
        boundary.handle(_message(), "corr-1")

    assert api.decision_posts == []


def test_provide_more_context_bootstrap_persists_next_interview_question_once() -> None:
    api = RecordingApi(
        status="DUPLICATE",
        public_state={
            "outcome": "BLOCKED_OR_UNRESOLVED",
            "contextRevision": 0,
            "orchestrationRequested": True,
        },
    )
    dispatcher = RecordingDispatcher()
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        api_client=api,
        dispatcher=dispatcher,
    )

    boundary.handle(
        _message(reason="PROVIDE_MORE_CONTEXT", revision=0),
        "corr-1",
    )

    assert api.private_context_calls == [
        ("assessment-1", 0, "snapshot-1:abc", "ter-1:v1")
    ]
    assert len(dispatcher.calls) == 1
    assert dispatcher.calls[0]["trigger"] == "PROVIDE_MORE_CONTEXT"
    assert len(api.decision_posts) == 1
    assert api.decision_posts[0][1]["outcome"] == "WAITING_FOR_CUSTOMER"


def test_provide_more_context_duplicate_after_question_materialized_is_noop() -> None:
    api = RecordingApi(
        status="DUPLICATE",
        public_state={
            "outcome": "WAITING_FOR_CUSTOMER",
            "contextRevision": 0,
            "orchestrationRequested": False,
            "activeQuestion": {"id": "already-materialized"},
        },
    )
    dispatcher = RecordingDispatcher()
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(), api_client=api, dispatcher=dispatcher
    )

    boundary.handle(_message(reason="PROVIDE_MORE_CONTEXT", revision=0), "corr-2")

    assert dispatcher.calls == []
    assert api.decision_posts == []


def test_targeted_interview_missing_frontier_is_repaired_from_trusted_need(caplog) -> None:
    specialist = Mock()
    specialist.invoke.return_value = {
        "structured_response": {
            "expectedContextRevision": 2,
            "mode": "BUSINESS_CONTEXT_RESOLUTION",
            "outcome": "WAITING_FOR_CUSTOMER",
            "activeQuestion": {
                "id": "incident-follow-up",
                "intent": "ASK",
                "control": "FREE_TEXT",
                "prompt": "Describe the serious-incident suspension process.",
            },
            "contextAuthority": "CUSTOMER_STATED",
            "confirmedContext": {},
            "flags": [],
            "blockedActions": [],
            "targetedResolution": {},
        }
    }
    dispatcher = RootSubagentDispatcher(
        agent_factory=Mock(return_value=specialist),
        subagents={
            "interview": {
                "name": "interview",
                "model": "fake-model",
                "tools": [],
                "system_prompt": "",
                "middleware": [],
                "response_format": InterviewResult,
            }
        },
    )
    targeted_need = {
        "needId": "incident_containment_control_mechanism",
        "businessContextNeed": (
            "Confirm whether the system has operational procedures or automated "
            "controls to suspend, withdraw, or disable the AI system upon a "
            "serious incident."
        ),
        "governedEvidenceRefs": ["evidence:customer-authorized-1"],
    }

    with caplog.at_level("WARNING", logger="orchestration.result_validation"):
        result = dispatcher.dispatch(
            subagent_type="interview",
            instruction="Ask a targeted follow-up.",
            metadata={"targeted_need": targeted_need},
            context=LCSPRunContext(
                assessment_id="assessment-1",
                user_id="actor-1",
                workflow_run_id="workflow-1",
            ),
        )

    frontier = result["handoff"]["activeQuestion"]["frontier"]
    assert frontier == {
        "owner": "CUSTOMER",
        "materiality": "MATERIAL",
        "description": targeted_need["businessContextNeed"],
        "evidenceRefs": targeted_need["governedEvidenceRefs"],
    }
    assert result["handoff"]["activeQuestion"]["needId"] == targeted_need["needId"]
    assert set(frontier["evidenceRefs"]) <= set(targeted_need["governedEvidenceRefs"])
    assert "INTERVIEW_TARGETED_FRONTIER_REPAIRED" in caplog.text
    assert "targeted_need_id=incident_containment_control_mechanism" in caplog.text


def test_targeted_interview_frontier_repair_reads_need_materiality(caplog) -> None:
    specialist = Mock()
    specialist.invoke.return_value = {
        "structured_response": {
            "expectedContextRevision": 2,
            "mode": "BUSINESS_CONTEXT_RESOLUTION",
            "outcome": "WAITING_FOR_CUSTOMER",
            "activeQuestion": {
                "id": "optional-follow-up",
                "intent": "ASK",
                "control": "FREE_TEXT",
                "prompt": "Clarify the optional business context.",
            },
            "contextAuthority": "CUSTOMER_STATED",
            "confirmedContext": {},
            "flags": [],
            "blockedActions": [],
            "targetedResolution": {},
        }
    }
    dispatcher = RootSubagentDispatcher(
        agent_factory=Mock(return_value=specialist),
        subagents={
            "interview": {
                "name": "interview",
                "model": "fake-model",
                "tools": [],
                "system_prompt": "",
                "middleware": [],
                "response_format": InterviewResult,
            }
        },
    )

    with caplog.at_level("WARNING", logger="orchestration.result_validation"):
        result = dispatcher.dispatch(
            subagent_type="interview",
            instruction="Ask a targeted follow-up.",
            metadata={
                "targeted_need": {
                    "needId": "optional-need",
                    "businessContextNeed": "Clarify optional deployment context.",
                    "materiality": "material",
                    "governedEvidenceRefs": [],
                }
            },
            context=LCSPRunContext(
                assessment_id="assessment-1",
                user_id="actor-1",
                workflow_run_id="workflow-1",
            ),
        )

    assert result["handoff"]["activeQuestion"]["frontier"]["materiality"] == "MATERIAL"
    assert "materiality_source=targeted_need" in caplog.text


def test_non_targeted_missing_frontier_still_fails_closed() -> None:
    specialist = Mock()
    specialist.invoke.return_value = {
        "structured_response": {
            "expectedContextRevision": 2,
            "mode": "INITIAL_INTERVIEW",
            "outcome": "WAITING_FOR_CUSTOMER",
            "activeQuestion": {
                "id": "missing-frontier",
                "intent": "ASK",
                "control": "FREE_TEXT",
                "prompt": "Please clarify the business context.",
            },
            "contextAuthority": "CUSTOMER_STATED",
            "confirmedContext": {},
            "flags": [],
            "blockedActions": [],
            "targetedResolution": {},
        }
    }
    dispatcher = RootSubagentDispatcher(
        agent_factory=Mock(return_value=specialist),
        subagents={
            "interview": {
                "name": "interview",
                "model": "fake-model",
                "tools": [],
                "system_prompt": "",
                "middleware": [],
                "response_format": InterviewResult,
            }
        },
    )

    with pytest.raises(SpecialistHandoffValidationError, match="structured frontier"):
        dispatcher.dispatch(
            subagent_type="interview",
            instruction="Ask a generic follow-up.",
            metadata={},
            context=LCSPRunContext(
                assessment_id="assessment-1",
                user_id="actor-1",
                workflow_run_id="workflow-1",
            ),
        )


def test_targeted_duplicate_after_question_materialized_is_noop() -> None:
    class TargetedDuplicateApi(RecordingApi):
        def get_interview_private_context(self, *args, **kwargs):
            result = super().get_interview_private_context(*args, **kwargs)
            result["targetedNeed"] = {
                "needId": "need-1",
                "businessContextNeed": "Who approves?",
                "resolutionCriteria": ["decision_authority"],
                "originatingRuleAnalysisReference": "investigator:exec-1:need-1",
            }
            return result

    api = TargetedDuplicateApi(
        status="DUPLICATE",
        public_state={
            "outcome": "WAITING_FOR_CUSTOMER",
            "contextRevision": 2,
            "orchestrationRequested": False,
            "activeQuestion": {"id": "targeted-question"},
        },
    )
    dispatcher = RecordingDispatcher()
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(), api_client=api, dispatcher=dispatcher
    )

    boundary.handle(_message(reason="BUSINESS_CONTEXT_RESOLUTION_REQUIRED"), "corr-3")

    assert dispatcher.calls == []
    assert api.decision_posts == []


def test_context_resolved_resumes_exact_managed_investigator_without_root() -> None:
    # Root cause: the deleted ManagedTargetedInvestigatorPipeline resumed an
    # investigator execution via investigator_resumer/investigation_completer.
    # Fix: the new per-rule resume is AssessmentInterviewResumeBoundary guard +
    # durable post-guard store + strict _bind_answer_to_need to the single
    # registered need/rule, with analyze_rule preserving the prior accepted
    # result on a failed resume. No root re-entry, no deleted pipeline.
    from tools.common.capabilities.workflow.recovery.interview_boundary import (
        _bind_answer_to_need,
    )
    from tools.common.capabilities.workflow.recovery.post_guard_continuation import (
        EphemeralPostGuardContinuationStore,
    )
    from tools.common.capabilities.assessment.planning.engineering_rule.confirmed_business_context import (
        normalize_confirmed_structured_business_context,
    )

    continuation = {
        "needId": "need-1",
        "engineeringRuleId": "ENG-1",
        "criterionId": "CONTROL",
        "resolutionCriterionIds": ["CONTROL"],
        "sourceVersion": "snapshot-1:abc",
        "pgeVersion": "ter-1:v1",
    }

    def _stamped_confirmed() -> dict:
        ctx = _confirmed_context()
        stmt = dict(ctx["statements"][0])
        stmt["sourceNeedId"] = "need-1"
        stmt["resolvedCriterionIds"] = ["CONTROL"]
        ctx = dict(ctx)
        ctx["statements"] = [stmt]
        return ctx

    class TargetedApi(RecordingApi):
        def get_interview_private_context(self, *args, **kwargs):
            result = super().get_interview_private_context(*args, **kwargs)
            result["targetedNeed"] = {
                "needId": "need-1",
                "engineeringRuleId": "ENG-1",
                "criterionId": "CONTROL",
                "resolutionCriterionIds": ["CONTROL"],
                "businessContextNeed": "Who approves?",
            }
            # Non-interpretive direct-ASK answer (predefined choice, no comment): this
            # test is about exact-resume continuation identity, not authority-provenance
            # tightening, so it must stay directly lossless and resolve in one turn.
            result["privateRevision"] = {
                "actorId": "user-test-actor",
                "questionIntent": "ASK",
                "questionControl": "SINGLE_SELECT",
                "answer": {"selectedChoiceIds": ["human"]},
            }
            return result

        def post_interview_agent_decision(self, assessment_id, payload):
            super().post_interview_agent_decision(assessment_id, payload)
            return {
                "outcome": "CONTEXT_RESOLVED",
                "confirmedContext": _stamped_confirmed(),
                "continuation": dict(continuation),
            }

    targeted_handoff = {
        "expectedContextRevision": 0,
        "mode": "BUSINESS_CONTEXT_RESOLUTION",
        "outcome": "CONTEXT_RESOLVED",
        "contextAuthority": "CUSTOMER_CONFIRMED",
        "confirmedContext": _stamped_confirmed(),
        "flags": [],
        "blockedActions": [],
        "targetedResolution": {},
    }
    api = TargetedApi()
    store = EphemeralPostGuardContinuationStore()
    downstream_calls: list[tuple[dict, str]] = []

    def downstream(payload, correlation_id):
        downstream_calls.append((payload, correlation_id))

    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        api_client=api,
        dispatcher=RecordingDispatcher(targeted_handoff),
        downstream_handler=downstream,
        continuation_store=store,
    )

    boundary.handle(_message(reason="BUSINESS_CONTEXT_RESOLUTION_REQUIRED"), "corr-1")

    # Exact resume without root: one interview turn, one guard, one downstream.
    assert len(api.decision_posts) == 1
    assert len(downstream_calls) == 1
    assert downstream_calls[0][0]["outcome"] == "CONTEXT_RESOLVED"
    assert downstream_calls[0][0]["contextRevision"] == 2
    record = store.get(
        assessment_id="assessment-1", context_revision=2, outcome="CONTEXT_RESOLVED"
    )
    assert record is not None and record.completed
    assert record.payload["continuation"]["needId"] == "need-1"

    # Strict answer binding: the stamped answer resolves only its exact need/rule.
    guarded_confirmed = _stamped_confirmed()
    typed = normalize_confirmed_structured_business_context(
        {
            "outcome": "CONTEXT_RESOLVED",
            "contextRevision": 2,
            "confirmedContext": guarded_confirmed,
        },
        assessment_id="assessment-1",
    )
    assert typed.to_legacy_customer_context()["answers"] == {
        "decision_authority": "human"
    }
    assert _bind_answer_to_need(dict(continuation), typed) == "ENG-1"
    with pytest.raises(RuntimeError):
        _bind_answer_to_need({**continuation, "needId": "need:foreign"}, typed)
    with pytest.raises(RuntimeError):
        _bind_answer_to_need(
            {**continuation, "resolutionCriterionIds": ["OTHER"]}, typed
        )


def test_targeted_free_text_answer_converges_via_synthesis_after_extra_confirm_turn() -> None:
    # Brief requirement (lcsp-tighten-direct-lossless.md): targeted questions are
    # usually FREE_TEXT. After tightening, a targeted FREE_TEXT answer needs one
    # extra CONFIRM_ADJUST turn before CONTEXT_RESOLVED can become authoritative.
    # Turn 1 must converge locally to a WAITING_FOR_CUSTOMER CONFIRM_ADJUST question
    # (never propagate/raise on INTERVIEW_CONTEXT_RESOLVED_REQUIRES_AUTHORITY, never
    # resume the rule early). Turn 2, after the customer's real CONFIRM,
    # must resume exactly the registered need/rule via the new per-rule path.
    from tools.common.capabilities.workflow.recovery.interview_boundary import (
        _bind_answer_to_need,
    )
    from tools.common.capabilities.workflow.recovery.post_guard_continuation import (
        EphemeralPostGuardContinuationStore,
    )
    from tools.common.capabilities.assessment.planning.engineering_rule.confirmed_business_context import (
        normalize_confirmed_structured_business_context,
    )

    continuation = {
        "needId": "need-1",
        "engineeringRuleId": "ENG-1",
        "criterionId": "CONTROL",
        "resolutionCriterionIds": ["CONTROL"],
        "sourceVersion": "snapshot-1:abc",
        "pgeVersion": "ter-1:v1",
    }

    def _stamped_confirmed(revision: int = 2) -> dict:
        ctx = _confirmed_context()
        ctx = dict(ctx)
        ctx["contextRevision"] = revision
        stmt = dict(ctx["statements"][0])
        stmt["sourceNeedId"] = "need-1"
        stmt["resolvedCriterionIds"] = ["CONTROL"]
        ctx["statements"] = [stmt]
        return ctx

    targeted_handoff = {
        "expectedContextRevision": 0,
        "mode": "BUSINESS_CONTEXT_RESOLUTION",
        "outcome": "CONTEXT_RESOLVED",
        "contextAuthority": "CUSTOMER_CONFIRMED",
        "confirmedContext": _stamped_confirmed(2),
        "flags": [],
        "blockedActions": [],
        "targetedResolution": {},
    }

    def with_targeted_need(result: dict) -> dict:
        result["targetedNeed"] = {
            "needId": "need-1",
            "engineeringRuleId": "ENG-1",
            "criterionId": "CONTROL",
            "resolutionCriterionIds": ["CONTROL"],
            "businessContextNeed": "Who approves?",
        }
        return result

    # --- Turn 1: targeted FREE_TEXT answer; specialist wrongly claims CUSTOMER_CONFIRMED ---
    class TurnOneApi(RecordingApi):
        def get_interview_private_context(self, *args, **kwargs):
            result = with_targeted_need(super().get_interview_private_context(*args, **kwargs))
            result["privateRevision"] = {
                "actorId": "user-test-actor",
                "questionIntent": "ASK",
                "questionControl": "FREE_TEXT",
                "answer": {"freeText": "Only human reviewers approve AI decisions"},
            }
            return result

    api_turn_1 = TurnOneApi()
    downstream_turn_1: list[tuple[dict, str]] = []
    boundary_turn_1 = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        api_client=api_turn_1,
        dispatcher=RecordingDispatcher(targeted_handoff),
        downstream_handler=lambda p, c: downstream_turn_1.append((p, c)),
        continuation_store=EphemeralPostGuardContinuationStore(),
    )

    boundary_turn_1.handle(
        _message(reason="BUSINESS_CONTEXT_RESOLUTION_REQUIRED", revision=2), "corr-1"
    )

    assert downstream_turn_1 == []
    assert len(api_turn_1.decision_posts) == 1
    posted_turn_1 = api_turn_1.decision_posts[0][1]
    assert posted_turn_1["outcome"] == "WAITING_FOR_CUSTOMER"
    assert posted_turn_1["contextAuthority"] == "CUSTOMER_STATED"
    assert posted_turn_1["activeQuestion"]["control"] == "CONFIRM_ADJUST"

    # --- Turn 2: the customer selected CONFIRM on that synthesized question ---
    class TurnTwoApi(RecordingApi):
        def get_interview_private_context(self, *args, **kwargs):
            result = with_targeted_need(super().get_interview_private_context(*args, **kwargs))
            result["privateRevision"] = {
                "actorId": "user-test-actor",
                "questionId": posted_turn_1["activeQuestion"]["id"],
                "questionIntent": "CLARIFY",
                "questionControl": "CONFIRM_ADJUST",
                "answer": {"confirmed": True},
            }
            return result

        def post_interview_agent_decision(self, assessment_id, payload):
            super().post_interview_agent_decision(assessment_id, payload)
            return {
                "outcome": "CONTEXT_RESOLVED",
                "confirmedContext": _stamped_confirmed(3),
                "continuation": dict(continuation),
            }

    api_turn_2 = TurnTwoApi()
    downstream_turn_2: list[tuple[dict, str]] = []
    store_2 = EphemeralPostGuardContinuationStore()
    boundary_turn_2 = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        api_client=api_turn_2,
        dispatcher=RecordingDispatcher(targeted_handoff),
        downstream_handler=lambda p, c: downstream_turn_2.append((p, c)),
        continuation_store=store_2,
    )

    boundary_turn_2.handle(
        _message(reason="BUSINESS_CONTEXT_RESOLUTION_REQUIRED", revision=3), "corr-2"
    )

    assert len(downstream_turn_2) == 1
    assert downstream_turn_2[0][0]["outcome"] == "CONTEXT_RESOLVED"
    record = store_2.get(
        assessment_id="assessment-1", context_revision=3, outcome="CONTEXT_RESOLVED"
    )
    assert record is not None and record.completed
    assert record.payload["continuation"]["needId"] == "need-1"
    # Strict binding on the resolved turn: only the exact need binds.
    typed = normalize_confirmed_structured_business_context(
        {
            "outcome": "CONTEXT_RESOLVED",
            "contextRevision": 3,
            "confirmedContext": _stamped_confirmed(3),
        },
        assessment_id="assessment-1",
    )
    assert _bind_answer_to_need(dict(continuation), typed) == "ENG-1"


def test_exact_resume_rejects_wrong_investigator_execution() -> None:
    # Root cause: the deleted _resume_exact_investigator checked
    # investigatorExecutionId identity ("execution identity drifted").
    # Fix: the new per-rule exact resume checks server-owned need/rule identity
    # via _bind_answer_to_need plus artifact-pin freshness via
    # _validate_guarded_continuation_pins. Any drift fails closed.
    from tools.common.capabilities.workflow.recovery.interview_boundary import (
        _bind_answer_to_need,
        _validate_guarded_continuation_pins,
    )
    from tools.common.capabilities.assessment.planning.engineering_rule.confirmed_business_context import (
        normalize_confirmed_structured_business_context,
    )

    continuation = {
        "needId": "need-1",
        "engineeringRuleId": "ENG-1",
        "criterionId": "CONTROL",
        "resolutionCriterionIds": ["CONTROL"],
        "sourceVersion": "snapshot-1:abc",
        "pgeVersion": "ter-1:v1",
    }

    def _stamped() -> dict:
        ctx = _confirmed_context()
        stmt = dict(ctx["statements"][0])
        stmt["sourceNeedId"] = "need-1"
        stmt["resolvedCriterionIds"] = ["CONTROL"]
        ctx = dict(ctx)
        ctx["statements"] = [stmt]
        return ctx

    typed = normalize_confirmed_structured_business_context(
        {
            "outcome": "CONTEXT_RESOLVED",
            "contextRevision": 2,
            "confirmedContext": _stamped(),
        },
        assessment_id="assessment-1",
    )

    # Exact scope: the registered need/rule binds.
    assert _bind_answer_to_need(dict(continuation), typed) == "ENG-1"
    # Wrong execution identity (foreign need) is rejected, not resumed.
    with pytest.raises(RuntimeError, match="does not resolve the pending need"):
        _bind_answer_to_need({**continuation, "needId": "need:wrong-exec"}, typed)
    # Wrong criterion scope is rejected.
    with pytest.raises(RuntimeError, match="outside its need"):
        _bind_answer_to_need(
            {**continuation, "resolutionCriterionIds": ["WRONG_CRITERION"]}, typed
        )
    # Stale artifact pins are rejected.
    with pytest.raises(RuntimeError, match="source version is stale"):
        _validate_guarded_continuation_pins(
            {**continuation, "sourceVersion": "snapshot-1:stale"},
            source_version="snapshot-1:abc",
            pge_version="ter-1:v1",
        )
    with pytest.raises(RuntimeError, match="PGE version is stale"):
        _validate_guarded_continuation_pins(
            {**continuation, "pgeVersion": "ter-1:stale"},
            source_version="snapshot-1:abc",
            pge_version="ter-1:v1",
        )
    # Missing need identity fails closed.
    with pytest.raises(RuntimeError, match="does not identify one need and rule"):
        _bind_answer_to_need({"engineeringRuleId": "ENG-1"}, typed)


def test_interview_resume_boundary_rejects_missing_revision() -> None:
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        api_client=RecordingApi(),
        dispatcher=RecordingDispatcher(),
    )

    with pytest.raises(ValueError, match="contextRevision"):
        message = _message()
        message.pop("contextRevision")
        boundary.handle(message, "corr-1")

def test_context_resolved_targeted_scope_exclusion_closes_without_investigator() -> None:
    # Root cause: the deleted pipeline closed scope via RULE_SCOPE_NOT_APPLICABLE
    # claims from investigation_completer.
    # Fix: the new deterministic applicability gate decides NOT_APPLICABLE from
    # the customer-confirmed statement; finalize closes without any
    # repository-analyst dispatch (no repository work), with lazy need handling
    # and no absence semantics.
    from tools.common.capabilities.workflow.recovery.interview_boundary import (
        _bind_answer_to_need,
    )
    from tools.common.capabilities.workflow.recovery.post_guard_continuation import (
        EphemeralPostGuardContinuationStore,
    )
    from tools.common.capabilities.assessment.planning.engineering_rule.confirmed_business_context import (
        normalize_confirmed_structured_business_context,
    )
    from tools.common.capabilities.assessment.planning.engineering_rule.rule_applicability_gate import (
        APPLICABILITY_STATUSES,
        evaluate_applicability,
    )
    from tools.common.capabilities.assessment.rule_assessment.run import (
        finalize_rule_results,
        register_business_needs,
    )
    from tools.common.capabilities.assessment.rule_assessment.values import (
        RULE_ANALYSIS_STATUSES,
    )
    from tools.legal.corpus.engineering_rules.contract.models import EngineeringRule

    continuation = {
        "needId": "need-1",
        "engineeringRuleId": "ENG-SCOPE-1",
        "criterionId": "national_data_source_reuse",
        "resolutionCriterionIds": ["national_data_source_reuse"],
        "sourceVersion": "snapshot-1:abc",
        "pgeVersion": "ter-1:v1",
    }
    confirmed_context = _confirmed_context()
    confirmed_context["contextRevision"] = 2
    confirmed_context["statements"] = [
        {
            "statementId": "stmt-national-data",
            "topic": "national_data_source_reuse",
            "statement": "No national data repository source is reused.",
            "normalizedValue": False,
            "scope": {"needId": "need-1"},
            "evidenceRefs": ["technicalEvidenceReport:ter-1"],
            "respondentRef": "actor:authenticated:1",
            "createdAt": "2026-09-05T00:00:00Z",
            "source": "CUSTOMER_CONFIRMED",
            "resolutionState": "CONFIRMED",
            "sourceNeedId": "need-1",
            "resolvedCriterionIds": ["national_data_source_reuse"],
        }
    ]

    class TargetedApi(RecordingApi):
        def get_interview_private_context(self, *args, **kwargs):
            result = super().get_interview_private_context(*args, **kwargs)
            result["targetedNeed"] = {
                "needId": "need-1",
                "engineeringRuleId": "ENG-SCOPE-1",
                "criterionId": "national_data_source_reuse",
                "resolutionCriterionIds": ["national_data_source_reuse"],
                "businessContextNeed": "Confirm whether the system reuses a national data repository source.",
            }
            # Non-interpretive direct-ASK answer (predefined choice, no comment): this
            # test is about the deterministic scope-exclusion path, not authority-
            # provenance tightening, so it must stay directly lossless.
            result["privateRevision"] = {
                "actorId": "user-test-actor",
                "questionIntent": "ASK",
                "questionControl": "BOOLEAN",
                "answer": {"selectedChoiceIds": ["no"]},
            }
            return result

        def post_interview_agent_decision(self, assessment_id, payload):
            super().post_interview_agent_decision(assessment_id, payload)
            return {
                "outcome": "CONTEXT_RESOLVED",
                "confirmedContext": dict(confirmed_context),
                "continuation": dict(continuation),
            }

    targeted_handoff = {
        "expectedContextRevision": 0,
        "mode": "BUSINESS_CONTEXT_RESOLUTION",
        "outcome": "CONTEXT_RESOLVED",
        "contextAuthority": "CUSTOMER_CONFIRMED",
        "confirmedContext": dict(confirmed_context),
        "flags": [],
        "blockedActions": [],
        "targetedResolution": {},
    }
    api = TargetedApi()
    store = EphemeralPostGuardContinuationStore()
    downstream_calls: list[tuple[dict, str]] = []

    # No repository work may happen on this path: fail if an analyst is dispatched.
    analyst_calls: list[dict] = []

    class _ForbiddenAnalyst:
        def dispatch(self, **kwargs):
            analyst_calls.append(kwargs)
            raise AssertionError("scope-excluded rule must not dispatch repository work")

    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        api_client=api,
        dispatcher=RecordingDispatcher(targeted_handoff),
        downstream_handler=lambda p, c: downstream_calls.append((p, c)),
        continuation_store=store,
    )

    boundary.handle(_message(reason="BUSINESS_CONTEXT_RESOLUTION_REQUIRED"), "corr-1")

    assert len(downstream_calls) == 1
    assert downstream_calls[0][0]["outcome"] == "CONTEXT_RESOLVED"
    assert analyst_calls == []
    record = store.get(
        assessment_id="assessment-1", context_revision=2, outcome="CONTEXT_RESOLVED"
    )
    assert record is not None and record.completed

    # Strict binding still holds for the scope answer.
    typed = normalize_confirmed_structured_business_context(
        {
            "outcome": "CONTEXT_RESOLVED",
            "contextRevision": 2,
            "confirmedContext": dict(confirmed_context),
        },
        assessment_id="assessment-1",
    )
    assert _bind_answer_to_need(dict(continuation), typed) == "ENG-SCOPE-1"

    # Deterministic scope exclusion: the False statement makes the legal rule
    # NOT_APPLICABLE, so finalize closes without analysis.
    rule = EngineeringRule(
        engineering_rule_id="ENG-SCOPE-1",
        legal_rule_id="LEGAL-SCOPE-1",
        legal_rule_catalog_version_id="catalog-1",
        legal_corpus_version_id="corpus-1",
        concept="national data reuse",
        legal_intent={},
        investigation_goals=("inspect national data reuse",),
        starting_node_types=("AI_MODEL_INVOCATION",),
        target_node_types=("AI_MODEL_INVOCATION",),
        edge_strategies=(),
        graph_queries=(),
        required_evidence=("CONTROL",),
        source_chunk_ids=("chunk-1",),
        source_locators=("Article 1",),
    )
    gate = evaluate_applicability(
        [
            {
                "legalRuleId": "LEGAL-SCOPE-1",
                "requiredFacts": [
                    {"field": "nationalDataSourceReuse", "expectedValue": True}
                ],
            }
        ],
        ai_discovery=None,
        confirmed_statements=[
            {
                "topic": "national_data_source_reuse",
                "normalizedValue": False,
                "statementId": "stmt-national-data",
                "statement": "No national data repository source is reused.",
            }
        ],
        engineering_rule_ids_by_legal={"LEGAL-SCOPE-1": ["ENG-SCOPE-1"]},
    )
    assert gate["LEGAL-SCOPE-1"]["status"] == APPLICABILITY_STATUSES["not_applicable"]

    class _LedgerApi:
        def __init__(self):
            self.rows: list[dict] = []

        def list_rule_assessments(self, assessment_id):
            assert assessment_id == "assessment-1"
            return list(self.rows)

        def put_rule_assessment(self, assessment_id, engineering_rule_id, payload):
            raise AssertionError("NOT_APPLICABLE must not write a rule row")

    evaluations = finalize_rule_results(
        assessment_id="assessment-1",
        rules=[rule],
        api=_LedgerApi(),
        applicability_facts={
            "legal_rules": [{"legalRuleId": "ENG-SCOPE-1"}],
            "ai_discovery": None,
            "confirmed_statements": (),
        },
        context_revision=2,
        applicability={"ENG-SCOPE-1": {"status": APPLICABILITY_STATUSES["not_applicable"]}},
        commit_sha="abc123",
    )
    assert evaluations[0].status == "NOT_APPLICABLE"
    assert analyst_calls == []
    # Lazy needs: a decided row registers nothing.
    assert (
        register_business_needs(
            rule=rule,
            assessment={
                "status": RULE_ANALYSIS_STATUSES["completed"],
                "criteria": [],
                "contextRevision": 2,
            },
            context=SimpleNamespace(
                workflow_run_id="run-scope",
                artifact_versions={},
                assessment_id="assessment-1",
            ),
            api=SimpleNamespace(
                post_interview_targeted_need=lambda *a, **k: (_ for _ in ()).throw(
                    AssertionError("no need should register")
                )
            ),
            user_id="user-test-actor",
        )
        == []
    )


def _readiness_decision(*statements: dict, mode: str = "INITIAL_INTERVIEW") -> dict:
    return {
        "mode": mode,
        "outcome": "CONTEXT_READY" if mode == "INITIAL_INTERVIEW" else "CONTEXT_RESOLVED",
        "contextAuthority": "CUSTOMER_CONFIRMED",
        "confirmedContext": {"statements": list(statements)},
    }


def _statement(statement: str, *, topic: str = "interview_answer", normalized=None) -> dict:
    return {
        "statementId": f"stmt-{abs(hash(statement))}",
        "topic": topic,
        "statement": statement,
        "normalizedValue": statement if normalized is None else normalized,
    }


_ALL_PLANNING_DIMENSIONS = [
    "aiUsage",
    "operationalProcess",
    "decisionInfluence",
    "humanOversight",
    "affectedSubjects",
    "dataCategories",
]


def test_minimum_context_a_one_shallow_answer_is_not_ready():
    from tools.common.capabilities.workflow.recovery.interview_boundary import (
        _missing_initial_planning_context_dimensions,
    )

    missing = _missing_initial_planning_context_dimensions(
        _readiness_decision(_statement("We use Gemini to analyze repository code."))
    )

    assert "aiUsage" not in missing
    assert "dataCategories" not in missing
    for dimension in ("decisionInfluence", "humanOversight", "affectedSubjects", "operationalProcess"):
        assert dimension in missing


def test_minimum_context_b_one_rich_answer_resolves_every_dimension():
    from tools.common.capabilities.workflow.recovery.interview_boundary import (
        _missing_initial_planning_context_dimensions,
    )

    rich = (
        "The system uses Gemini to analyze repositories and draft compliance findings. "
        "The findings do not automatically change customer systems or approve deployments; "
        "a user reviews them before any remediation action. The affected process is the "
        "compliance assessment workflow, and the analyzed material includes repository "
        "source code and assessment metadata."
    )

    assert _missing_initial_planning_context_dimensions(
        _readiness_decision(_statement(rich))
    ) == []


def test_minimum_context_c_explicit_decision_negative_resolves_only_that_dimension():
    from tools.common.capabilities.workflow.recovery.interview_boundary import (
        _missing_initial_planning_context_dimensions,
    )

    missing = _missing_initial_planning_context_dimensions(
        _readiness_decision(
            _statement("AI never directly approves, blocks, or deploys changes.")
        )
    )

    assert "decisionInfluence" not in missing
    # A decision-level negative is neither human oversight nor an absence of AI.
    assert "humanOversight" in missing
    assert "affectedSubjects" in missing
    assert "dataCategories" in missing


def test_minimum_context_d_unknown_answer_stays_unknown_and_is_not_a_negative():
    from tools.common.capabilities.workflow.recovery.interview_boundary import (
        _missing_initial_planning_context_dimensions,
    )

    unknown = _statement(
        "I am not sure whether AI output can automatically trigger a workflow gate.",
        topic="decision_influence",
        normalized="UNKNOWN",
    )
    missing = _missing_initial_planning_context_dimensions(_readiness_decision(unknown))

    # Root cause: the deleted RulePlanningBusinessScope used to model
    # DECISION_PATH_UNRESOLVED/UNKNOWN. The new per-rule runtime keeps the same
    # invariant via the minimum-context gate + deterministic finalize.
    # Fix: an explicit UNKNOWN answer resolves its own dimension (it was asked
    # and answered) but never counts as a negative and never short-circuits
    # readiness like an explicit "no AI" statement.
    # The customer explicitly answered the decision-effect question as unknown ...
    assert "decisionInfluence" not in missing
    # ... which does not short-circuit readiness like an explicit "no AI" statement.
    assert missing
    # Contrast: explicit absence short-circuits; UNKNOWN must not.
    assert (
        _missing_initial_planning_context_dimensions(
            _readiness_decision(_statement("We do not use AI in this product."))
        )
        == []
    )
    # Without evidenced decision effect the rule outcome stays UNKNOWN (epistemic),
    # never a negative: NOT_OBSERVED finalizes UNKNOWN, never NON_COMPLIANT.
    from tools.common.capabilities.assessment.rule_assessment.run import (
        finalize_rule_results,
    )
    from tools.common.capabilities.assessment.rule_assessment.values import (
        RULE_ANALYSIS_STATUSES,
        RULE_CRITERION_STATUSES,
    )
    from tools.legal.corpus.engineering_rules.contract.models import EngineeringRule

    rule = EngineeringRule(
        engineering_rule_id="ENG-UNKNOWN-1",
        legal_rule_id="LEGAL-UNKNOWN-1",
        legal_rule_catalog_version_id="catalog-1",
        legal_corpus_version_id="corpus-1",
        concept="unknown decision effect",
        legal_intent={},
        investigation_goals=("inspect unknown",),
        starting_node_types=("AI_MODEL_INVOCATION",),
        target_node_types=("AI_MODEL_INVOCATION",),
        edge_strategies=(),
        graph_queries=(),
        required_evidence=("CONTROL",),
        source_chunk_ids=("chunk-1",),
        source_locators=("Article 1",),
    )

    class _LedgerApi:
        def __init__(self):
            self.rows = [
                {
                    "resultId": "rar_unknown_1",
                    "assessmentId": "assessment-1",
                    "engineeringRuleId": "ENG-UNKNOWN-1",
                    "engineeringRuleVersion": __import__(
                        "tools.common.capabilities.assessment.rule_assessment.run",
                        fromlist=["rule_runtime_version"],
                    ).rule_runtime_version(rule),
                    "repositoryVersion": "abc123",
                    "contextRevision": 2,
                    "status": RULE_ANALYSIS_STATUSES["unresolved"],
                    "criteria": [
                        {
                            "criterionId": "CONTROL",
                            "status": RULE_CRITERION_STATUSES["notObserved"],
                            "evidenceRefs": [],
                            "evidence": [],
                            "technicalFacts": [],
                            "limitations": ["ENGINEERING_EVIDENCE_INSUFFICIENT"],
                        }
                    ],
                    "limitations": ["ENGINEERING_EVIDENCE_INSUFFICIENT"],
                    "execution": {"attempt": 1, "runId": "run-unknown"},
                }
            ]

        def list_rule_assessments(self, assessment_id):
            assert assessment_id == "assessment-1"
            return [dict(row) for row in self.rows]

    evaluations = finalize_rule_results(
        assessment_id="assessment-1",
        rules=[rule],
        api=_LedgerApi(),
        applicability_facts={
            "legal_rules": [{"legalRuleId": "ENG-UNKNOWN-1"}],
            "ai_discovery": None,
            "confirmed_statements": (),
        },
        context_revision=2,
        commit_sha="abc123",
    )
    assert evaluations[0].status == "UNKNOWN"
    assert evaluations[0].status != "NON_COMPLIANT"


@pytest.mark.parametrize(
    "statement",
    [
        "There is no automated decision; people decide.",
        "No AI-driven approvals happen in this workflow.",
    ],
)
def test_decision_level_negatives_do_not_short_circuit_as_no_ai_usage(statement):
    from tools.common.capabilities.workflow.recovery.interview_boundary import (
        _missing_initial_planning_context_dimensions,
    )

    assert _missing_initial_planning_context_dimensions(
        _readiness_decision(_statement(statement))
    )


@pytest.mark.parametrize(
    "statement",
    ["We do not use AI in this product.", "Chúng tôi không sử dụng AI."],
)
def test_explicit_absence_of_ai_short_circuits_readiness(statement):
    from tools.common.capabilities.workflow.recovery.interview_boundary import (
        _missing_initial_planning_context_dimensions,
    )

    assert _missing_initial_planning_context_dimensions(
        _readiness_decision(_statement(statement))
    ) == []


def test_minimum_context_e_targeted_resolution_is_never_gated_by_initial_readiness():
    from tools.common.capabilities.workflow.recovery.interview_boundary import (
        _apply_authority_preflight,
        _missing_initial_planning_context_dimensions,
    )

    shallow_targeted = _readiness_decision(
        _statement("External data sources are not reused.", topic="national_data_source_reuse"),
        mode="BUSINESS_CONTEXT_RESOLUTION",
    )
    assert _missing_initial_planning_context_dimensions(shallow_targeted) == []
    # A CONTEXT_READY mislabelled on a targeted turn is also not an initial readiness check.
    assert _missing_initial_planning_context_dimensions(
        {**shallow_targeted, "outcome": "CONTEXT_READY"}
    ) == []
    # The server-registered targeted need decides the mode even if the model omits it.
    unlabelled = {**shallow_targeted, "outcome": "CONTEXT_READY"}
    unlabelled.pop("mode")
    assert _missing_initial_planning_context_dimensions(
        unlabelled, {"targetedNeed": {"needId": "need-1"}}
    ) == []
    assert _missing_initial_planning_context_dimensions(unlabelled)

    context = {
        "privateRevision": {
            "actorId": "user-test-actor",
            "questionIntent": "ASK",
            "questionControl": "SINGLE_SELECT",
            "answer": {"selectedChoiceIds": ["no"]},
        }
    }
    decision, feedback = _apply_authority_preflight(shallow_targeted, context)
    assert feedback is None
    assert decision is shallow_targeted


def test_empty_initial_context_ready_is_missing_every_dimension():
    from tools.common.capabilities.workflow.recovery.interview_boundary import (
        _missing_initial_planning_context_dimensions,
    )

    assert _missing_initial_planning_context_dimensions(_readiness_decision()) == (
        _ALL_PLANNING_DIMENSIONS
    )



def test_api_unauthorized_evidence_ref_is_fed_back_to_the_specialist_verbatim() -> None:
    source_ref = "packages/api/src/features/ai/service.ts"
    api = RecordingApi()
    api.post_interview_progress = Mock()
    accepted = {"outcome": "WAITING_FOR_CUSTOMER"}
    rejected_decision = deepcopy(WAITING_HANDOFF)
    corrected_decision = deepcopy(WAITING_HANDOFF)
    dispatcher = RecordingDispatcher()
    dispatcher.dispatch = Mock(side_effect=[
        {"handoff": rejected_decision},
        {"handoff": corrected_decision},
    ])
    api.post_interview_agent_decision = Mock(side_effect=[
        InterviewDecisionRepairableCallbackError(
            "INTERVIEW_EVIDENCE_REF_UNAUTHORIZED: client error",
            error_code="INTERVIEW_EVIDENCE_REF_UNAUTHORIZED",
            status_code=400,
            meta={"unauthorizedRef": source_ref},
        ),
        accepted,
    ])
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(), api_client=api, dispatcher=dispatcher
    )
    boundary._run_guarded_continuation = Mock()

    boundary.handle(_message(), "corr-1")

    repair = dispatcher.dispatch.call_args_list[1].kwargs
    payload = json.loads(repair["instruction"].split("\n\n", 1)[1])
    feedback = payload["decisionValidationFeedback"]
    assert feedback["code"] == "INTERVIEW_EVIDENCE_REF_UNAUTHORIZED"
    assert feedback["unauthorizedEvidenceRef"] == source_ref
    assert api.post_interview_agent_decision.call_count == 2
    boundary._run_guarded_continuation.assert_called_once()


def test_text_only_handoff_json_is_recovered_and_strictly_validated():
    from langchain_core.messages import AIMessage

    text = "Here is the handoff:\n```json\n" + json.dumps(WAITING_HANDOFF) + "\n```"
    handoff = RootSubagentDispatcher._validated_handoff(
        subagent_type="interview",
        response_format=object(),
        invocation_result={"messages": [AIMessage(content=text)]},
    )

    assert handoff["outcome"] == "WAITING_FOR_CUSTOMER"
    assert handoff["activeQuestion"]["id"] == "agent-question-next"


@pytest.mark.parametrize(
    "content",
    [
        "I will ask the customer about deployment.",
        '{"outcome": "WAITING_FOR_CUSTOMER"',
    ],
)
def test_text_without_a_json_handoff_still_fails_repairably(content):
    from langchain_core.messages import AIMessage

    with pytest.raises(SpecialistHandoffValidationError, match="structured_response"):
        RootSubagentDispatcher._validated_handoff(
            subagent_type="interview",
            response_format=object(),
            invocation_result={"messages": [AIMessage(content=content)]},
        )


def test_text_json_violating_the_handoff_schema_is_rejected():
    from langchain_core.messages import AIMessage

    broken = {**deepcopy(WAITING_HANDOFF), "activeQuestion": None}

    with pytest.raises(SpecialistHandoffValidationError):
        RootSubagentDispatcher._validated_handoff(
            subagent_type="interview",
            response_format=object(),
            invocation_result={"messages": [AIMessage(content=json.dumps(broken))]},
        )
