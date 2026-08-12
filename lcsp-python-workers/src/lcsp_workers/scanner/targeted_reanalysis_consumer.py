from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Protocol

from lcsp_workers.platform.api_client import WorkerApiClient
from lcsp_workers.platform.correlation import set_correlation_id
from lcsp_workers.platform.logging import get_logger
from lcsp_workers.platform.queue_consumer import (
    ConsumerBase,
    NonRetryableWorkerError,
)

from .evidence_assembler import PrivacyAssertionError
from .scan_consumer import ScanConsumer


logger = get_logger(__name__)

TARGETED_REANALYSIS_COMMAND = "command.scan.targeted-reanalysis.v1"
TARGETED_REANALYSIS_QUEUE = "scan.targeted-reanalysis"
TERMINAL_FAILURE_STATE = "FAILED"
DLQ_FAILURE_STATE = "DLQ"
SAFE_VALIDATION_FAILURE_CODE = "TARGETED_REANALYSIS_EVENT_MISMATCH"
SAFE_PRIVACY_FAILURE_CODE = "PRIVACY_ASSERTION_FAILED"
SAFE_DELIVERY_FAILURE_CODE = "TARGETED_REANALYSIS_WORKER_DELIVERY_EXHAUSTED"
SAFE_UNRESOLVED_SCOPE_CODE = "TARGETED_REANALYSIS_SCOPE_UNRESOLVED"


class ScanRunner(Protocol):
    def handle(self, message: dict, correlation_id: str) -> object: ...


@dataclass(frozen=True)
class TargetedReanalysisEnvelope:
    request_id: str
    scan_job_id: str
    snapshot_id: str
    commit_sha: str
    analyzer_id: str
    normalized_scope: dict[str, object]
    checkpoint_ref: str
    correlation_id: str
    delivery_attempt: int


