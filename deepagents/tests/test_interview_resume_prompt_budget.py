import json

from tools.common.capabilities.workflow.recovery.interview_boundary import _interview_instruction


def test_authorization_inventory_stays_out_of_resume_prompt():
    refs = [f"private-ref:{i}:" + "x" * 200 for i in range(30000)]
    answer = {"text": "Possibly used externally; I have not confirmed that."}
    context = {"privateRevision": {"answer": answer, "governedEvidenceRefs": refs,
                                   "contextRevision": 1, "sourceVersion": "source:1"}}
    prompt = _interview_instruction(assessment_id="assessment", question_id="question",
                                   context_revision=1, resume_reason="ANSWER_SUBMITTED", context=context)
    assert len(prompt) < 5000
    assert "private-ref:" not in prompt
    payload = json.loads(prompt.split("\n\n", 1)[1])
    revision = payload["privateCustomerRevision"]
    assert revision["answer"] == answer
    assert revision["sourceVersion"] == "source:1"
    assert revision["governedEvidenceRefCount"] == 30000
    assert context["privateRevision"]["governedEvidenceRefs"] is refs


def test_prior_answer_history_flows_into_the_resume_prompt_verbatim():
    prior_history = [
        {
            "questionId": "q-1",
            "contextRevision": 1,
            "questionIntent": "ASK",
            "questionControl": "SINGLE_SELECT",
            "selectedChoiceIds": ["other"],
            "comment": "Hosted in a customer-managed region behind our own VPN.",
        },
    ]
    context = {
        "privateRevision": {"answer": {}, "contextRevision": 2},
        "priorAnswerHistory": prior_history,
        "priorAnswerHistoryOmittedCount": 3,
    }
    prompt = _interview_instruction(assessment_id="assessment", question_id="question",
                                   context_revision=2, resume_reason="ANSWER_SUBMITTED", context=context)
    payload = json.loads(prompt.split("\n\n", 1)[1])
    assert payload["priorAnswerHistory"] == prior_history
    assert payload["priorAnswerHistoryOmittedCount"] == 3
    assert "priorAnswerHistory" in prompt


def test_prior_answer_history_defaults_when_absent():
    context = {"privateRevision": {"answer": {}, "contextRevision": 1}}
    prompt = _interview_instruction(assessment_id="assessment", question_id="question",
                                   context_revision=1, resume_reason="ANSWER_SUBMITTED", context=context)
    payload = json.loads(prompt.split("\n\n", 1)[1])
    assert payload["priorAnswerHistory"] == []
    assert payload["priorAnswerHistoryOmittedCount"] == 0
