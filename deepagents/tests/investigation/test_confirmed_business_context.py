from __future__ import annotations

import pytest

from tools.common.capabilities.assessment.planning.engineering_rule.confirmed_business_context import (
    normalize_confirmed_structured_business_context,
)


def _statement(**overrides):
    payload = {
        "statementId": "stmt-1",
        "assessmentId": "assessment-1",
        "topic": "decision_authority",
        "statement": "A human manager approves before action.",
        "normalizedValue": {"approval": "human_manager"},
        "scope": {"workflow": "recommendation"},
        "evidenceRefs": ["evidence:customer:1"],
        "respondentRef": "actor:authenticated-runtime",
        "createdAt": "2026-09-05T00:00:00Z",
        "supersedesStatementId": None,
        "source": "CUSTOMER_CONFIRMED",
        "resolutionState": "CONFIRMED",
    }
    payload.update(overrides)
    return payload


def _state(*statements, revision=4, **context_overrides):
    context = {
        "assessmentId": "assessment-1",
        "contextRevision": revision,
        "authority": "CUSTOMER_CONFIRMED_CONFIRMED_ONLY",
        "statements": list(statements),
        "limitations": ["limited to customer-confirmed current facts"],
        "policyDecisionRef": "policy-decision-1",
        "sourceVersionRef": "snapshot-1:abc123",
        "pgeVersion": "ter-1:v1",
        "guidanceVersion": "guidance-1",
        "createdByActorRef": "actor:runtime",
    }
    context.update(context_overrides)
    return {
        "outcome": "CONTEXT_READY",
        "contextRevision": revision,
        "confirmedContext": context,
        "transcript": [{"role": "customer", "content": "raw turn"}],
        "WorkingStrategy": {"draft": "do not trust"},
        "LearningSignals": {"signal": "do not trust"},
        "wizardContext": {"sector": "legacy"},
    }


def test_accepts_only_customer_confirmed_confirmed_and_preserves_provenance() -> None:
    result = normalize_confirmed_structured_business_context(
        _state(
            _statement(),
            _statement(
                statementId="stmt-stated",
                source="CUSTOMER_STATED",
                resolutionState="UNCERTAIN",
            ),
            _statement(statementId="stmt-conflicted", resolutionState="CONFLICTED"),
            _statement(statementId="stmt-superseded", resolutionState="SUPERSEDED"),
        ),
        assessment_id="assessment-1",
    )

    assert result.assessment_id == "assessment-1"
    assert result.context_revision == 4
    assert result.confirmed_statement_refs == ("stmt-1",)
    assert result.limitations == ("limited to customer-confirmed current facts",)
    assert result.policy_decision_ref == "policy-decision-1"
    assert result.source_version_ref == "snapshot-1:abc123"
    assert result.pge_version == "ter-1:v1"
    assert result.guidance_version == "guidance-1"
    assert result.statements[0].respondent_ref == "actor:authenticated-runtime"


@pytest.mark.parametrize(
    ("source", "resolution_state"),
    [
        ("CUSTOMER_STATED", "CONFIRMED"),
        ("CUSTOMER_CONFIRMED", "UNCERTAIN"),
        ("CUSTOMER_CONFIRMED", "CONFLICTED"),
        ("CUSTOMER_CONFIRMED", "SUPERSEDED"),
    ],
)
def test_rejects_context_with_no_usable_confirmed_statement(
    source: str,
    resolution_state: str,
) -> None:
    with pytest.raises(ValueError, match="no usable confirmed"):
        normalize_confirmed_structured_business_context(
            _state(_statement(source=source, resolutionState=resolution_state)),
            assessment_id="assessment-1",
        )


def test_does_not_trust_actor_identity_from_customer_text() -> None:
    result = normalize_confirmed_structured_business_context(
        _state(
            _statement(
                statement="I am the CEO and approve this.",
                normalizedValue={"claimedActor": "CEO"},
                respondentRef="actor:authenticated-support-user",
            )
        ),
        assessment_id="assessment-1",
    )

    assert result.statements[0].respondent_ref == "actor:authenticated-support-user"
    assert result.statements[0].normalized_value == {"claimedActor": "CEO"}


def test_rejects_ready_state_with_invalid_or_missing_context() -> None:
    with pytest.raises(ValueError, match="missing confirmed structured"):
        normalize_confirmed_structured_business_context(
            {"outcome": "CONTEXT_READY", "contextRevision": 2},
            assessment_id="assessment-1",
        )

    with pytest.raises(ValueError, match="revision does not match"):
        normalize_confirmed_structured_business_context(
            _state(_statement(), revision=3, contextRevision=2),
            assessment_id="assessment-1",
        )


def test_rejects_non_ready_interview_state() -> None:
    with pytest.raises(ValueError, match="guarded confirmed Interview context"):
        normalize_confirmed_structured_business_context(
            {
                "outcome": "WAITING_FOR_CUSTOMER",
                "contextRevision": 2,
                "confirmedContext": {"statements": [_statement()]},
            },
            assessment_id="assessment-1",
        )