class TargetedReanalysisConsumer(ConsumerBase):
    """Consumes only immutable, API-authorized targeted-reanalysis commands."""

    queue_name = TARGETED_REANALYSIS_QUEUE
    routing_key = TARGETED_REANALYSIS_COMMAND
    requires_pbac = False
    retry_delays_seconds = (10, 60, 300)

    def __init__(
        self,
        config,
        pbac_client=None,
        api_client: WorkerApiClient | None = None,
        scan_runner: ScanRunner | None = None,
    ):
        super().__init__(config, pbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._scan_runner = scan_runner or ScanConsumer(
            config,
            api_client=self._api_client,
        )

    def handle(self, message: dict, correlation_id: str) -> None:
        envelope = self._read_envelope(message, correlation_id)
        set_correlation_id(envelope.correlation_id)
        request = self._api_client.get_targeted_reanalysis_request(envelope.request_id)
        self._assert_matches_authorized_request(envelope, request)

        state = request.get("state")
        if state in {"COMPLETED", "FAILED", "DLQ"}:
            return

        if not self._api_client.claim_targeted_reanalysis_request(envelope.request_id):
            return

        try:
            if "pathPrefixes" not in envelope.normalized_scope:
                self._fail_terminal(
                    envelope.request_id,
                    TERMINAL_FAILURE_STATE,
                    SAFE_UNRESOLVED_SCOPE_CODE,
                )
                raise NonRetryableWorkerError(
                    "targeted reanalysis subject references require API path resolution"
                )
            self._scan_runner.handle(
                {
                    "scanJobId": envelope.scan_job_id,
                    "snapshotId": envelope.snapshot_id,
                    "commitSha": envelope.commit_sha,
                    "correlationId": envelope.correlation_id,
                    "targetedReanalysis": {
                        "analyzerId": envelope.analyzer_id,
                        "pathPrefixes": envelope.normalized_scope["pathPrefixes"],
                    },
                },
                envelope.correlation_id,
            )
        except PrivacyAssertionError as error:
            self._fail_terminal(
                envelope.request_id,
                TERMINAL_FAILURE_STATE,
                SAFE_PRIVACY_FAILURE_CODE,
            )
            raise NonRetryableWorkerError("targeted reanalysis privacy assertion failed") from error
        except NonRetryableWorkerError:
            raise
        except Exception as error:
            self._handle_execution_failure(envelope, error)

    def _handle_execution_failure(
        self,
        envelope: TargetedReanalysisEnvelope,
        error: Exception,
    ) -> None:
        if envelope.delivery_attempt >= self._config.max_retries:
            self._fail_terminal(
                envelope.request_id,
                DLQ_FAILURE_STATE,
                SAFE_DELIVERY_FAILURE_CODE,
            )
            raise NonRetryableWorkerError("targeted reanalysis retries exhausted") from error

        self._api_client.requeue_targeted_reanalysis_request(envelope.request_id)
        logger.warning(
            "TARGETED_REANALYSIS_RETRY_SCHEDULED",
            request_id=envelope.request_id,
            delivery_attempt=envelope.delivery_attempt + 1,
            error_type=type(error).__name__,
        )
        raise error

    def _fail_terminal(
        self,
        request_id: str,
        state: str,
        safe_failure_code: str,
    ) -> None:
        self._api_client.fail_targeted_reanalysis_request(
            request_id,
            state=state,
            safe_failure_code=safe_failure_code,
        )

    def _read_envelope(
        self,
        message: dict,
        correlation_id: str,
    ) -> TargetedReanalysisEnvelope:
        request_id = self._read_string(message, "requestId", "request_id")
        scan_job_id = self._read_string(message, "scanJobId", "scan_job_id")
        snapshot_id = self._read_string(message, "snapshotId", "snapshot_id")
        commit_sha = self._read_string(message, "commitSha", "commit_sha")
        analyzer_id = self._read_string(message, "analyzerId", "analyzer_id")
        checkpoint_ref = self._read_string(message, "checkpointRef", "checkpoint_ref")
        message_correlation_id = self._read_string(
            message,
            "correlationId",
            "correlation_id",
        )
        normalized_scope = message.get("normalizedScope", message.get("normalized_scope"))
        if (
            not all(
                [
                    request_id,
                    scan_job_id,
                    snapshot_id,
                    commit_sha,
                    analyzer_id,
                    checkpoint_ref,
                ]
            )
            or not self._is_scope(normalized_scope)
        ):
            raise NonRetryableWorkerError("targeted reanalysis event is invalid")

        delivery_attempt = message.get("_delivery_attempt", 0)
        if not isinstance(delivery_attempt, int) or delivery_attempt < 0:
            raise NonRetryableWorkerError("targeted reanalysis delivery attempt is invalid")
        return TargetedReanalysisEnvelope(
            request_id=request_id,
            scan_job_id=scan_job_id,
            snapshot_id=snapshot_id,
            commit_sha=commit_sha,
            analyzer_id=analyzer_id,
            normalized_scope=normalized_scope,
            checkpoint_ref=checkpoint_ref,
            correlation_id=message_correlation_id or correlation_id,
            delivery_attempt=delivery_attempt,
        )

    def _assert_matches_authorized_request(
        self,
        envelope: TargetedReanalysisEnvelope,
        request: dict,
    ) -> None:
        expected = {
            "id": envelope.request_id,
            "scanJobId": envelope.scan_job_id,
            "snapshotId": envelope.snapshot_id,
            "commitSha": envelope.commit_sha,
            "analyzerId": envelope.analyzer_id,
            "checkpointRef": envelope.checkpoint_ref,
        }
        if any(request.get(key) != value for key, value in expected.items()) or (
            self._canonical_scope(request.get("normalizedScope"))
            != self._canonical_scope(envelope.normalized_scope)
        ):
            self._fail_terminal(
                envelope.request_id,
                TERMINAL_FAILURE_STATE,
                SAFE_VALIDATION_FAILURE_CODE,
            )
            raise NonRetryableWorkerError("targeted reanalysis event did not match request")

    @staticmethod
    def _read_string(message: dict, *keys: str) -> str | None:
        for key in keys:
            value = message.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    @staticmethod
    def _is_scope(value: object) -> bool:
        if not isinstance(value, dict) or len(value) != 1:
            return False
        key, values = next(iter(value.items()))
        return key in {"pathPrefixes", "subjectRefs"} and isinstance(values, list) and all(
            isinstance(item, str) and item for item in values
        )

    @staticmethod
    def _canonical_scope(value: object) -> str | None:
        if not TargetedReanalysisConsumer._is_scope(value):
            return None
        return json.dumps(value, sort_keys=True, separators=(",", ":"))
