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
from tools.common.capabilities.managed.invocation import invocation_boundary_manifest
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
    rejected = {**deepcopy(WAITING_HANDOFF), "mode": "INVESTIGATOR_RESOLUTION", "outcome": "CONTEXT_RESOLVED", "activeQuestion": None}
    corrected = {**deepcopy(WAITING_HANDOFF), "mode": "INVESTIGATOR_RESOLUTION", "outcome": corrected_outcome}
    if corrected_outcome == "CONTEXT_RESOLVED":
        corrected["activeQuestion"] = None
    dispatcher = RecordingDispatcher()
    dispatcher.dispatch = Mock(side_effect=[{"handoff": rejected}, {"handoff": corrected}])
    missing = "Explicit confirmation or denial regarding external data sources."
    accepted = {"outcome": corrected_outcome}
    api.post_interview_agent_decision = Mock(side_effect=[
        InterviewResolutionCallbackError("rejected", missing=missing), accepted,
    ])
    boundary = AssessmentInterviewResumeBoundary(SimpleNamespace(), api_client=api, dispatcher=dispatcher)
    boundary._run_guarded_continuation = Mock()

    boundary.handle(_message(), "corr-1")

    first, repair = [call.kwargs for call in dispatcher.dispatch.call_args_list]
    payload = json.loads(repair["instruction"].split("\n\n", 1)[1])
    assert payload["decisionValidationFeedback"]["missingCriteria"] == missing
    assert payload["decisionValidationFeedback"]["rejectedDecision"]["outcome"] == "CONTEXT_RESOLVED"
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
    (WorkerCallbackError("INTERVIEW_DECISION_STALE_REVISION: client error", status_code=409), 1, "CONTEXT_RESOLVED"),
    (WorkerCallbackError("INTERVIEW_SESSION_MISMATCH: client error", status_code=409), 1, "CONTEXT_RESOLVED"),
    (WorkerCallbackError("INTERVIEW_UNKNOWN_NEW_CODE: client error", status_code=409), 1, "CONTEXT_RESOLVED"),
    (WorkerCallbackError("forbidden", status_code=403), 1, "CONTEXT_RESOLVED"),
])
def test_rejected_correction_is_bounded_and_unrelated_errors_are_not_repaired(error, attempts, outcome):
    api = RecordingApi()
    api.post_interview_progress = Mock()
    api.post_interview_agent_decision = Mock(side_effect=error)
    handoff = {**deepcopy(WAITING_HANDOFF), "outcome": outcome, "activeQuestion": None}
    dispatcher = RecordingDispatcher(handoff)
    boundary = AssessmentInterviewResumeBoundary(SimpleNamespace(), api_client=api, dispatcher=dispatcher)
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
        "outcome": "CONTEXT_READY",
        "contextAuthority": "CUSTOMER_STATED",
        "activeQuestion": None,
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
    boundary = AssessmentInterviewResumeBoundary(SimpleNamespace(), api_client=api, dispatcher=dispatcher)
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
    fact_one = "A recruiter approves every rejection."
    fact_two = "For senior positions, the hiring manager must also approve."
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


def test_context_ready_authority_rejection_gets_one_private_correction_before_continuation():
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
    api.post_interview_agent_decision = Mock(side_effect=[
        InterviewContextReadyAuthorityCallbackError("requires authority"), accepted,
    ])
    boundary = AssessmentInterviewResumeBoundary(SimpleNamespace(), api_client=api, dispatcher=dispatcher)
    boundary._run_guarded_continuation = Mock()

    boundary.handle(_message(), "corr-1")

    first, repair = [call.kwargs for call in dispatcher.dispatch.call_args_list]
    payload = json.loads(repair["instruction"].split("\n\n", 1)[1])
    assert payload["decisionValidationFeedback"]["code"] == "INTERVIEW_CONTEXT_READY_REQUIRES_AUTHORITY"
    assert payload["decisionValidationFeedback"]["rejectedDecision"]["outcome"] == "CONTEXT_READY"
    assert "decisionValidationFeedback" not in first["instruction"].split("\n\n", 1)[1]
    assert first["thread_id"] == repair["thread_id"]
    assert first["idempotency_key"] != repair["idempotency_key"]
    assert repair["context"].idempotency_key == repair["idempotency_key"]
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
    root = RecordingRoot()
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        root_agent=root,
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
    assert root.calls == []
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
        "confirmedContext": {"decision_authority": "human"},
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
    root = RecordingRoot()
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(), root_agent=root, api_client=api, dispatcher=dispatcher
    )

    boundary.handle(_message(), "corr-1")

    assert dispatcher.calls == []
    assert root.calls == []
    assert api.decision_posts == []


