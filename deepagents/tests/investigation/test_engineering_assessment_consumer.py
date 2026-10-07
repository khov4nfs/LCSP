from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from tools.common.capabilities.assessment.investigation.engineering_rule import (
    engineering_assessment_boundary as boundary_module,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.engineering_assessment_boundary import (
    EngineeringAssessmentBoundary,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.rule_sources import RuleResolution
from tools.common.capabilities.platform.api_client import WorkerCallbackError
from tools.common.capabilities.agent_runtime.boundary import NonRetryableAgentBoundaryError


def _config():
    return SimpleNamespace(
        nestjs_api_base_url="http://localhost:3000",
        worker_api_key="worker-key",
        max_retries=3,
    )


def _api_client() -> MagicMock:
    api_client = MagicMock()
    api_client.get_accepted_technical_evidence_report.return_value = {
        "id": "ter-1",
        "assessment_id": "assessment-1",
        "snapshot_id": "snapshot-1",
        "scan_job_id": "scan-1",
    }
    return api_client


CONFIRMED = SimpleNamespace(statements=(), context_revision=1)


def _boundary(*, api_client, resolution=None, monkeypatch=None):
    """Boundary with fakes; ``resolution`` replaces legal-source resolution (returns kwargs seen)."""
    seen: dict = {}
    if resolution is not None:

        def fake_resolve(**kwargs):
            seen.update(kwargs)
            return resolution

        monkeypatch.setattr(boundary_module, "resolve_engineering_rules", fake_resolve)
    boundary = EngineeringAssessmentBoundary(
        _config(),
        api_client=api_client,
        retriever=MagicMock(),
    )
    return boundary, seen


def test_evidence_lookup_4xx_is_terminal_and_not_outer_retryable() -> None:
    api_client = _api_client()
    api_client.get_accepted_technical_evidence_report.side_effect = WorkerCallbackError(
        "VALIDATION_FAILED: Callback failed with client error 404.", status_code=404
    )
    boundary, _ = _boundary(api_client=api_client)

    with pytest.raises(NonRetryableAgentBoundaryError) as exc_info:
        boundary.handle({"evidenceReportId": "stale-ter", "workflowRunId": "scan-1"}, "corr-stale")

    assert "client error 404" in str(exc_info.value)
    api_client.post_classification_callback.assert_not_called()


def test_evidence_lookup_server_failure_remains_outer_retryable() -> None:
    api_client = _api_client()
    api_client.get_accepted_technical_evidence_report.side_effect = WorkerCallbackError(
        "Callback failed after 3 attempts with server error 503."
    )
    boundary, _ = _boundary(api_client=api_client)

    with pytest.raises(WorkerCallbackError, match="server error 503"):
        boundary.handle({"evidenceReportId": "ter-1", "workflowRunId": "scan-1"}, "corr-retry")


def test_handle_without_confirmed_context_fails_closed_and_analyzes_nothing() -> None:
    api_client = _api_client()
    dispatcher = MagicMock()
    boundary, _ = _boundary(api_client=api_client)
    boundary._dispatcher = dispatcher

    boundary.handle({"evidenceReportId": "ter-1", "workflowRunId": "scan-1"}, "corr-1")

    dispatcher.dispatch.assert_not_called()
    payload = api_client.post_classification_callback.call_args.args[0]
    assert payload.guardrail_status == "BLOCKED"
    assert payload.classification_data["status"] == "BLOCKED"
    assert payload.classification_data["evaluations"] == []


def test_classification_callback_4xx_is_terminal_and_not_outer_retryable() -> None:
    api_client = _api_client()
    api_client.post_classification_callback.side_effect = WorkerCallbackError(
        "CLASSIFICATION_OVERCLAIM: Callback failed with client error 422.", status_code=422
    )
    boundary, _ = _boundary(api_client=api_client)

    with pytest.raises(NonRetryableAgentBoundaryError) as exc_info:
        boundary.handle({"evidenceReportId": "ter-1", "workflowRunId": "scan-1"}, "corr-1")

    assert "CLASSIFICATION_OVERCLAIM" in str(exc_info.value)
    api_client.post_classification_callback.assert_called_once()


def test_retryable_callback_failure_is_preserved_for_outer_retry_policy() -> None:
    api_client = _api_client()
    api_client.post_classification_callback.side_effect = WorkerCallbackError(
        "Callback failed after 3 attempts with server error 503."
    )
    boundary, _ = _boundary(api_client=api_client)

    with pytest.raises(WorkerCallbackError):
        boundary.handle({"evidenceReportId": "ter-1", "workflowRunId": "scan-1"}, "corr-1")


def test_rule_resolution_reads_the_portfolio_with_no_recovery_or_compile_arguments(monkeypatch) -> None:
    api_client = _api_client()
    boundary, seen = _boundary(
        api_client=api_client,
        resolution=RuleResolution(status="BLOCKED", reason="X"),
        monkeypatch=monkeypatch,
    )

    boundary.run_assessment(
        {"evidenceReportId": "ter-1", "workflowRunId": "scan-1"},
        "corr-1",
        confirmed_context=CONFIRMED,
    )

    # The assessment only reads the ACTIVE portfolio: no rule service (compile/cache) and no
    # recovery driver reach the resolver.
    assert set(seen) == {"api_client", "retriever", "workflow_run_id", "correlation_id"}
    assert seen["workflow_run_id"] == "scan-1"
    api_client.post_classification_callback.assert_called_once()


def test_assessment_boundary_has_no_legal_preparation_or_recovery_path() -> None:
    import inspect

    source = inspect.getsource(boundary_module)
    for retired in ("triage", "RABBITMQ", "recovery", "WaitingAssessmentRegistry", "EngineeringRuleService", "compile"):
        assert retired not in source, retired
    assert not hasattr(EngineeringAssessmentBoundary, "_dispatch_legal_triage_request")
