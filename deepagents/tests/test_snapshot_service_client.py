from unittest.mock import MagicMock, patch

from tools.common.capabilities.platform.repository_snapshot_client import (
    RepositoryArchiveDownload,
    RepositoryArchiveRequest,
    RepositorySnapshotClient,
)


def test_download_archive_uses_worker_api_key_header():
    response = MagicMock()
    response.status_code = 200
    response.content = b"\x1f\x8barchive"
    response.headers = {
        "content-type": "application/gzip",
        "x-repository-archive-root-status": "VERIFIED_ROOTLESS",
    }
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

    assert archive == b"\x1f\x8barchive"
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
    success.content = b"PK\x03\x04archive-after-rate-limit"
    success.headers = {
        "content-type": "application/zip",
        "x-repository-archive-root-status": "VERIFIED_ROOTLESS",
    }

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

    assert archive == b"PK\x03\x04archive-after-rate-limit"
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


def test_download_archive_rejects_content_type_signature_mismatch():
    response = MagicMock()
    response.status_code = 200
    response.content = b"PK\x03\x04zip"
    response.headers = {"content-type": "application/gzip"}
    request = RepositoryArchiveRequest(
        snapshot_id="snapshot-4",
        scan_job_id="scan-job-4",
        correlation_id="corr-4",
    )

    with patch(
        "tools.common.capabilities.platform.repository_snapshot_client.httpx.get",
        return_value=response,
    ):
        try:
            RepositorySnapshotClient("http://api", "worker-key").download_archive(request)
        except RuntimeError as error:
            assert "media type" in str(error)
        else:
            raise AssertionError("contradictory archive metadata must be rejected")


def test_download_archive_preserves_exact_provider_root_metadata():
    response = MagicMock()
    response.status_code = 200
    response.content = b"PK\x03\x04zip-content"
    response.headers = {
        "content-type": "application/zip",
        "x-repository-archive-root": "trusted-provider-root",
        "x-repository-archive-root-status": "VERIFIED_WRAPPER",
    }
    request = RepositoryArchiveRequest(
        snapshot_id="snapshot-root",
        scan_job_id="scan-root",
        correlation_id="corr-root",
    )

    with patch(
        "tools.common.capabilities.platform.repository_snapshot_client.httpx.get",
        return_value=response,
    ):
        archive = RepositorySnapshotClient("http://api", "worker-key").download_archive_with_metadata(request)

    assert archive == RepositoryArchiveDownload(
        content=b"PK\x03\x04zip-content",
        content_type="application/zip",
        archive_root="trusted-provider-root",
        archive_root_status="VERIFIED_WRAPPER",
        tree_manifest=None,
    )


def test_download_archive_preserves_unknown_root_with_pinned_tree_manifest():
    response = MagicMock()
    response.status_code = 200
    response.content = b"PK\x03\x04zip-content"
    response.headers = {
        "content-type": "application/zip",
        "x-commit-sha": "a" * 40,
        "x-repository-archive-root-status": "UNKNOWN",
        "x-repository-tree-manifest-version": "1",
        "x-repository-tree-commit-sha": "a" * 40,
        "x-repository-tree-id": "b" * 40,
        "x-repository-tree-file-count": "2",
        "x-repository-tree-path-sha256": "c" * 64,
    }
    request = RepositoryArchiveRequest(
        snapshot_id="snapshot-tree",
        scan_job_id="scan-tree",
        correlation_id="corr-tree",
    )
    with patch(
        "tools.common.capabilities.platform.repository_snapshot_client.httpx.get",
        return_value=response,
    ):
        archive = RepositorySnapshotClient("http://api", "worker-key").download_archive_with_metadata(request)

    assert archive.archive_root is None
    assert archive.archive_root_status == "UNKNOWN"
    assert archive.tree_manifest is not None
    assert archive.tree_manifest.commit_sha == "a" * 40
    assert archive.tree_manifest.tree_id == "b" * 40
    assert archive.tree_manifest.file_count == 2
    assert archive.tree_manifest.path_sha256 == "c" * 64


def test_download_archive_rejects_ambiguous_root_metadata():
    response = MagicMock()
    response.status_code = 200
    response.content = b"PK\x03\x04zip-content"
    response.headers = {
        "content-type": "application/zip",
        "x-repository-archive-root": "../untrusted",
    }
    request = RepositoryArchiveRequest(
        snapshot_id="snapshot-invalid-root",
        scan_job_id="scan-invalid-root",
        correlation_id="corr-invalid-root",
    )

    with patch(
        "tools.common.capabilities.platform.repository_snapshot_client.httpx.get",
        return_value=response,
    ):
        try:
            RepositorySnapshotClient("http://api", "worker-key").download_archive_with_metadata(request)
        except RuntimeError as error:
            assert "root metadata" in str(error)
        else:
            raise AssertionError("ambiguous wrapper metadata must be rejected")