def test_interview_resume_boundary_stale_provenance_reenters_root_revalidation() -> None:
    api = RecordingApi(status="STALE_PROVENANCE")
    root = RecordingRoot()
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(), root_agent=root, api_client=api, dispatcher=RecordingDispatcher()
    )

    boundary.handle(_message(), "corr-1")

    assert len(root.calls) == 1
    prompt = root.calls[0][0]["messages"][0]["content"]
    assert "stale against current source/PGE provenance" in prompt
    assert (
        root.calls[0][1]["metadata"]["trigger"]
        == "ASSESSMENT_INTERVIEW_REVALIDATION_REQUIRED"
    )
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
    root = RecordingRoot()
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        root_agent=root,
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
    assert root.calls == []


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
            "mode": "INVESTIGATOR_RESOLUTION",
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
            reenter_root=False,
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
            "mode": "INVESTIGATOR_RESOLUTION",
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
            reenter_root=False,
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
            reenter_root=False,
        )


def test_targeted_duplicate_after_question_materialized_is_noop() -> None:
    class TargetedDuplicateApi(RecordingApi):
        def get_interview_private_context(self, *args, **kwargs):
            result = super().get_interview_private_context(*args, **kwargs)
            result["targetedNeed"] = {
                "needId": "need-1",
                "businessContextNeed": "Who approves?",
                "resolutionCriteria": ["decision_authority"],
                "originatingInvestigationReference": "investigator:exec-1:need-1",
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

    boundary.handle(_message(reason="INVESTIGATOR_RESOLUTION_REQUIRED"), "corr-3")

    assert dispatcher.calls == []
    assert api.decision_posts == []


def test_context_resolved_resumes_exact_managed_investigator_without_root() -> None:
    continuation = {
        "originatingInvestigationReference": "investigator:investigator-exec-17:need-1",
        "investigatorExecutionId": "investigator-exec-17",
        "workflowRunId": "investigator:investigator-exec-17",
        "checkpointId": "checkpoint-original",
        "affectedRuleIds": ["ENG-1"],
        "artifactVersions": {
            "technicalEvidenceReportId": "ter-1",
            "repositorySnapshotId": "snapshot-1",
        },
        "sourceVersion": "snapshot-1:abc",
        "pgeVersion": "ter-1:v1",
    }

    class TargetedApi(RecordingApi):
        def get_interview_private_context(self, *args, **kwargs):
            result = super().get_interview_private_context(*args, **kwargs)
            result["targetedNeed"] = {
                "needId": "need-1",
                "businessContextNeed": "Who approves?",
                "resolutionCriteria": ["decision_authority"],
                "originatingInvestigationReference": continuation[
                    "originatingInvestigationReference"
                ],
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
                "confirmedContext": _confirmed_context(),
                "continuation": continuation,
            }

    targeted_handoff = {
        "expectedContextRevision": 0,
        "mode": "INVESTIGATOR_RESOLUTION",
        "outcome": "CONTEXT_RESOLVED",
        "contextAuthority": "CUSTOMER_CONFIRMED",
        "confirmedContext": _confirmed_context(),
        "flags": [],
        "blockedActions": [],
        "targetedResolution": {},
    }
    api = TargetedApi()
    root = RecordingRoot()
    resume_calls = []
    completion_calls = []

    def exact_resumer(**kwargs):
        resume_calls.append(kwargs)
        return {
            "executionId": "investigator-exec-17",
            "threadId": "investigator:investigator-exec-17",
            "fromCheckpointId": "checkpoint-original",
            "checkpointId": "checkpoint-next",
            "handoff": {
                "status": "READY",
                "artifact_versions": continuation["artifactVersions"],
                "claims": [
                    {
                        "claim_id": "claim-1",
                        "engineering_rule_id": "ENG-1",
                        "claim_type": "UNRESOLVED_ENGINEERING_FACT",
                        "value": None,
                        "evidence_refs": ["evidence:1"],
                        "confidence": 0.5,
                        "limitations": [
                            ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"]
                        ],
                    }
                ],
                "limitations": [],
                "next_step": "GATE",
            },
        }

    def exact_completer(**kwargs):
        completion_calls.append(kwargs)

    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        root_agent=root,
        api_client=api,
        dispatcher=RecordingDispatcher(targeted_handoff),
        investigator_resumer=exact_resumer,
        investigation_completer=exact_completer,
    )

    boundary.handle(_message(reason="INVESTIGATOR_RESOLUTION_REQUIRED"), "corr-1")

    assert root.calls == []
    assert len(resume_calls) == 1
    call = resume_calls[0]
    assert call["continuation"] is continuation
    assert call["confirmed_context"].context_revision == 2
    assert call["confirmed_context"].to_legacy_customer_context()["answers"] == {
        "decision_authority": "human"
    }
    assert call["assessment_id"] == "assessment-1"
    assert call["context_revision"] == 2
    assert len(completion_calls) == 1
    assert completion_calls[0]["resumed_handoff"]["status"] == "READY"
    assert completion_calls[0]["continuation"] is continuation
    assert completion_calls[0]["confirmed_context"].to_legacy_customer_context()[
        "answers"
    ] == {
        "decision_authority": "human"
    }


