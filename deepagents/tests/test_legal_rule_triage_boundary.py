from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from tools.triage.legal_rule_triage import boundary as triage_boundary


def _config():
    return SimpleNamespace(max_retries=3)


def _message() -> dict:
    return {
        "trigger": "ENGINEERING_RULE_NOT_READY",
        "affectedLegalRuleIds": ["RULE-2", "RULE-1"],
        "legalRuleCatalogVersionId": "catalog-v2",
        "legalCorpusVersionId": "corpus-v3",
        "idempotencyKey": "legal-triage:abc123",
        "resumeEvidenceReportId": "ter-1",
        "resumeWorkflowRunId": "scan-1",
        "correlationId": "corr-1",
    }


def test_boundary_checkpoints_assessment_and_delegates_triage_to_root_orchestration() -> None:
    waiting_registry = MagicMock()
    dispatcher = MagicMock()
    dispatcher.dispatch.return_value = {
        "status": "COMPLETED",
        "subagentType": "triage",
        "executionId": "triage:owner",
    }
    boundary = triage_boundary.LegalRuleTriageBoundary(
        _config(),
        waiting_registry=waiting_registry,
        dispatcher=dispatcher,
    )

    boundary.handle(_message(), "corr-1")

    waiting_registry.register.assert_called_once_with(
        evidence_report_id="ter-1",
        workflow_run_id="scan-1",
        source_correlation_id="corr-1",
    )
    dispatcher.dispatch.assert_called_once()
    call = dispatcher.dispatch.call_args.kwargs
    assert call["subagent_type"] == "triage"
    assert call["affected_rule_ids"] == ["RULE-2", "RULE-1"]
    assert call["idempotency_key"] == "legal-triage:abc123"
    assert call["trigger"] == "ENGINEERING_RULE_NOT_READY"
    assert call["thread_id"] == "triage:legal-triage:abc123"
    assert "Root Orchestration" in call["instruction"]
    assert "legal-triage:abc123" in call["instruction"]
    assert "assessment-" not in call["instruction"].lower()
    assert "ter-1" not in call["instruction"]
    assert "scan-1" not in call["instruction"]


def test_running_triage_keeps_checkpoint_and_root_does_not_start_second_specialist() -> None:
    waiting_registry = MagicMock()
    dispatcher = MagicMock()
    dispatcher.dispatch.return_value = {
        "status": "ALREADY_RUNNING",
        "subagentType": "triage",
        "executionId": "triage:active",
        "subagentStarted": False,
    }
    boundary = triage_boundary.LegalRuleTriageBoundary(
        _config(),
        waiting_registry=waiting_registry,
        dispatcher=dispatcher,
    )

    boundary.handle(_message(), "corr-1")

    waiting_registry.register.assert_called_once_with(
        evidence_report_id="ter-1",
        workflow_run_id="scan-1",
        source_correlation_id="corr-1",
    )
    dispatcher.dispatch.assert_called_once()


def test_root_dispatch_failure_preserves_waiting_checkpoint() -> None:
    waiting_registry = MagicMock()
    dispatcher = MagicMock()
    dispatcher.dispatch.side_effect = RuntimeError("model failure")
    boundary = triage_boundary.LegalRuleTriageBoundary(
        _config(),
        waiting_registry=waiting_registry,
        dispatcher=dispatcher,
    )

    with pytest.raises(RuntimeError, match="model failure"):
        boundary.handle(_message(), "corr-1")

    waiting_registry.register.assert_called_once()


def test_unexpected_root_dispatch_status_fails_closed() -> None:
    waiting_registry = MagicMock()
    dispatcher = MagicMock()
    dispatcher.dispatch.return_value = {"status": "PARTIAL"}
    boundary = triage_boundary.LegalRuleTriageBoundary(
        _config(),
        waiting_registry=waiting_registry,
        dispatcher=dispatcher,
    )

    with pytest.raises(RuntimeError, match="unexpected Root Orchestration"):
        boundary.handle(_message(), "corr-1")


def test_automatic_boundary_rejects_manual_trigger_before_checkpointing() -> None:
    message = _message()
    message["trigger"] = "MANUAL_ENGINEERING_RULE_NOT_READY"
    waiting_registry = MagicMock()
    dispatcher = MagicMock()

    boundary = triage_boundary.LegalRuleTriageBoundary(
        _config(),
        waiting_registry=waiting_registry,
        dispatcher=dispatcher,
    )
    with pytest.raises(ValueError, match="ENGINEERING_RULE_NOT_READY"):
        boundary.handle(message, "corr-1")

    waiting_registry.register.assert_not_called()
    dispatcher.dispatch.assert_not_called()
