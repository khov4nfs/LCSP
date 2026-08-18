from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from lcsp_workers.investigation.engineering_assessment_consumer import (
    EngineeringAssessmentConsumer,
)
from lcsp_workers.platform.api_client import WorkerCallbackError
from lcsp_workers.platform.queue_consumer import NonRetryableWorkerError


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

    consumer = EngineeringAssessmentConsumer(
        _config(),
        api_client=api_client,
        investigation_pipeline=pipeline,
    )

    with pytest.raises(NonRetryableWorkerError) as exc_info:
        consumer.handle(
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

    consumer = EngineeringAssessmentConsumer(
        _config(),
        api_client=api_client,
        investigation_pipeline=pipeline,
    )

    with pytest.raises(WorkerCallbackError):
        consumer.handle(
            {"evidenceReportId": "ter-1", "workflowRunId": "scan-1"},
            "corr-1",
        )
