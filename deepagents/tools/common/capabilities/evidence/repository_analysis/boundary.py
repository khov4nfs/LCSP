"""Managed invocation boundary for Deep Agent-native repository analysis."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

from tools.common.capabilities.agent_runtime.boundary import (
    AgentBoundaryBase,
    NonRetryableAgentBoundaryError,
)
from middleware.failure_policy import is_provider_model_unavailable
from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.platform.callback_schemas import (
    CallbackResponse,
    SCAN_CALLBACK_STATUSES,
    ScanCallbackPayload,
)
from .analyzer import RepositoryDeepAnalyzer


_TERMINAL_SCAN_STATUS_CODES = {400, 404, 409, 422}


class RepositoryAnalysisBoundary(AgentBoundaryBase):
    """Turn a pinned repository snapshot into Deep Agent-authored technical evidence."""

    boundary_source = "repository-analysis.triggered"
    source_event = "command.scan.requested.v1"
    scan_timeout_seconds = 600

    def __init__(
        self,
        config,
        rbac_client=None,
        *,
        analyzer: RepositoryDeepAnalyzer | None = None,
        api_client: WorkerApiClient | None = None,
    ) -> None:
        super().__init__(config, rbac_client)
        self._analyzer = analyzer or RepositoryDeepAnalyzer()
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )

    def handle(self, message: dict[str, Any], correlationId: str) -> CallbackResponse:
        scan_job_id = _required(message, "scanJobId", "scan_job_id")
        snapshot_id = _required(message, "snapshotId", "snapshot_id")
        commit_sha = _required(message, "commitSha", "commit_sha")
        correlation_id = (
            _optional(message, "correlationId", "correlation_id") or correlationId
        )
        self._event(
            scan_job_id,
            "RUN_STARTED",
            "RUNNING",
            "repository_deep_analysis",
            "Deep Agent repository analysis started",
            input_summary={"snapshotId": snapshot_id, "commitSha": commit_sha},
        )

        self._event(
            scan_job_id,
            "TOOL_STARTED",
            "RUNNING",
            "ai_discovery",
            "Bounded AI discovery started against the hydrated repository.",
            input_summary={"snapshotId": snapshot_id, "commitSha": commit_sha},
        )

        try:
            artifact = self._analyzer.analyze(
                snapshot_id=snapshot_id,
                commit_sha=commit_sha,
                scan_job_id=scan_job_id,
            )
            callback = ScanCallbackPayload(
                status=(
                    SCAN_CALLBACK_STATUSES["success"]
                    if artifact.result.coverage_state == "READY"
                    else SCAN_CALLBACK_STATUSES["partial"]
                ),
                scan_job_id=scan_job_id,
                tools_version=artifact.tools_version,
                config_hash=artifact.config_hash,
                evidence_payload=artifact.evidence_payload,
                privacy_flags={
                    "containsSourceCode": False,
                    "secretsRedacted": True,
                    "sourceStrippedFromFindings": True,
                },
                schema_version="1.0.0",
            )
            response = self._api_client.post_scan_callback(scan_job_id, callback)
        except Exception as error:
            self._event(
                scan_job_id,
                "RUN_FAILED",
                "FAILED",
                "repository_deep_analysis",
                "Deep Agent repository analysis failed",
                error_summary=type(error).__name__,
            )
            if _terminal(error):
                raise NonRetryableAgentBoundaryError(str(error)) from error
            raise

        self._event(
            scan_job_id,
            "RUN_COMPLETED",
            "COMPLETED",
            "repository_deep_analysis",
            "Deep Agent repository analysis completed",
            output_summary={
                "coverageState": artifact.result.coverage_state,
                "aiGate": artifact.result.ai_discovery.gate,
                "anchors": len(artifact.result.source_anchors),
            },
        )
        return response

    def _event(
        self,
        scan_job_id: str,
        event_type: str,
        run_status: str,
        tool_name: str,
        summary: str,
        *,
        input_summary: dict[str, object] | None = None,
        output_summary: dict[str, object] | None = None,
        error_summary: str | None = None,
    ) -> None:
        post = getattr(self._api_client, "post_scan_runtime_event", None)
        if not callable(post):
            return
        payload: dict[str, object] = {
            "event_type": event_type,
            "run_status": run_status,
            "stage": "SCAN",
            "tool_name": tool_name,
            "summary": summary,
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
        if input_summary is not None:
            payload["input_summary"] = input_summary
        if output_summary is not None:
            payload["output_summary"] = output_summary
        if error_summary is not None:
            payload["error_summary"] = error_summary
        post(scan_job_id, payload)


def _required(message: dict[str, Any], *names: str) -> str:
    value = _optional(message, *names)
    if value is None:
        raise ValueError(f"repository analysis message missing {names[0]}")
    return value


def _optional(message: dict[str, Any], *names: str) -> str | None:
    for name in names:
        value = message.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _terminal(error: Exception) -> bool:
    """Whether this failure means the scan itself can never succeed.

    The status codes here describe *our* API rejecting the scan callback — a
    payload or state problem that redelivery cannot fix. A model provider also
    reports an unusable model route as 400/404, which looks identical but is a
    passing outage: the snapshot, the repository and the callback are all fine,
    and the same scan succeeds once a route is available. Failing it terminally
    marks the scan job FAILED and leaves the assessment with no evidence, so it
    stays retryable and is left to provider fallback and queue redelivery.
    """
    if is_provider_model_unavailable(error):
        return False
    if isinstance(error, httpx.HTTPStatusError):
        return error.response.status_code in _TERMINAL_SCAN_STATUS_CODES
    status_code = getattr(error, "status_code", None)
    return isinstance(status_code, int) and status_code in _TERMINAL_SCAN_STATUS_CODES


__all__ = ["RepositoryAnalysisBoundary"]