def test_targeted_free_text_answer_converges_via_synthesis_after_extra_confirm_turn() -> None:
    # Brief requirement (lcsp-tighten-direct-lossless.md): targeted questions are
    # usually FREE_TEXT. After tightening, a targeted FREE_TEXT answer needs one
    # extra CONFIRM_ADJUST turn before CONTEXT_RESOLVED can become authoritative.
    # Turn 1 must converge locally to a WAITING_FOR_CUSTOMER CONFIRM_ADJUST question
    # (never propagate/raise on INTERVIEW_CONTEXT_RESOLVED_REQUIRES_AUTHORITY, never
    # resume the Investigator early). Turn 2, after the customer's real CONFIRM,
    # must resume the exact Investigator exactly as the direct-choice path does.
    continuation = {
        "originatingInvestigationReference": "investigator:investigator-exec-9:need-1",
        "investigatorExecutionId": "investigator-exec-9",
        "workflowRunId": "investigator:investigator-exec-9",
        "checkpointId": "checkpoint-original",
        "affectedRuleIds": ["ENG-1"],
        "artifactVersions": {
            "technicalEvidenceReportId": "ter-1",
            "repositorySnapshotId": "snapshot-1",
        },
        "sourceVersion": "snapshot-1:abc",
        "pgeVersion": "ter-1:v1",
    }
    targeted_handoff = {
        "expectedContextRevision": 0,
        "mode": "INVESTIGATOR_RESOLUTION",
        "outcome": "CONTEXT_RESOLVED",
        "contextAuthority": "CUSTOMER_CONFIRMED",
        "confirmedContext": _confirmed_context(),
        "flags": [],
        "blockedActions": [],
        "targetedResolution": {},
    }
    resume_calls: list[dict] = []
    completion_calls: list[dict] = []

    def exact_resumer(**kwargs):
        resume_calls.append(kwargs)
        return {
            "executionId": "investigator-exec-9",
            "threadId": "investigator:investigator-exec-9",
            "fromCheckpointId": "checkpoint-original",
            "checkpointId": "checkpoint-next",
            "handoff": {
                "status": "READY",
                "artifact_versions": continuation["artifactVersions"],
                "claims": [],
                "limitations": [],
                "next_step": "GATE",
            },
        }

    def exact_completer(**kwargs):
        completion_calls.append(kwargs)

    def with_targeted_need(result: dict) -> dict:
        result["targetedNeed"] = {
            "needId": "need-1",
            "businessContextNeed": "Who approves?",
            "resolutionCriteria": ["decision_authority"],
            "originatingInvestigationReference": continuation[
                "originatingInvestigationReference"
            ],
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
    boundary_turn_1 = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        api_client=api_turn_1,
        dispatcher=RecordingDispatcher(targeted_handoff),
        investigator_resumer=exact_resumer,
        investigation_completer=exact_completer,
    )

    boundary_turn_1.handle(
        _message(reason="INVESTIGATOR_RESOLUTION_REQUIRED", revision=2), "corr-1"
    )

    assert resume_calls == []
    assert completion_calls == []
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
                "confirmedContext": _confirmed_context(),
                "continuation": continuation,
            }

    api_turn_2 = TurnTwoApi()
    boundary_turn_2 = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        api_client=api_turn_2,
        dispatcher=RecordingDispatcher(targeted_handoff),
        investigator_resumer=exact_resumer,
        investigation_completer=exact_completer,
    )

    boundary_turn_2.handle(
        _message(reason="INVESTIGATOR_RESOLUTION_REQUIRED", revision=3), "corr-2"
    )

    assert len(resume_calls) == 1
    assert resume_calls[0]["continuation"] is continuation
    assert len(completion_calls) == 1
    assert completion_calls[0]["resumed_handoff"]["status"] == "READY"


