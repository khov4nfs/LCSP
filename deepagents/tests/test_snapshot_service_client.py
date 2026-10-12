from unittest.mock import MagicMock, patch

from tools.common.capabilities.platform.repository_snapshot_client import (
    RepositoryArchiveRequest,
    RepositorySnapshotClient,
)


def test_download_archive_uses_worker_api_key_header():
    response = MagicMock()
    response.status_code = 200
    response.content = b"archive"
    request = RepositoryArchiveRequest(
        snapshot_id="snapshot-1",
        scan_job_id="scan-job-1",
        correlation_id="corr-1",
    )

    with patch(
        "tools.common.capabilities.platform.repository_snapshot_client.httpx.get",
        return_value=response,
    ) as http_get:
        archive = RepositorySnapshotClient("http://api", "worker-key").download_archive(
            request
        )

    assert archive == b"archive"
    http_get.assert_called_once_with(
        "http://api/internal/repository-snapshots/snapshot-1/archive",
        params={"scanJobId": "scan-job-1"},
        headers={
            "X-Worker-Api-Key": "worker-key",
            "X-Correlation-Id": "corr-1",
        },
        timeout=30.0,
    )
    response.raise_for_status.assert_called_once()


def test_download_archive_retries_429_with_bounded_backoff():
    rate_limited = MagicMock()
    rate_limited.status_code = 429
    rate_limited.headers = {"retry-after": "2"}

    success = MagicMock()
    success.status_code = 200
    success.content = b"archive-after-rate-limit"
    success.headers = {}

    delays: list[float] = []
    request = RepositoryArchiveRequest(
        snapshot_id="snapshot-2",
        scan_job_id="scan-job-2",
        correlation_id="corr-2",
    )
    client = RepositorySnapshotClient(
        "http://api",
        "worker-key",
        retry_delays_seconds=(30.0,),
        sleeper=delays.append,
    )

    with patch(
        "tools.common.capabilities.platform.repository_snapshot_client.httpx.get",
        side_effect=[rate_limited, success],
    ) as http_get:
        archive = client.download_archive(request)

    assert archive == b"archive-after-rate-limit"
    assert delays == [2.0]
    assert http_get.call_count == 2
    rate_limited.raise_for_status.assert_not_called()
    success.raise_for_status.assert_called_once()


def test_download_archive_raises_after_rate_limit_retry_budget():
    responses = []
    for _ in range(2):
        response = MagicMock()
        response.status_code = 429
        response.headers = {}
        responses.append(response)

    delays: list[float] = []
    request = RepositoryArchiveRequest(
        snapshot_id="snapshot-3",
        scan_job_id="scan-job-3",
        correlation_id="corr-3",
    )
    client = RepositorySnapshotClient(
        "http://api",
        "worker-key",
        retry_delays_seconds=(0.0,),
        sleeper=delays.append,
    )

    with patch(
        "tools.common.capabilities.platform.repository_snapshot_client.httpx.get",
        side_effect=responses,
    ):
        try:
            client.download_archive(request)
        except Exception:
            pass
        else:
            raise AssertionError("expected exhausted 429 response to raise")

    assert delays == [0.0]
    responses[0].raise_for_status.assert_not_called()
    responses[1].raise_for_status.assert_called_once()
