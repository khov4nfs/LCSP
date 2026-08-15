from __future__ import annotations

from dataclasses import dataclass

import httpx


@dataclass(frozen=True)
class SnapshotArchiveRequest:
    """Identifies the immutable repository snapshot archive required by a scan."""

    snapshot_id: str
    scan_job_id: str
    correlationId: str


class SnapshotServiceClient:
    """Downloads pinned repository archives from the internal NestJS worker API."""

    def __init__(self, base_url: str, worker_api_key: str) -> None:
        """Initialize the internal snapshot client.

        Args:
            base_url: Base URL of the NestJS API that owns repository snapshots.
            worker_api_key: Internal worker credential sent with archive requests.
        """
        self._base_url = base_url.rstrip("/")
        self._worker_api_key = worker_api_key

    def download_snapshot_archive(self, request: SnapshotArchiveRequest) -> bytes:
        """Download the exact archive pinned to a scan job.

        The scan job identifier is sent back to the API so the server can enforce
        that workers only read the snapshot authorized for that scan.

        Args:
            request: Snapshot, scan-job, and correlation identifiers for the read.

        Returns:
            Raw archive bytes returned by the internal snapshot endpoint.

        Raises:
            httpx.HTTPStatusError: If the API rejects or cannot serve the archive.
        """
        response = httpx.get(
            f"{self._base_url}/internal/repository-snapshots/{request.snapshot_id}/archive",
            params={"scanJobId": request.scan_job_id},
            headers={
                "X-Worker-Api-Key": self._worker_api_key,
                "X-Correlation-Id": request.correlationId,
            },
            timeout=30.0,
        )
        response.raise_for_status()
        return response.content