def test_exact_resume_rejects_wrong_investigator_execution() -> None:
    continuation = {
        "investigatorExecutionId": "expected-exec",
        "workflowRunId": "investigator:expected-exec",
        "checkpointId": "checkpoint-1",
    }

    def wrong_resumer(**_kwargs):
        return {
            "executionId": "different-exec",
            "threadId": "investigator:expected-exec",
            "fromCheckpointId": "checkpoint-1",
            "checkpointId": "checkpoint-2",
            "handoff": {"status": "READY"},
        }

    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        api_client=RecordingApi(),
        investigator_resumer=wrong_resumer,
    )

    with pytest.raises(RuntimeError, match="execution identity drifted"):
        boundary._resume_exact_investigator(
            assessment_id="assessment-1",
            context_revision=2,
            continuation=continuation,
            confirmed_context=_confirmed_context(),
            correlationId="corr-1",
        )


def test_interview_resume_boundary_rejects_missing_revision() -> None:
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        root_agent=RecordingRoot(),
        api_client=RecordingApi(),
        dispatcher=RecordingDispatcher(),
    )

    with pytest.raises(ValueError, match="contextRevision"):
        message = _message()
        message.pop("contextRevision")
        boundary.handle(message, "corr-1")

def test_context_resolved_targeted_scope_exclusion_closes_without_investigator() -> None:
    continuation = {
        "originatingInvestigationReference": "investigator:investigator-exec-17:need-1",
        "investigatorExecutionId": "investigator-exec-17",
        "workflowRunId": "investigator:investigator-exec-17",
        "checkpointId": "checkpoint-original",
        "affectedRuleIds": ["ENG-1"],
        "artifactVersions": {
            "technicalEvidenceReportId": "ter-1",
            "repositorySnapshotId": "snapshot-1",
        },
        "sourceVersion": "snapshot-1:abc",
        "pgeVersion": "ter-1:v1",
    }
    confirmed_context = _confirmed_context()
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
        }
    ]

    class TargetedApi(RecordingApi):
        def get_interview_private_context(self, *args, **kwargs):
            result = super().get_interview_private_context(*args, **kwargs)
            result["targetedNeed"] = {
                "needId": "need-1",
                "businessContextNeed": "Confirm whether the system reuses a national data repository source.",
                "resolutionCriteria": ["national_data_source_reuse"],
                "originatingInvestigationReference": continuation[
                    "originatingInvestigationReference"
                ],
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
                "confirmedContext": confirmed_context,
                "continuation": continuation,
            }

        def get_active_legal_rule_catalog(self):
            return {
                "versionId": "catalog-v1",
                "rules": [
                    {
                        "legalRuleId": "legal-national-data",
                        "status": "APPROVED",
                        "engineeringRuleIds": ["ENG-1"],
                        "requiredFacts": [
                            {
                                "field": "nationalDataSourceReuse",
                                "expectedValue": True,
                            }
                        ],
                    }
                ],
            }

    targeted_handoff = {
        "expectedContextRevision": 0,
        "mode": "INVESTIGATOR_RESOLUTION",
        "outcome": "CONTEXT_RESOLVED",
        "contextAuthority": "CUSTOMER_CONFIRMED",
        "confirmedContext": confirmed_context,
        "flags": [],
        "blockedActions": [],
        "targetedResolution": {},
    }
    api = TargetedApi()
    resume_calls = []
    completion_calls = []

    def exact_resumer(**kwargs):
        resume_calls.append(kwargs)
        raise AssertionError("Investigator must not be resumed")

    def exact_completer(**kwargs):
        completion_calls.append(kwargs)

    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        api_client=api,
        dispatcher=RecordingDispatcher(targeted_handoff),
        investigator_resumer=exact_resumer,
        investigation_completer=exact_completer,
    )

    boundary.handle(_message(reason="INVESTIGATOR_RESOLUTION_REQUIRED"), "corr-1")

    assert resume_calls == []
    assert len(completion_calls) == 1
    handoff = completion_calls[0]["resumed_handoff"]
    assert handoff["status"] == "READY"
    assert handoff["claims"][0]["claim_type"] == "RULE_SCOPE_NOT_APPLICABLE"
    assert handoff["claims"][0]["customer_context_refs"] == ["stmt-national-data"]
    assert handoff["claims"][0]["criterion"] == "TARGETED_SCOPE_EXCLUDED"
