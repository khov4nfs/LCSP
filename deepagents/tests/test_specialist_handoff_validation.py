"""Handoff validation for the remaining structured specialists (Interview).

Repository analysis has no structured handoff: it reports through the governed
``submit_rule_assessment`` tool (covered by tests/rule_assessment/).
"""

from __future__ import annotations

import pytest

from orchestration.result_validation import (
    SpecialistHandoffValidationError,
    repair_targeted_interview_frontier,
    validate_specialist_handoff,
)


def _question(**overrides) -> dict:
    return {
        "id": "question-1",
        "intent": "ASK",
        "control": "FREE_TEXT",
        "prompt": "Who approves this business action?",
        "frontier": {
            "owner": "CUSTOMER",
            "materiality": "MATERIAL",
            "description": "Approval authority",
            "evidenceRefs": [],
        },
        **overrides,
    }


def _interview(**overrides) -> dict:
    return {
        "expectedContextRevision": 0,
        "mode": "INITIAL_INTERVIEW",
        "outcome": "WAITING_FOR_CUSTOMER",
        "activeQuestion": _question(),
        **overrides,
    }


@pytest.mark.parametrize("removed", ["planner", "investigator", "triage"])
def test_deleted_specialist_handoff_types_are_unknown(removed) -> None:
    with pytest.raises(SpecialistHandoffValidationError, match="unknown"):
        validate_specialist_handoff(removed, {"status": "READY"})


def test_valid_interview_handoff_passes() -> None:
    assert validate_specialist_handoff("interview", _interview()).outcome == "WAITING_FOR_CUSTOMER"


def test_schema_failure_is_bounded_and_does_not_echo_model_values() -> None:
    payload = _interview(activeQuestion=_question(prompt="SECRET-CUSTOMER-VALUE", control="NOPE"))
    with pytest.raises(SpecialistHandoffValidationError, match="schema validation") as caught:
        validate_specialist_handoff("interview", payload)
    assert "SECRET-CUSTOMER-VALUE" not in str(caught.value)
    assert len(str(caught.value)) < 700


@pytest.mark.parametrize("verdict", ["COMPLIANT", "NON_COMPLIANT"])
def test_handoffs_reject_final_compliance_verdicts(verdict) -> None:
    with pytest.raises(SpecialistHandoffValidationError, match="forbidden"):
        validate_specialist_handoff(
            "interview", _interview(rationale=f"Result is {verdict}.")
        )


def test_waiting_question_requires_a_customer_owned_material_frontier() -> None:
    with pytest.raises(SpecialistHandoffValidationError):
        validate_specialist_handoff("interview", _interview(activeQuestion=_question(frontier=None)))
    with pytest.raises(SpecialistHandoffValidationError):
        validate_specialist_handoff(
            "interview",
            _interview(
                activeQuestion=_question(
                    frontier={"owner": "TECHNICAL", "materiality": "MATERIAL", "description": "x"}
                )
            ),
        )


def test_context_resolved_requires_the_business_context_resolution_mode() -> None:
    with pytest.raises(SpecialistHandoffValidationError):
        validate_specialist_handoff(
            "interview", _interview(outcome="CONTEXT_RESOLVED", activeQuestion=None)
        )
    ok = validate_specialist_handoff(
        "interview",
        _interview(
            outcome="CONTEXT_RESOLVED",
            mode="BUSINESS_CONTEXT_RESOLUTION",
            activeQuestion=None,
        ),
    )
    assert ok.mode == "BUSINESS_CONTEXT_RESOLUTION"


def test_legacy_investigator_resolution_mode_is_rejected() -> None:
    with pytest.raises(SpecialistHandoffValidationError):
        validate_specialist_handoff(
            "interview", _interview(mode="INVESTIGATOR_RESOLUTION")
        )


def test_targeted_frontier_is_repaired_only_from_trusted_need_metadata() -> None:
    payload = _interview(activeQuestion=_question(frontier=None))
    need = {"needId": "need:r:c:abc", "businessContextNeed": "Who approves?", "materiality": "MATERIAL"}

    repaired = repair_targeted_interview_frontier(payload, targeted_need=need)

    assert repaired["activeQuestion"]["frontier"]["owner"] == "CUSTOMER"
    assert repaired["activeQuestion"]["needId"] == "need:r:c:abc"
    assert validate_specialist_handoff("interview", repaired)
    # No trusted need: the missing frontier stays a hard failure (no invention).
    assert repair_targeted_interview_frontier(payload, targeted_need=None) is payload
    with pytest.raises(SpecialistHandoffValidationError):
        validate_specialist_handoff("interview", payload)
