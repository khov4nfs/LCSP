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
from tools.triage.legal_rule_triage.contracts import LEGAL_RULE_TRIAGE_REQUEST_COMMAND


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


def _boundary(*, api_client, publisher=None, resolution=None, monkeypatch=None):
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
        rule_service=MagicMock(),
        triage_trigger_publisher=publisher or MagicMock(),
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


def test_waiting_legal_source_emits_and_dispatches_automatic_full_backlog_triage_trigger(monkeypatch) -> None:
    api_client = _api_client()
    publisher = MagicMock()
    resolution = RuleResolution(
        status="WAITING",
        catalog_version_id="catalog-v1",
        corpus_version_id="corpus-v1",
        limitations=("NO_ENGINEERING_RULE_SOURCE_RULES",),
        reason="NO_ENGINEERING_RULE_SOURCE_RULES",
    )

    boundary, _ = _boundary(api_client=api_client, publisher=publisher, resolution=resolution, monkeypatch=monkeypatch)

    boundary.run_assessment(
        {"evidenceReportId": "ter-1", "workflowRunId": "scan-1"},
        "corr-1",
        confirmed_context=CONFIRMED,
    )

    api_client.post_scan_runtime_event.assert_called_once()
    runtime_payload = api_client.post_scan_runtime_event.call_args.args[1]
    assert runtime_payload["stage"] == "LEGAL_RETRIEVAL"
    assert runtime_payload["tool_name"] == "engineering_rule_readiness"
    assert runtime_payload["summary"] == "ENGINEERING_RULE_READINESS_WAITING"
    assert runtime_payload["waiting_reason"] == "NO_ENGINEERING_RULE_SOURCE_RULES"
    summary = runtime_payload["output_summary"]
    assert summary["messageKey"] == "ENGINEERING_RULE_READINESS_WAITING"
    assert summary["messageParams"] == {}
    assert summary["kind"] == "LEGAL_PREPARATION_REQUEST"
    assert summary["scope"] == "LEGAL_MAINTENANCE"
    assert summary["requestedBy"] == "ASSESSMENT_READINESS_GATE"
    assert summary["reasonCode"] == "NO_ENGINEERING_RULE_SOURCE_RULES"
    assert "questions" not in summary
    triage = summary["triageTrigger"]
    assert triage["trigger"] == "ENGINEERING_RULE_NOT_READY"
    assert triage["automatic"] is True
    assert triage["affectedLegalRuleIds"] == []
    assert triage["fullBacklog"] is True
    assert triage["refreshLegalCatalog"] is True
    assert "assessmentId" not in triage
    assert "manualTriageRequest" not in summary

    api_client.post_classification_callback.assert_called_once()
    payload = api_client.post_classification_callback.call_args.args[0]
    assert payload.guardrail_status == "BLOCKED"
    assert payload.classification_data["status"] == "WAITING"

    publisher.assert_called_once()
    command = publisher.call_args.args[0]
    assert command["trigger"] == "ENGINEERING_RULE_NOT_READY"
    assert command["affectedLegalRuleIds"] == []
    assert command["resumeEvidenceReportId"] == "ter-1"
    assert command["resumeWorkflowRunId"] == "scan-1"
    assert command["correlationId"] == "corr-1"
    assert "assessmentId" not in command


