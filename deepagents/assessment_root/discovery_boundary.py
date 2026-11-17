"""Run a deterministic, model-free repository discovery before audit-rule selection."""

from __future__ import annotations

import re
from typing import Any

from tools.common.capabilities.agent_runtime.boundary import (
    AgentBoundaryBase,
    NonRetryableAgentBoundaryError,
    RetryableAgentBoundaryError,
)
from tools.common.capabilities.platform.api_client import WorkerApiClient, WorkerCallbackError

DISCOVERY_COMMAND = "command.assessment.discovery.requested.v1"
DISCOVERY_BOUNDARY_SOURCE = "assessment.repository-discovery"
_UUID = re.compile(r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", re.IGNORECASE)


class AssessmentDiscoveryBoundary(AgentBoundaryBase):
    """Execute only the pinned deterministic scanner without any rule decisions or LLM calls."""

    boundary_source = DISCOVERY_BOUNDARY_SOURCE
    source_event = DISCOVERY_COMMAND
    requires_rbac = False
    # Retries must extend beyond the 30-minute lease, or a crashed worker leaves a RUNNING run stranded.
    retry_delays_seconds = (15, 60, 300, 900, 1800, 3600)

    def __init__(self, config: Any, rbac_client: Any | None = None, client: Any | None = None) -> None:
        super().__init__(config, rbac_client)
        self._client = client or WorkerApiClient(config.nestjs_api_base_url, config.worker_api_key)

    def handle(self, message: dict[str, Any], correlationId: str) -> dict[str, Any]:
        """Business purpose:
        Materialize the exact customer-authorized discovery artifact before any selected-rule audit.

        Business rules:
        - Only API-issued claim pins and worker lease can authorize scan or settlement.
        - Scanner, graph, repository hydration and generated artifact are reused from Assessment Root.
        - No customer repository code is executed and no model, fact or RuleDecision is accepted.
        - A completed retry is harmless; transient callbacks remain retryable for durable broker handling.

        Execution flow:
        1. Validate the command identifiers, claim an isolated API-owned discovery lease.
        2. Hydrate only the pinned snapshot and scan using the existing read-only discovery factory.
        3. Submit the bounded versioned artifact and complete the original run atomically.

        Failure cases:
        - Malformed commands and permanent claim refusals settle without repeated scans.
        - Scanner crashes and permanent submission errors are durably marked FAILED; live leases remain retryable until expiry.\n        - Callback transport failures retain broker retries without creating an empty discovery result.

        Side effects:
        - Reads a pinned repository sandbox, builds its graph/profile/discovery and posts one governed result.
        """
        assessment_id = message.get("assessmentId")
        run_id = message.get("runId")
        if (
            not isinstance(assessment_id, str) or not _UUID.fullmatch(assessment_id)
            or not isinstance(run_id, str) or not _UUID.fullmatch(run_id)
        ):
            raise NonRetryableAgentBoundaryError("invalid assessment discovery command identity")
        base = f"/internal/assessment-discovery/{assessment_id}/runs/{run_id}"
        try:
            claim = self._client._post_with_retry(f"{base}/claim", {}, redact=False)
        except WorkerCallbackError as error:
            if error.error_code == "ASSESSMENT_EXECUTION_LEASE_HELD":
                # A previous worker may still be active or may have crashed.
                # Retain the broker's retry authority until the API-owned lease expires.
                raise RetryableAgentBoundaryError("discovery lease is still owned") from error
            if error.callback_client_error:
                return {"state": "SKIPPED", "reason": error.error_code or "CLAIM_REJECTED"}
            raise RetryableAgentBoundaryError("discovery claim transport failed") from error
        if not isinstance(claim, dict) or claim.get("runId") != run_id:
            raise NonRetryableAgentBoundaryError("discovery claim identity mismatch")
        if claim.get("alreadyCompleted") is True:
            return {"state": "SKIPPED", "reason": "ALREADY_COMPLETED"}

        lease_token = claim.get("leaseToken")
        if not isinstance(lease_token, str) or not _UUID.fullmatch(lease_token):
            raise NonRetryableAgentBoundaryError("discovery claim has no valid lease")

        def save_discovery(discovery: dict[str, Any]) -> None:
            """Business purpose:
            Commit scanner output only through its current server-owned discovery lease.

            Business rules:
            - The payload is contract-bound and the server independently verifies its source pins.
            Execution flow:
            1. Submit the exact generated artifact and lease to the canonical complete endpoint.
            Failure cases:
            - API refusal or network error is propagated to durable transport retry.
            Side effects:
            - May persist one immutable Discovery artifact and complete one run.
            """
            self._client._post_with_retry(
                f"{base}/complete", {"leaseToken": lease_token, "discovery": discovery},
                redact=False,
            )

        try:
            from assessment_root.boundary import sandbox_backend_factory
            sandbox_backend_factory(
                claim,
                {
                    "assessmentId": assessment_id,
                    "repositorySnapshotId": claim["repositorySnapshotId"],
                    "repositoryScanJobId": claim["repositoryScanJobId"],
                    "repositoryCommit": claim["repositoryCommit"],
                    "repositoryId": claim["repositoryId"],
                    "sourcePathPrefix": claim.get("sourcePathPrefix"),
                },
                discovery_sink=save_discovery,
            )
        except WorkerCallbackError as error:
            if error.callback_client_error:
                # A permanent completion refusal must not leave an active lease
                # marked RUNNING until expiry. Preserve the source error code,
                # but use the bounded domain failure status, not error text.
                try:
                    self._client._post_with_retry(
                        f"{base}/fail",
                        {"leaseToken": lease_token, "errorCode": "DISCOVERY_COMPLETION_REJECTED"},
                        redact=False,
                    )
                except WorkerCallbackError as settlement_error:
                    if not settlement_error.callback_client_error:
                        raise RetryableAgentBoundaryError(
                            "discovery rejection settlement transport failed"
                        ) from settlement_error
                raise NonRetryableAgentBoundaryError(
                    f"discovery result rejected: {error.error_code or 'INVALID_PROVENANCE'}"
                ) from error
            raise RetryableAgentBoundaryError("discovery completion transport failed") from error
        except Exception as error:
            # A crashed scanner is not an empty or complete discovery. The API owns failure state.
            try:
                self._client._post_with_retry(
                    f"{base}/fail",
                    {"leaseToken": lease_token, "errorCode": "DISCOVERY_SCAN_FAILED"},
                    redact=False,
                )
            except WorkerCallbackError as callback_error:
                if callback_error.callback_client_error:
                    raise NonRetryableAgentBoundaryError(
                        "discovery failure settlement rejected"
                    ) from callback_error
                raise RetryableAgentBoundaryError(
                    "discovery failure settlement transport failed"
                ) from callback_error
            return {"state": "FAILED", "reason": type(error).__name__}
        return {"state": "COMPLETED", "runId": run_id}