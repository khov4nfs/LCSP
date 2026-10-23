"""Worker HTTP adapter for the document ingestion hand-off (``/internal/legal-sources/documents``).

Chunk text is sent exactly as extracted: the generic callback client redacts payloads, which would
change legal text and break the chunk hashes the API verifies.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

import httpx

WORKER_KEY_HEADER = "x-worker-api-key"
CORRELATION_HEADER = "x-correlation-id"


class IngestionApiError(Exception):
    def __init__(self, status: int, code: str) -> None:
        super().__init__(f"{code} ({status})")
        self.status = status
        self.code = code

    @property
    def retryable(self) -> bool:
        return self.status >= 500 or self.status == 429


@dataclass(frozen=True)
class StoredOriginal:
    data: bytes
    media_type: str
    structure_profile: str


class DocumentIngestionClient:
    def __init__(self, base_url: str, worker_key: str, *, timeout: float = 120.0) -> None:
        self._base = f"{base_url.rstrip('/')}/internal/legal-sources/documents"
        self._worker_key = worker_key
        self._timeout = timeout

    def _headers(self) -> dict[str, str]:
        return {WORKER_KEY_HEADER: self._worker_key, CORRELATION_HEADER: str(uuid.uuid4())}

    @staticmethod
    def _problem_code(response: httpx.Response) -> str:
        try:
            payload = response.json()
            return str(payload.get("problem", {}).get("code") or f"HTTP_{response.status_code}")
        except (ValueError, AttributeError):
            return f"HTTP_{response.status_code}"

    def fetch_original(self, document_row_id: str, attempt: int) -> StoredOriginal:
        response = httpx.get(
            f"{self._base}/{document_row_id}/original",
            params={"attempt": str(attempt)},
            headers=self._headers(),
            timeout=self._timeout,
        )
        if response.status_code >= 400:
            raise IngestionApiError(response.status_code, self._problem_code(response))
        return StoredOriginal(
            data=response.content,
            media_type=response.headers.get("content-type", "").split(";")[0].strip().lower(),
            structure_profile=response.headers.get("x-lcsp-structure-profile", "AUTO"),
        )

    def post_result(self, document_row_id: str, result: dict[str, Any]) -> dict[str, Any]:
        response = httpx.post(
            f"{self._base}/{document_row_id}/ingestion-result",
            json=result,
            headers=self._headers(),
            timeout=self._timeout,
        )
        if response.status_code >= 400:
            raise IngestionApiError(response.status_code, self._problem_code(response))
        payload = response.json()
        return payload.get("data", {}) if isinstance(payload, dict) else {}
