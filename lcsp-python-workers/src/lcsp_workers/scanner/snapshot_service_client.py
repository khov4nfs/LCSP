from __future__ import annotations

import time
from dataclasses import dataclass
from http import HTTPStatus
from typing import Callable

import httpx

DEFAULT_RATE_LIMIT_RETRY_DELAYS_SECONDS = (30.0, 60.0, 120.0)
MAX_RATE_LIMIT_RETRY_DELAY_SECONDS = 120.0


@dataclass(frozen=True)
class SnapshotArchiveRequest:
    """Identifies the immutable repository snapshot archive required by a scan."""

    snapshot_id: str
    scan_job_id: str
    correlationId: str


class SnapshotServiceClient:
    """Downloads pinned repository archives from the internal NestJS worker API."""

    def __init__(
        self,
        base_url: str,
        worker_api_key: str,
        *,
        retry_delays_seconds: tuple[float, ...] = DEFAULT_RATE_LIMIT_RETRY_DELAYS_SECONDS,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        """Initialize the internal snapshot client.

        Args:
            base_url: Base URL of the NestJS API that owns repository snapshots.
            worker_api_key: Internal worker credential sent with archive requests.
            retry_delays_seconds: Bounded delays applied only to HTTP 429 responses.
            sleeper: Delay function, injectable for deterministic tests.
        """
        self._base_url = base_url.rstrip("/")
        self._worker_api_key = worker_api_key
        self._retry_delays_seconds = retry_delays_seconds
        self._sleeper = sleeper

    def download_snapshot_archive(self, request: SnapshotArchiveRequest) -> bytes:
        """Download the exact archive pinned to a scan job.

        The scan job identifier is sent back to the API so the server can enforce
        that workers only read the snapshot authorized for that scan. GitHub rate
        limiting is surfaced by the API as HTTP 429 and retried with bounded backoff
        instead of exhausting the broker retry budget immediately.

        Args:
            request: Snapshot, scan-job, and correlation identifiers for the read.

        Returns:
            Raw archive bytes returned by the internal snapshot endpoint.

        Raises:
            httpx.HTTPStatusError: If the API rejects or cannot serve the archive after
                bounded rate-limit retries.
        """
        for retry_index in range(len(self._retry_delays_seconds) + 1):
            response = httpx.get(
                f"{self._base_url}/internal/repository-snapshots/{request.snapshot_id}/archive",
                params={"scanJobId": request.scan_job_id},
                headers={
                    "X-Worker-Api-Key": self._worker_api_key,
                    "X-Correlation-Id": request.correlationId,
                },
                timeout=30.0,
            )

            if response.status_code != HTTPStatus.TOO_MANY_REQUESTS:
                response.raise_for_status()
                return response.content

            if retry_index >= len(self._retry_delays_seconds):
                response.raise_for_status()

            fallback_delay = self._retry_delays_seconds[retry_index]
            self._sleeper(_rate_limit_retry_delay(response, fallback_delay))

        raise RuntimeError("snapshot rate-limit retry loop exhausted unexpectedly")


def _rate_limit_retry_delay(response: httpx.Response, fallback_delay: float) -> float:
    """Prefer a bounded Retry-After value and otherwise use the configured fallback."""
    raw_retry_after = response.headers.get("retry-after")
    if raw_retry_after:
        try:
            retry_after = float(raw_retry_after)
        except ValueError:
            retry_after = fallback_delay
        if retry_after >= 0:
            return min(retry_after, MAX_RATE_LIMIT_RETRY_DELAY_SECONDS)
    return fallback_delay
