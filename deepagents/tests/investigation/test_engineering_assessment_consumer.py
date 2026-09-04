from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from tools.common.capabilities.assessment.investigation.engineering_rule.engineering_assessment_boundary import (
    EngineeringAssessmentBoundary,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.pipeline import EngineeringInvestigationResult
from tools.common.capabilities.platform.api_client import WorkerCallbackError
from tools.common.capabilities.managed.boundary import NonRetryableAgentBoundaryError
from tools.triage.legal_rule_triage.contracts import LEGAL_RULE_TRIAGE_REQUEST_COMMAND


def _config():
    return SimpleNamespace(
        nestjs_api_base_url="http://localhost:3000",
        worker_api_key="worker-key",
        max_retries=3,
    )


def _snapshot_client_unavailable() -> MagicMock:
    snapshot_client = MagicMock()
    snapshot_client.download_snapshot_archive.side_effect = RuntimeError(
        "snapshot unavailable in unit test"
    )
    return snapshot_client


def _api_client() -> MagicMock:
    api_client = MagicMock()
    api_client.get_accepted_technical_evidence_report.return_value = {
        "id": "ter-1",
        "assessment_id": "assessment-1",
        "snapshot_id": "snapshot-1",
        "scan_job_id": "scan-1",
    }
    return api_client


def _boundary(*, api_client, pipeline, publisher=None) -> EngineeringAssessmentBoundary:
    return EngineeringAssessmentBoundary(
        _config(),
        api_client=api_client,
        investigation_pipeline=pipeline,
        snapshot_client=_snapshot_client_unavailable(),
        triage_trigger_publisher=publisher or MagicMock(),
    )


def test_classification_callback_4xx_is_terminal_and_not_outer_retryable() -> None:
    api_client = _api_client()
    api_client.post_classification_callback.side_effect = WorkerCallbackError(
        "CLASSIFICATION_OVERCLAIM: Callback failed with client error 422."
    )

    result = MagicMock()
    result.status = "COMPLETE"
    result.to_assessment_data.return_value = {
        "mode": "ENGINEERING_RULE_EVALUATION",
        "status": "COMPLETE",
        "summary": {"compliant": 1, "non_compliant": 0, "unknown": 0, "total": 1},
        "evaluations": [],
        "claims": [],
        "limitations": [],
    }
    pipeline = MagicMock()
    pipeline.run.return_value = result

    boundary = _boundary(api_client=api_client, pipeline=pipeline)

    with pytest.raises(NonRetryableAgentBoundaryError) as exc_info:
        boundary.handle(
            {"evidenceReportId": "ter-1", "workflowRunId": "scan-1"},
            "corr-1",
        )

    assert "CLASSIFICATION_OVERCLAIM" in str(exc_info.value)
    api_client.post_classification_callback.assert_called_once()


def test_retryable_callback_failure_is_preserved_for_outer_retry_policy() -> None:
    api_client = _api_client()
    api_client.post_classification_callback.side_effect = WorkerCallbackError(
        "Callback failed after 3 attempts with server error 503."
    )

    result = MagicMock()
    result.status = "PARTIAL"
    result.to_assessment_data.return_value = {
        "mode": "ENGINEERING_RULE_EVALUATION",
        "status": "PARTIAL",
        "summary": {"compliant": 0, "non_compliant": 0, "unknown": 1, "total": 1},
        "evaluations": [],
        "claims": [],
        "limitations": ["TEMPORARY_PROVIDER_FAILURE"],
    }
    pipeline = MagicMock()
    pipeline.run.return_value = result

    boundary = _boundary(api_client=api_client, pipeline=pipeline)

    with pytest.raises(WorkerCallbackError):
        boundary.handle(
            {"evidenceReportId": "ter-1", "workflowRunId": "scan-1"},
            "corr-1",
        )


def test_waiting_legal_source_emits_and_dispatches_automatic_full_backlog_triage_trigger() -> None:
    api_client = _api_client()
    publisher = MagicMock()
    pipeline = MagicMock()
    pipeline.run.return_value = EngineeringInvestigationResult(
        status="WAITING",
        legal_rule_catalog_version_id="catalog-v1",
        legal_corpus_version_id="corpus-v1",
        rules_considered=0,
        engineering_rules_executed=0,
        engineering_rule_cache_hits=0,
        limitations=("NO_ENGINEERING_RULE_SOURCE_RULES",),
    )

    boundary = _boundary(
        api_client=api_client,
        pipeline=pipeline,
        publisher=publisher,
    )

    boundary.handle(
        {"evidenceReportId": "ter-1", "workflowRunId": "scan-1"},
        "corr-1",
    )

    api_client.post_scan_runtime_event.assert_called_once()
    runtime_payload = api_client.post_scan_runtime_event.call_args.args[1]
    assert runtime_payload["stage"] == "LEGAL_RETRIEVAL"
    assert runtime_payload["tool_name"] == "engineering_rule_readiness"
    assert runtime_payload["waiting_reason"] == "NO_ENGINEERING_RULE_SOURCE_RULES"
    summary = runtime_payload["output_summary"]
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


def test_missing_ready_engineering_rules_emit_bounded_automatic_triage_trigger() -> None:
    api_client = _api_client()
    publisher = MagicMock()
    pipeline = MagicMock()
    pipeline.run.return_value = EngineeringInvestigationResult(
        status="BLOCKED",
        legal_rule_catalog_version_id="catalog-v2",
        legal_corpus_version_id="corpus-v3",
        rules_considered=2,
        engineering_rules_executed=0,
        engineering_rule_cache_hits=0,
        limitations=("NO_ENGINEERING_RULE_CANDIDATES",),
        observability={
            "engineering_rule_preparation": {
                "compile_skipped_legal_rule_ids": ["RULE-2", "RULE-1", "RULE-2"],
            }
        },
    )

    boundary = _boundary(
        api_client=api_client,
        pipeline=pipeline,
        publisher=publisher,
    )

    boundary.handle(
        {"evidenceReportId": "ter-1", "workflowRunId": "scan-1"},
        "corr-readiness-1",
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


def test_triage_dispatch_happens_only_after_waiting_classification_callback() -> None:
    api_client = _api_client()
    calls: list[str] = []
    api_client.post_classification_callback.side_effect = lambda _payload: calls.append(
        "classification"
    )
    publisher = MagicMock(side_effect=lambda _message: calls.append("triage"))
    pipeline = MagicMock()
    pipeline.run.return_value = EngineeringInvestigationResult(
        status="WAITING",
        legal_rule_catalog_version_id="catalog-v1",
        legal_corpus_version_id="corpus-v1",
        rules_considered=0,
        engineering_rules_executed=0,
        engineering_rule_cache_hits=0,
        limitations=("NO_ENGINEERING_RULE_SOURCE_RULES",),
    )
    boundary = _boundary(
        api_client=api_client,
        pipeline=pipeline,
        publisher=publisher,
    )

    boundary.handle({"evidenceReportId": "ter-1"}, "corr-order")

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


def test_boundary_forwards_source_crawl_requests_to_pipeline_for_input_compatibility() -> None:
    api_client = _api_client()

    result = MagicMock()
    result.status = "COMPLETE"
    result.to_assessment_data.return_value = {
        "mode": "ENGINEERING_RULE_EVALUATION",
        "status": "COMPLETE",
        "summary": {"compliant": 0, "non_compliant": 0, "unknown": 0, "total": 0},
        "evaluations": [],
        "claims": [],
        "limitations": [],
    }
    pipeline = MagicMock()
    pipeline.run.return_value = result

    boundary = _boundary(api_client=api_client, pipeline=pipeline)
    source_crawl_requests = [
        {
            "documentId": "LAW-TEST",
            "catalogSourceRef": "catalog-source:vbpl.vn:law:law-test",
            "sourceUrl": "https://vbpl.vn/test",
            "gatewayDocumentId": "123",
        }
    ]

    boundary.handle(
        {
            "evidenceReportId": "ter-1",
            "workflowRunId": "scan-1",
            "sourceCrawlRequests": source_crawl_requests,
        },
        "corr-1",
    )

    assert pipeline.run.call_args.kwargs["recovery_source_crawl_requests"] == (
        source_crawl_requests
    )
    api_client.post_classification_callback.assert_called_once()
