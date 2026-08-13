from __future__ import annotations

from dataclasses import dataclass

import httpx


@dataclass(frozen=True)
class SnapshotArchiveRequest:
    snapshot_id: str
    scan_job_id: str
    correlationId: str


class SnapshotServiceClient:
    def __init__(self, base_url: str, worker_api_key: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._worker_api_key = worker_api_key

    def download_snapshot_archive(self, request: SnapshotArchiveRequest) -> bytes:
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
