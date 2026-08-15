from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Protocol

from lcsp_workers.platform.api_client import WorkerApiClient
from lcsp_workers.platform.correlation import set_correlationId
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
    """Structural contract for executing a scan from a reanalysis request."""

    def handle(self, message: dict, correlationId: str) -> object:
        """Run a scan-compatible payload using the supplied correlation context."""
        ...


@dataclass(frozen=True)
class TargetedReanalysisEnvelope:
    """Normalized immutable fields carried by a targeted-reanalysis command."""

    request_id: str
    scan_job_id: str
    snapshot_id: str
    commit_sha: str
    analyzer_id: str
    normalized_scope: dict[str, object]
    checkpoint_ref: str
    correlationId: str
    delivery_attempt: int


class TargetedReanalysisConsumer(ConsumerBase):
    """Consumes only immutable, API-authorized targeted-reanalysis commands.

    The queue event is treated as an untrusted delivery hint. Before running any
    analyzer, the consumer reloads the authoritative request from the API and
    requires the event identifiers and normalized scope to match exactly. This
    prevents a stale or forged queue message from widening the approved scan scope.
    """

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
        """Initialize the consumer and its API/scan dependencies.

        Args:
            config: Worker runtime configuration, including API and retry settings.
            pbac_client: Optional base-consumer dependency; PBAC is not performed here
                because authorization is represented by the persisted API request.
            api_client: Optional internal API client override for tests/composition.
            scan_runner: Optional scan executor override; defaults to ``ScanConsumer``.
        """
        super().__init__(config, pbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._scan_runner = scan_runner or ScanConsumer(
            config,
            api_client=self._api_client,
        )

    def handle(self, message: dict, correlationId: str) -> None:
        """Validate, claim, and execute one targeted-reanalysis command.

        Execution is idempotency-aware: terminal requests and requests claimed by
        another worker are ignored. Subject-reference scopes must already have been
        resolved by the API to concrete path prefixes before repository code is read.

        Args:
            message: Queue payload describing the immutable reanalysis request.
            correlationId: Delivery correlation identifier used as a fallback.

        Raises:
            NonRetryableWorkerError: For invalid scope, privacy failures, event/API
                mismatches, or exhausted delivery retries.
            Exception: Re-raises retryable execution failures after the API request
                has been moved back to the requeueable state.
        """
        envelope = self._read_envelope(message, correlationId)
        set_correlationId(envelope.correlationId)
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
                    "correlationId": envelope.correlationId,
                    "targetedReanalysis": {
                        "analyzerId": envelope.analyzer_id,
                        "pathPrefixes": envelope.normalized_scope["pathPrefixes"],
                    },
                },
                envelope.correlationId,
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
        """Transition a failed execution to retry or terminal DLQ state.

        Args:
            envelope: Normalized request containing the current delivery attempt.
            error: Original execution error used for logging and exception chaining.

        Raises:
            NonRetryableWorkerError: Once the configured retry budget is exhausted.
            Exception: Re-raises the original error when another retry is allowed.
        """
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
        """Persist a terminal request state using a business-safe failure code."""
        self._api_client.fail_targeted_reanalysis_request(
            request_id,
            state=state,
            safe_failure_code=safe_failure_code,
        )

    def _read_envelope(
        self,
        message: dict,
        correlationId: str,
    ) -> TargetedReanalysisEnvelope:
        """Validate queue payload shape and normalize aliases into one envelope.

        Args:
            message: Raw queue message.
            correlationId: Delivery correlation identifier used when absent in payload.

        Returns:
            A validated immutable targeted-reanalysis envelope.

        Raises:
            NonRetryableWorkerError: If required identifiers, scope, or delivery-attempt
                metadata are malformed.
        """
        request_id = self._read_string(message, "requestId", "request_id")
        scan_job_id = self._read_string(message, "scanJobId", "scan_job_id")
        snapshot_id = self._read_string(message, "snapshotId", "snapshot_id")
        commit_sha = self._read_string(message, "commitSha", "commit_sha")
        analyzer_id = self._read_string(message, "analyzerId", "analyzer_id")
        checkpoint_ref = self._read_string(message, "checkpointRef", "checkpoint_ref")
        message_correlationId = self._read_string(
            message,
            "correlationId",
            "correlationId",
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
            correlationId=message_correlationId or correlationId,
            delivery_attempt=delivery_attempt,
        )

    def _assert_matches_authorized_request(
        self,
        envelope: TargetedReanalysisEnvelope,
        request: dict,
    ) -> None:
        """Require the queue envelope to equal the API-authorized immutable request.

        Args:
            envelope: Values received from the queue.
            request: Authoritative request loaded from the API.

        Raises:
            NonRetryableWorkerError: If any identity, checkpoint, commit, analyzer,
                snapshot, or normalized-scope value differs.
        """
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
        """Return the first non-empty string found under the supplied aliases."""
        for key in keys:
            value = message.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    @staticmethod
    def _is_scope(value: object) -> bool:
        """Check that a normalized scope has exactly one supported list dimension."""
        if not isinstance(value, dict) or len(value) != 1:
            return False
        key, values = next(iter(value.items()))
        return key in {"pathPrefixes", "subjectRefs"} and isinstance(values, list) and all(
            isinstance(item, str) and item for item in values
        )

    @staticmethod
    def _canonical_scope(value: object) -> str | None:
        """Serialize a valid scope deterministically for exact equality comparison."""
        if not TargetedReanalysisConsumer._is_scope(value):
            return None
        return json.dumps(value, sort_keys=True, separators=(",", ":"))
