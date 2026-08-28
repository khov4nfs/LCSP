from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from orchestration.dispatcher import RootSubagentDispatcher
from orchestration.lifecycle import RootSubagentReservation


def _definition() -> dict:
    return {
        "name": "triage",
        "model": "test-model",
        "tools": [],
        "system_prompt": "triage prompt",
        "middleware": [],
    }


def test_root_dispatcher_owns_triage_begin_and_complete_transitions() -> None:
    lifecycle = MagicMock()
    reservation = RootSubagentReservation(
        subagent_type="triage",
        status="OWNER",
        execution_id="triage:owner",
        trigger="ENGINEERING_RULE_NOT_READY",
    )
    lifecycle.reserve_subagent.return_value = reservation
    lifecycle.owner_instruction.return_value = "ROOT OWNS TRIAGE"
    lifecycle.complete_subagent.return_value = {
        "status": "COMPLETE",
        "assessmentReconciliation": {"resumedAssessmentCount": 2},
    }
    specialist = MagicMock()
    factory = MagicMock(return_value=specialist)
    dispatcher = RootSubagentDispatcher(
        lifecycle=lifecycle,
        agent_factory=factory,
        subagents={"triage": _definition()},
    )

    result = dispatcher.dispatch(
        subagent_type="triage",
        instruction="Run bounded legal preparation.",
        affected_rule_ids=["RULE-1"],
        idempotency_key="legal-triage:key",
        trigger="ENGINEERING_RULE_NOT_READY",
        metadata={"correlationId": "corr-1"},
        thread_id="triage:legal-triage:key",
    )

    lifecycle.reserve_subagent.assert_called_once_with(
        subagent_type="triage",
        affected_rule_ids=["RULE-1"],
        idempotency_key="legal-triage:key",
        trigger="ENGINEERING_RULE_NOT_READY",
    )
    factory.assert_called_once()
    invoke_input = specialist.invoke.call_args.args[0]
    assert invoke_input["messages"][0]["content"].startswith("ROOT OWNS TRIAGE")
    assert "Run bounded legal preparation." in invoke_input["messages"][0]["content"]
    lifecycle.complete_subagent.assert_called_once_with(reservation)
    lifecycle.fail_subagent.assert_not_called()
    assert result["status"] == "COMPLETED"
    assert result["executionId"] == "triage:owner"
    assert result["orchestration"]["assessmentReconciliation"]["resumedAssessmentCount"] == 2


def test_root_dispatcher_does_not_create_second_triage_when_policy_reports_running() -> None:
    lifecycle = MagicMock()
    lifecycle.reserve_subagent.return_value = RootSubagentReservation(
        subagent_type="triage",
        status="ALREADY_RUNNING",
        execution_id="triage:active",
        trigger="ENGINEERING_RULE_NOT_READY",
    )
    factory = MagicMock()
    dispatcher = RootSubagentDispatcher(
        lifecycle=lifecycle,
        agent_factory=factory,
        subagents={"triage": _definition()},
    )

    result = dispatcher.dispatch(
        subagent_type="triage",
        instruction="Run.",
        affected_rule_ids=["RULE-2"],
        idempotency_key="legal-triage:key2",
        trigger="ENGINEERING_RULE_NOT_READY",
    )

    assert result == {
        "status": "ALREADY_RUNNING",
        "subagentType": "triage",
        "executionId": "triage:active",
        "subagentStarted": False,
    }
    factory.assert_not_called()
    lifecycle.complete_subagent.assert_not_called()


def test_root_dispatcher_releases_specialist_policy_when_agent_fails() -> None:
    lifecycle = MagicMock()
    reservation = RootSubagentReservation(
        subagent_type="triage",
        status="OWNER",
        execution_id="triage:owner",
        trigger="SCHEDULED",
    )
    lifecycle.reserve_subagent.return_value = reservation
    lifecycle.owner_instruction.return_value = "ROOT OWNS TRIAGE"
    specialist = MagicMock()
    specialist.invoke.side_effect = RuntimeError("model failed")
    dispatcher = RootSubagentDispatcher(
        lifecycle=lifecycle,
        agent_factory=MagicMock(return_value=specialist),
        subagents={"triage": _definition()},
    )

    with pytest.raises(RuntimeError, match="model failed"):
        dispatcher.dispatch(
            subagent_type="triage",
            instruction="Run scheduled maintenance.",
            trigger="SCHEDULED",
        )

    lifecycle.fail_subagent.assert_called_once_with(reservation)
    lifecycle.complete_subagent.assert_not_called()
