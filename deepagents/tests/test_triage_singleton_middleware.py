from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from langchain.messages import ToolMessage

from middleware.triage_singleton import _guard_triage_task_call
from orchestration.context import LCSPRunContext


class FakeRequest:
    def __init__(self, *, context, tool_call=None):
        self.runtime = SimpleNamespace(context=context)
        self.tool_call = tool_call or {
            "name": "task",
            "id": "call-1",
            "args": {
                "subagent_type": "triage",
                "description": "Run automatic legal preparation.",
            },
        }

    def override(self, **kwargs):
        return FakeRequest(
            context=self.runtime.context,
            tool_call=kwargs.get("tool_call", self.tool_call),
        )


def test_running_triage_short_circuits_before_second_subagent_start() -> None:
    coordinator = MagicMock()
    coordinator.claim_or_observe.return_value = SimpleNamespace(
        status="ALREADY_RUNNING",
        execution_id="triage:active",
    )
    waiting_registry = MagicMock()
    handler = MagicMock()
    request = FakeRequest(
        context=LCSPRunContext(
            assessment_id="assessment-2",
            legal_rule_ids=("RULE-2",),
            idempotency_key="readiness:rule-2",
        )
    )

    result = _guard_triage_task_call(
        request,
        handler,
        coordinator=coordinator,
        waiting_registry=waiting_registry,
    )

    assert isinstance(result, ToolMessage)
    assert '"status": "ALREADY_RUNNING"' in str(result.content)
    assert '"queueCreated": false' in str(result.content)
    assert '"scopeMerged": false' in str(result.content)
    assert '"subagentStarted": false' in str(result.content)
    handler.assert_not_called()
    waiting_registry.reconcile_all.assert_not_called()
    coordinator.claim_or_observe.assert_called_once_with(
        affected_rule_ids=["RULE-2"],
        idempotency_key="readiness:rule-2",
        trigger="ENGINEERING_RULE_NOT_READY",
    )


def test_first_readiness_triage_dispatch_injects_claimed_execution_and_root_reconciles() -> None:
    coordinator = MagicMock()
    coordinator.claim_or_observe.return_value = SimpleNamespace(
        status="OWNER",
        execution_id="triage:owner",
    )
    coordinator.active_status.return_value = {"active": False}
    waiting_registry = MagicMock()
    waiting_registry.reconcile_all.return_value = {
        "status": "COMPLETE",
        "eligibleAssessmentCount": 2,
        "resumedAssessmentCount": 2,
        "deferredAssessmentCount": 0,
    }
    captured = []

    def handler(request):
        captured.append(request.tool_call)
        return ToolMessage(content="done", tool_call_id="call-1")

    request = FakeRequest(
        context=LCSPRunContext(
            assessment_id="assessment-1",
            legal_rule_ids=("RULE-1",),
            idempotency_key="readiness:rule-1",
        )
    )

    result = _guard_triage_task_call(
        request,
        handler,
        coordinator=coordinator,
        waiting_registry=waiting_registry,
    )

    assert isinstance(result, ToolMessage)
    assert captured
    description = captured[0]["args"]["description"]
    assert "triageExecutionId=triage:owner" in description
    assert "Root Orchestration" in description
    assert "Concurrent requests return ALREADY_RUNNING" in description
    assert "never queued" in description
    assert "merged into this scope" in description
    coordinator.claim_or_observe.assert_called_once_with(
        affected_rule_ids=["RULE-1"],
        idempotency_key="readiness:rule-1",
        trigger="ENGINEERING_RULE_NOT_READY",
    )
    coordinator.abandon_execution.assert_not_called()
    waiting_registry.reconcile_all.assert_called_once_with()


