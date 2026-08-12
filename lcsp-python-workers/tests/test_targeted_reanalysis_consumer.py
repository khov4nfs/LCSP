from unittest.mock import MagicMock

import pytest

from lcsp_workers.platform.queue_consumer import NonRetryableWorkerError
from lcsp_workers.scanner.evidence_assembler import PrivacyAssertionError
from lcsp_workers.scanner.targeted_reanalysis_consumer import (
    DLQ_FAILURE_STATE,
    SAFE_DELIVERY_FAILURE_CODE,
    SAFE_PRIVACY_FAILURE_CODE,
    SAFE_UNRESOLVED_SCOPE_CODE,
    SAFE_VALIDATION_FAILURE_CODE,
    TERMINAL_FAILURE_STATE,
    TargetedReanalysisConsumer,
)


@pytest.fixture
def config():
    return MagicMock(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-key",
        max_retries=3,
    )


@pytest.fixture
def event():
    return {
        "requestId": "request-1",
        "scanJobId": "scan-job-1",
        "snapshotId": "snapshot-1",
        "commitSha": "commit-1",
        "analyzerId": "RUN_PYTHON_SEMANTIC_ANALYSIS",
        "normalizedScope": {"pathPrefixes": ["src/"]},
        "checkpointRef": "checkpoint:request-1",
        "correlationId": "correlation-1",
    }


@pytest.fixture
def authorized_request(event):
    return {
        "id": event["requestId"],
        "scanJobId": event["scanJobId"],
        "snapshotId": event["snapshotId"],
        "commitSha": event["commitSha"],
        "analyzerId": event["analyzerId"],
        "normalizedScope": event["normalizedScope"],
        "checkpointRef": event["checkpointRef"],
        "state": "DISPATCHED",
    }


def build_consumer(config, authorized_request):
    api_client = MagicMock()
    api_client.get_targeted_reanalysis_request.return_value = authorized_request
    api_client.claim_targeted_reanalysis_request.return_value = True
    scan_runner = MagicMock()
    return TargetedReanalysisConsumer(
        config,
        api_client=api_client,
        scan_runner=scan_runner,
    ), api_client, scan_runner


def test_claims_an_authorized_event_then_runs_the_immutable_scan_job(
    config,
    event,
    authorized_request,
):
    consumer, api_client, scan_runner = build_consumer(config, authorized_request)

    consumer.handle(event, "fallback-correlation")

    api_client.claim_targeted_reanalysis_request.assert_called_once_with("request-1")
    scan_runner.handle.assert_called_once_with(
        {
            "scanJobId": "scan-job-1",
            "snapshotId": "snapshot-1",
            "commitSha": "commit-1",
            "correlationId": "correlation-1",
            "targetedReanalysis": {
                "analyzerId": "RUN_PYTHON_SEMANTIC_ANALYSIS",
                "pathPrefixes": ["src/"],
            },
        },
        "correlation-1",
    )


def test_rejects_subject_scope_until_the_api_resolves_it_to_pinned_paths(
    config,
    event,
    authorized_request,
):
    event["normalizedScope"] = {"subjectRefs": ["finding:target-12345678"]}
    authorized_request["normalizedScope"] = event["normalizedScope"]
    consumer, api_client, scan_runner = build_consumer(config, authorized_request)

    with pytest.raises(NonRetryableWorkerError):
        consumer.handle(event, "fallback-correlation")

    api_client.fail_targeted_reanalysis_request.assert_called_once_with(
        "request-1",
        state=TERMINAL_FAILURE_STATE,
        safe_failure_code=SAFE_UNRESOLVED_SCOPE_CODE,
    )
    scan_runner.handle.assert_not_called()


def test_rejects_a_tampered_event_before_scanning(config, event, authorized_request):
    authorized_request["snapshotId"] = "different-snapshot"
    consumer, api_client, scan_runner = build_consumer(config, authorized_request)

    with pytest.raises(NonRetryableWorkerError):
        consumer.handle(event, "fallback-correlation")

    api_client.fail_targeted_reanalysis_request.assert_called_once_with(
        "request-1",
        state=TERMINAL_FAILURE_STATE,
        safe_failure_code=SAFE_VALIDATION_FAILURE_CODE,
    )
    scan_runner.handle.assert_not_called()


def test_requeues_a_transient_worker_failure(config, event, authorized_request):
    consumer, api_client, scan_runner = build_consumer(config, authorized_request)
    scan_runner.handle.side_effect = RuntimeError("transient")

    with pytest.raises(RuntimeError, match="transient"):
        consumer.handle(event, "fallback-correlation")

    api_client.requeue_targeted_reanalysis_request.assert_called_once_with("request-1")
    api_client.fail_targeted_reanalysis_request.assert_not_called()


def test_marks_the_last_delivery_as_dlq(config, event, authorized_request):
    event["_delivery_attempt"] = config.max_retries
    consumer, api_client, scan_runner = build_consumer(config, authorized_request)
    scan_runner.handle.side_effect = RuntimeError("transient")

    with pytest.raises(NonRetryableWorkerError):
        consumer.handle(event, "fallback-correlation")

    api_client.fail_targeted_reanalysis_request.assert_called_once_with(
        "request-1",
        state=DLQ_FAILURE_STATE,
        safe_failure_code=SAFE_DELIVERY_FAILURE_CODE,
    )
    api_client.requeue_targeted_reanalysis_request.assert_not_called()


def test_marks_privacy_failure_terminal_without_retry(config, event, authorized_request):
    consumer, api_client, scan_runner = build_consumer(config, authorized_request)
    scan_runner.handle.side_effect = PrivacyAssertionError("unsafe")

    with pytest.raises(NonRetryableWorkerError):
        consumer.handle(event, "fallback-correlation")

    api_client.fail_targeted_reanalysis_request.assert_called_once_with(
        "request-1",
        state=TERMINAL_FAILURE_STATE,
        safe_failure_code=SAFE_PRIVACY_FAILURE_CODE,
    )
