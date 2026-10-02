"""A governed answer resumes only the rule/criteria of its registered need; else fail closed."""

from types import SimpleNamespace

import pytest

from tools.common.capabilities.workflow.recovery.interview_boundary import _bind_answer_to_need


def _context(*statements):
    return SimpleNamespace(statements=tuple(statements))


def _answer(need_id="need:r1:c1:abc", criteria=("c1",)):
    return SimpleNamespace(source_need_id=need_id, resolved_criterion_ids=tuple(criteria))


CONTINUATION = {"needId": "need:r1:c1:abc", "engineeringRuleId": "r1", "resolutionCriterionIds": ["c1"]}


def test_bound_answer_resumes_its_rule() -> None:
    assert _bind_answer_to_need(dict(CONTINUATION), _context(_answer())) == "r1"


def test_missing_criterion_identity_fails_closed() -> None:
    continuation = {k: v for k, v in CONTINUATION.items() if k != "resolutionCriterionIds"}
    with pytest.raises(RuntimeError, match="criterion identity"):
        _bind_answer_to_need(continuation, _context(_answer()))


@pytest.mark.parametrize(
    "answer,message",
    [
        (_answer(need_id="need:other"), "does not resolve the pending need"),
        (_answer(criteria=()), "resolves no criterion"),
        (_answer(criteria=("c1", "c9")), "outside its need"),
    ],
)
def test_foreign_or_empty_answers_are_rejected(answer, message) -> None:
    with pytest.raises(RuntimeError, match=message):
        _bind_answer_to_need(dict(CONTINUATION), _context(answer))


def test_partially_resolved_need_is_rejected() -> None:
    continuation = {**CONTINUATION, "resolutionCriterionIds": ["c1", "c2"]}
    with pytest.raises(RuntimeError, match="unresolved"):
        _bind_answer_to_need(continuation, _context(_answer(criteria=("c1",))))