def test_full_backlog_readiness_trigger_is_not_misclassified_as_scheduled() -> None:
    coordinator = MagicMock()
    coordinator.claim_or_observe.return_value = SimpleNamespace(
        status="OWNER",
        execution_id="triage:owner",
    )
    coordinator.active_status.return_value = {"active": False}
    waiting_registry = MagicMock()
    waiting_registry.reconcile_all.return_value = {"status": "COMPLETE"}
    handler = MagicMock(
        return_value=ToolMessage(content="done", tool_call_id="call-1")
    )
    request = FakeRequest(
        context=LCSPRunContext(idempotency_key="readiness:full-backlog")
    )

    _guard_triage_task_call(
        request,
        handler,
        coordinator=coordinator,
        waiting_registry=waiting_registry,
    )

    coordinator.claim_or_observe.assert_called_once_with(
        affected_rule_ids=[],
        idempotency_key="readiness:full-backlog",
        trigger="ENGINEERING_RULE_NOT_READY",
    )
    waiting_registry.reconcile_all.assert_called_once_with()


def test_scheduled_triage_uses_same_root_lifecycle_and_reconciles_after_return() -> None:
    coordinator = MagicMock()
    coordinator.claim_or_observe.return_value = SimpleNamespace(
        status="OWNER",
        execution_id="triage:owner",
    )
    coordinator.active_status.return_value = {"active": False}
    waiting_registry = MagicMock()
    waiting_registry.reconcile_all.return_value = {"status": "COMPLETE"}
    handler = MagicMock(
        return_value=ToolMessage(content="done", tool_call_id="call-1")
    )
    request = FakeRequest(context=LCSPRunContext())

    _guard_triage_task_call(
        request,
        handler,
        coordinator=coordinator,
        waiting_registry=waiting_registry,
    )

    coordinator.claim_or_observe.assert_called_once_with(
        affected_rule_ids=[],
        idempotency_key=None,
        trigger="SCHEDULED",
    )
    waiting_registry.reconcile_all.assert_called_once_with()


def test_failed_owner_dispatch_releases_lease_without_reconciliation() -> None:
    coordinator = MagicMock()
    coordinator.claim_or_observe.return_value = SimpleNamespace(
        status="OWNER",
        execution_id="triage:owner",
    )
    waiting_registry = MagicMock()
    request = FakeRequest(context=LCSPRunContext())

    def fail(_request):
        raise RuntimeError("subagent failed")

    with pytest.raises(RuntimeError, match="subagent failed"):
        _guard_triage_task_call(
            request,
            fail,
            coordinator=coordinator,
            waiting_registry=waiting_registry,
        )

    coordinator.abandon_execution.assert_called_once_with(
        execution_id="triage:owner"
    )
    waiting_registry.reconcile_all.assert_not_called()


def test_root_fails_closed_if_triage_returns_before_finish() -> None:
    coordinator = MagicMock()
    coordinator.claim_or_observe.return_value = SimpleNamespace(
        status="OWNER",
        execution_id="triage:owner",
    )
    coordinator.active_status.return_value = {
        "active": True,
        "triageExecutionId": "triage:owner",
    }
    waiting_registry = MagicMock()
    request = FakeRequest(context=LCSPRunContext())
    handler = MagicMock(
        return_value=ToolMessage(content="done", tool_call_id="call-1")
    )

    with pytest.raises(RuntimeError, match="returned before finish"):
        _guard_triage_task_call(
            request,
            handler,
            coordinator=coordinator,
            waiting_registry=waiting_registry,
        )

    coordinator.abandon_execution.assert_called_once_with(
        execution_id="triage:owner"
    )
    waiting_registry.reconcile_all.assert_not_called()


def test_non_triage_task_is_not_intercepted() -> None:
    coordinator = MagicMock()
    waiting_registry = MagicMock()
    request = FakeRequest(
        context=LCSPRunContext(),
        tool_call={
            "name": "task",
            "id": "call-2",
            "args": {
                "subagent_type": "planner",
                "description": "Plan assessment evidence.",
            },
        },
    )
    expected = ToolMessage(content="planner", tool_call_id="call-2")
    handler = MagicMock(return_value=expected)

    result = _guard_triage_task_call(
        request,
        handler,
        coordinator=coordinator,
        waiting_registry=waiting_registry,
    )

    assert result is expected
    handler.assert_called_once()
    coordinator.claim_or_observe.assert_not_called()
    waiting_registry.reconcile_all.assert_not_called()