def test_missing_ready_engineering_rules_emit_bounded_automatic_triage_trigger(monkeypatch) -> None:
    api_client = _api_client()
    publisher = MagicMock()
    resolution = RuleResolution(
        status="BLOCKED",
        catalog_version_id="catalog-v2",
        corpus_version_id="corpus-v3",
        legal_rules=({"id": "a"}, {"id": "b"}),
        limitations=("NO_ENGINEERING_RULE_CANDIDATES",),
        reason="ENGINEERING_RULE_NOT_READY",
        observability={
            "engineering_rule_preparation": {
                "compile_skipped_legal_rule_ids": ["RULE-2", "RULE-1", "RULE-2"],
            }
        },
    )

    boundary, _ = _boundary(api_client=api_client, publisher=publisher, resolution=resolution, monkeypatch=monkeypatch)

    boundary.run_assessment(
        {"evidenceReportId": "ter-1", "workflowRunId": "scan-1"},
        "corr-readiness-1",
        confirmed_context=CONFIRMED,
    )

    runtime_payload = api_client.post_scan_runtime_event.call_args.args[1]
    assert runtime_payload["waiting_reason"] == "ENGINEERING_RULE_NOT_READY"
    assert runtime_payload["stage"] == "LEGAL_RETRIEVAL"
    summary = runtime_payload["output_summary"]
    assert summary["kind"] == "LEGAL_PREPARATION_REQUEST"
    assert summary["requestedBy"] == "ASSESSMENT_READINESS_GATE"
    assert summary["missingLegalRuleIds"] == ["RULE-2", "RULE-1"]
    assert "manualTriageRequest" not in summary

    triage = summary["triageTrigger"]
    assert triage["mode"] == "LEGAL_MAINTENANCE"
    assert triage["trigger"] == "ENGINEERING_RULE_NOT_READY"
    assert triage["automatic"] is True
    assert triage["affectedLegalRuleIds"] == ["RULE-2", "RULE-1"]
    assert triage["fullBacklog"] is False
    assert triage["refreshLegalCatalog"] is False
    assert triage["legalRuleCatalogVersionId"] == "catalog-v2"
    assert triage["legalCorpusVersionId"] == "corpus-v3"
    assert triage["idempotencyKey"].startswith("legal-triage:")
    assert len(triage["idempotencyKey"]) == len("legal-triage:") + 64
    assert "assessmentId" not in triage

    payload = api_client.post_classification_callback.call_args.args[0]
    assert payload.guardrail_status == "BLOCKED"
    assert payload.classification_data["status"] == "WAITING"
    assert payload.classification_data["observability"]["legal_preparation"] == {
        "status": "WAITING",
        "reason": "ENGINEERING_RULE_NOT_READY",
        "trigger": "ENGINEERING_RULE_NOT_READY",
        "automatic": True,
        "missing_legal_rule_ids": ["RULE-2", "RULE-1"],
    }

    publisher.assert_called_once()
    command = publisher.call_args.args[0]
    assert command["affectedLegalRuleIds"] == ["RULE-2", "RULE-1"]
    assert command["legalRuleCatalogVersionId"] == "catalog-v2"
    assert command["legalCorpusVersionId"] == "corpus-v3"
    assert command["idempotencyKey"] == triage["idempotencyKey"]
    assert command["resumeEvidenceReportId"] == "ter-1"
    assert "assessmentId" not in command


def test_triage_dispatch_happens_only_after_waiting_classification_callback(monkeypatch) -> None:
    api_client = _api_client()
    calls: list[str] = []
    api_client.post_classification_callback.side_effect = lambda _payload: calls.append(
        "classification"
    )
    publisher = MagicMock(side_effect=lambda _message: calls.append("triage"))
    resolution = RuleResolution(
        status="WAITING",
        catalog_version_id="catalog-v1",
        corpus_version_id="corpus-v1",
        limitations=("NO_ENGINEERING_RULE_SOURCE_RULES",),
        reason="NO_ENGINEERING_RULE_SOURCE_RULES",
    )
    boundary, _ = _boundary(api_client=api_client, publisher=publisher, resolution=resolution, monkeypatch=monkeypatch)

    boundary.run_assessment({"evidenceReportId": "ter-1"}, "corr-order", confirmed_context=CONFIRMED)

    assert calls == ["classification", "triage"]


def test_triage_idempotency_is_reusable_across_assessment_identity() -> None:
    key = EngineeringAssessmentBoundary._triage_trigger_idempotency_key(
        reason="ENGINEERING_RULE_NOT_READY",
        catalog_version_id="catalog-v2",
        corpus_version_id="corpus-v3",
        legal_rule_ids=("RULE-2", "RULE-1"),
    )
    same_scope_different_order = EngineeringAssessmentBoundary._triage_trigger_idempotency_key(
        reason="ENGINEERING_RULE_NOT_READY",
        catalog_version_id="catalog-v2",
        corpus_version_id="corpus-v3",
        legal_rule_ids=("RULE-1", "RULE-2"),
    )

    assert key == same_scope_different_order
    assert "assessment" not in key


def test_automatic_triage_command_uses_managed_boundary_routing_key() -> None:
    assert LEGAL_RULE_TRIAGE_REQUEST_COMMAND == "command.legal-rule-triage.requested.v1"


def test_source_crawl_requests_are_forwarded_to_rule_resolution_for_input_compatibility(monkeypatch) -> None:
    api_client = _api_client()
    boundary, seen = _boundary(
        api_client=api_client,
        resolution=RuleResolution(status="BLOCKED", reason="X"),
        monkeypatch=monkeypatch,
    )
    requests = [{"documentId": "LAW-TEST", "sourceUrl": "https://vbpl.vn/test"}]

    boundary.run_assessment(
        {"evidenceReportId": "ter-1", "workflowRunId": "scan-1", "sourceCrawlRequests": requests},
        "corr-1",
        confirmed_context=CONFIRMED,
    )

    assert seen["source_crawl_requests"] == requests
    assert seen["workflow_run_id"] == "scan-1"
    api_client.post_classification_callback.assert_called_once()


def test_malformed_source_crawl_requests_are_terminal(monkeypatch) -> None:
    boundary, _ = _boundary(
        api_client=_api_client(),
        resolution=RuleResolution(status="BLOCKED", reason="X"),
        monkeypatch=monkeypatch,
    )

    with pytest.raises(NonRetryableAgentBoundaryError):
        boundary.run_assessment(
            {"evidenceReportId": "ter-1", "sourceCrawlRequests": "nope"},
            "corr-1",
            confirmed_context=CONFIRMED,
        )
