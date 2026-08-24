from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from tools.engineer_rule.investigation.engineering_assessment_boundary import (
    EngineeringAssessmentBoundary,
)
from tools.engineer_rule.investigation.pipeline import EngineeringInvestigationResult
from tools.common.platform.api_client import WorkerCallbackError
from tools.common.managed.boundary import NonRetryableAgentBoundaryError


def _config():
    return SimpleNamespace(
        nestjs_api_base_url="http://localhost:3000",
        worker_api_key="worker-key",
        max_retries=3,
    )


def test_classification_callback_4xx_is_terminal_and_not_outer_retryable() -> None:
    api_client = MagicMock()
    api_client.get_accepted_technical_evidence_report.return_value = {
        "id": "ter-1",
        "assessment_id": "assessment-1",
        "snapshot_id": "snapshot-1",
        "scan_job_id": "scan-1",
    }
    api_client.get_wizard_profile_for_assessment.side_effect = RuntimeError(
        "optional wizard unavailable"
    )
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

    boundary = EngineeringAssessmentBoundary(
        _config(),
        api_client=api_client,
        investigation_pipeline=pipeline,
    )

    with pytest.raises(NonRetryableAgentBoundaryError) as exc_info:
        boundary.handle(
            {"evidenceReportId": "ter-1", "workflowRunId": "scan-1"},
            "corr-1",
        )

    assert "CLASSIFICATION_OVERCLAIM" in str(exc_info.value)
    api_client.post_classification_callback.assert_called_once()


def test_retryable_callback_failure_is_preserved_for_outer_retry_policy() -> None:
    api_client = MagicMock()
    api_client.get_accepted_technical_evidence_report.return_value = {
        "id": "ter-1",
        "assessment_id": "assessment-1",
        "snapshot_id": "snapshot-1",
        "scan_job_id": "scan-1",
    }
    api_client.get_wizard_profile_for_assessment.return_value = None
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

    boundary = EngineeringAssessmentBoundary(
        _config(),
        api_client=api_client,
        investigation_pipeline=pipeline,
    )

    with pytest.raises(WorkerCallbackError):
        boundary.handle(
            {"evidenceReportId": "ter-1", "workflowRunId": "scan-1"},
            "corr-1",
        )


def test_waiting_investigation_submits_blocked_classification_callback() -> None:
    api_client = MagicMock()
    api_client.get_accepted_technical_evidence_report.return_value = {
        "id": "ter-1",
        "assessment_id": "assessment-1",
        "snapshot_id": "snapshot-1",
        "scan_job_id": "scan-1",
    }
    api_client.get_wizard_profile_for_assessment.return_value = None

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

    boundary = EngineeringAssessmentBoundary(
        _config(),
        api_client=api_client,
        investigation_pipeline=pipeline,
    )

    boundary.handle(
        {"evidenceReportId": "ter-1", "workflowRunId": "scan-1"},
        "corr-1",
    )

    api_client.post_scan_runtime_event.assert_called_once()
    runtime_payload = api_client.post_scan_runtime_event.call_args.args[1]
    assert runtime_payload["output_summary"]["kind"] == "WIZARD_CONTEXT_REQUEST"
    assert runtime_payload["output_summary"]["scope"] == "POST_GRAPH"
    assert runtime_payload["output_summary"]["requestedBy"] == "PLANNER"
    assert runtime_payload["output_summary"]["reasonCode"] == (
        "NO_ENGINEERING_RULE_SOURCE_RULES"
    )
    assert runtime_payload["output_summary"]["questionIds"] == [
        "MISSING_RULE_SCOPE",
        "MISSING_GRAPH_CONTEXT",
        "MISSING_HUMAN_REVIEW_BOUNDARY",
    ]
    assert [
        question["targetFieldName"]
        for question in runtime_payload["output_summary"]["questions"]
    ] == [
        "postGraphRuleScope",
        "postGraphContext",
        "postGraphHumanReviewBoundary",
    ]
    api_client.post_classification_callback.assert_called_once()
    payload = api_client.post_classification_callback.call_args.args[0]
    assert payload.guardrail_status == "BLOCKED"
    assert payload.classification_data["status"] == "WAITING"
    assert payload.classification_data["limitations"] == [
        "NO_ENGINEERING_RULE_SOURCE_RULES"
    ]
