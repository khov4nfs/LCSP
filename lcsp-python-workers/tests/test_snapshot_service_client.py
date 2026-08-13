from unittest.mock import MagicMock, patch

from lcsp_workers.scanner.snapshot_service_client import (
    SnapshotArchiveRequest,
    SnapshotServiceClient,
)


def test_download_snapshot_archive_uses_worker_api_key_header():
    response = MagicMock()
    response.content = b"archive"
    request = SnapshotArchiveRequest(
        snapshot_id="snapshot-1",
        scan_job_id="scan-job-1",
        correlationId="corr-1",
    )

    with patch(
        "lcsp_workers.scanner.snapshot_service_client.httpx.get",
        return_value=response,
    ) as http_get:
        archive = SnapshotServiceClient("http://api", "worker-key").download_snapshot_archive(
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
