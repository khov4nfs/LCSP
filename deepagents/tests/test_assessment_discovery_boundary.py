"""Regression tests for the independent, model-free pre-scope Discovery boundary."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from assessment_root.discovery_boundary import AssessmentDiscoveryBoundary
from tools.common.capabilities.agent_runtime.boundary import (
    NonRetryableAgentBoundaryError,
    RetryableAgentBoundaryError,
)
from tools.common.capabilities.platform.api_client import WorkerCallbackError

ASSESSMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
RUN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
LEASE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"


class _Api:
    def __init__(self, *, completed: bool = False) -> None:
        self.completed = completed
        self.requests: list[tuple[str, dict[str, Any]]] = []
        self.complete_error: Exception | None = None

    def _post_with_retry(self, path: str, payload: dict[str, Any], *, redact: bool) -> dict[str, Any]:
        assert redact is False
        self.requests.append((path, payload))
        if path.endswith("/claim"):
            return {
                "runId": RUN,
                "assessmentId": ASSESSMENT,
                "threadId": f"discovery:{ASSESSMENT}:{RUN}",
                "repositorySnapshotId": "snapshot-1",
                "repositoryScanJobId": "scan-job-1",
                "repositoryCommit": "a" * 40,
                "repositoryId": "repository-1",
                "sourcePathPrefix": "apps/api",
                "leaseToken": LEASE,
                "alreadyCompleted": self.completed,
            }
        if path.endswith("/complete") and self.complete_error:
            raise self.complete_error
        return {"ok": True}


def _boundary(client: _Api) -> AssessmentDiscoveryBoundary:
    return AssessmentDiscoveryBoundary(
        SimpleNamespace(nestjs_api_base_url="http://unused", worker_api_key="unused"),
        client=client,
    )


def _message() -> dict[str, Any]:
    return {"assessmentId": ASSESSMENT, "runId": RUN}


def test_discovery_scans_pinned_source_and_settles_with_original_lease(monkeypatch: pytest.MonkeyPatch) -> None:
    from assessment_root import boundary as root_boundary

    api = _Api()
    captured: dict[str, Any] = {}

    def scan(claim: dict[str, Any], context: dict[str, Any], *, discovery_sink: Any) -> None:
        captured.update({"claim": claim, "context": context})
        discovery_sink({"discoveryVersion": "LCSP_DISCOVERY_V1", "sourceRanges": []})

    monkeypatch.setattr(root_boundary, "sandbox_backend_factory", scan)
    assert _boundary(api).handle(_message(), "corr") == {"state": "COMPLETED", "runId": RUN}
    assert captured["context"]["repositoryCommit"] == "a" * 40
    assert captured["context"]["sourcePathPrefix"] == "apps/api"
    assert len(api.requests) == 2
    assert api.requests[1][1]["leaseToken"] == LEASE
    assert api.requests[1][1]["discovery"]["sourceRanges"] == []


def test_completed_redelivery_skips_scanner(monkeypatch: pytest.MonkeyPatch) -> None:
    from assessment_root import boundary as root_boundary

    def never_scan(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("completed scan must never run again")

    monkeypatch.setattr(root_boundary, "sandbox_backend_factory", never_scan)
    api = _Api(completed=True)
    assert _boundary(api).handle(_message(), "corr")["state"] == "SKIPPED"
    assert len(api.requests) == 1


def test_scanner_crash_records_failure_without_empty_success(monkeypatch: pytest.MonkeyPatch) -> None:
    from assessment_root import boundary as root_boundary

    def crash(*args: Any, **kwargs: Any) -> None:
        raise ValueError("untrusted repository fixture failed")

    monkeypatch.setattr(root_boundary, "sandbox_backend_factory", crash)
    api = _Api()
    result = _boundary(api).handle(_message(), "corr")
    assert result == {"state": "FAILED", "reason": "ValueError"}
    assert api.requests[-1][0].endswith("/fail")
    assert api.requests[-1][1] == {"leaseToken": LEASE, "errorCode": "DISCOVERY_SCAN_FAILED"}


def test_completion_transport_failure_retains_retry_authority(monkeypatch: pytest.MonkeyPatch) -> None:
    from assessment_root import boundary as root_boundary

    def scan(claim: dict[str, Any], context: dict[str, Any], *, discovery_sink: Any) -> None:
        discovery_sink({"discoveryVersion": "LCSP_DISCOVERY_V1"})

    monkeypatch.setattr(root_boundary, "sandbox_backend_factory", scan)
    api = _Api()
    api.complete_error = WorkerCallbackError("transport")
    with pytest.raises(RetryableAgentBoundaryError):
        _boundary(api).handle(_message(), "corr")
    assert not any(path.endswith("/fail") for path, _ in api.requests)


def test_invalid_command_never_claims_worker_lease() -> None:
    api = _Api()
    with pytest.raises(NonRetryableAgentBoundaryError):
        _boundary(api).handle({"assessmentId": ASSESSMENT, "runId": "../bad"}, "corr")
    assert not api.requests

def test_active_discovery_lease_preserves_durable_retry() -> None:
    api = _Api()
    def held(path: str, payload: dict[str, Any], *, redact: bool) -> dict[str, Any]:
        raise WorkerCallbackError(
            "execution lease held",
            status_code=409,
            error_code="ASSESSMENT_EXECUTION_LEASE_HELD",
        )
    api._post_with_retry = held  # type: ignore[method-assign]
    with pytest.raises(RetryableAgentBoundaryError):
        _boundary(api).handle(_message(), "corr")
    assert sum(AssessmentDiscoveryBoundary.retry_delays_seconds) > 30 * 60


def test_permanent_discovery_result_rejection_settles_run_as_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from assessment_root import boundary as root_boundary

    def scan(claim: dict[str, Any], context: dict[str, Any], *, discovery_sink: Any) -> None:
        discovery_sink({"discoveryVersion": "LCSP_DISCOVERY_V1"})

    monkeypatch.setattr(root_boundary, "sandbox_backend_factory", scan)
    api = _Api()
    api.complete_error = WorkerCallbackError(
        "invalid discovery source",
        status_code=422,
        error_code="ASSESSMENT_PROVENANCE_INTEGRITY_MISMATCH",
    )
    with pytest.raises(NonRetryableAgentBoundaryError):
        _boundary(api).handle(_message(), "corr")
    assert api.requests[-1][0].endswith("/fail")
    assert api.requests[-1][1] == {
        "leaseToken": LEASE,
        "errorCode": "DISCOVERY_COMPLETION_REJECTED",
    }
