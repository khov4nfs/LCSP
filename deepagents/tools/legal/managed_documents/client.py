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
        """Business purpose: Classify whether the worker should retry an API-rejected document ingestion request.

        Business rules:
        - HTTP 5xx and 429 responses are retryable; other response statuses are not retried by this client classification.

        Execution flow:
        1. Compare the stored HTTP status with the server-error range and Too Many Requests status.
        2. Return true for either retryable category and false otherwise.

        Failure cases:
        - No exception is raised; unknown status values follow the same numeric comparison.

        Side effects:
        - None: the property reads the exception's stored status only.
        """
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
        """Business purpose: Attach the worker credential and a fresh correlation identifier to one ingestion API request.

        Business rules:
        - The configured worker key is used only in the worker API header.
        - Each request receives its own generated correlation identifier.

        Execution flow:
        1. Generate a UUID correlation value.
        2. Return both required request headers.

        Failure cases:
        - UUID-generation errors propagate; no credential fallback is used.

        Side effects:
        - Generates an in-memory correlation identifier; it does not send the request or log the credential.
        """
        return {WORKER_KEY_HEADER: self._worker_key, CORRELATION_HEADER: str(uuid.uuid4())}

    @staticmethod
    def _problem_code(response: httpx.Response) -> str:
        """Business purpose: Extract a stable error code from an ingestion API problem response for retry and settlement decisions.

        Business rules:
        - A nested problem code is preferred; malformed or non-envelope JSON falls back to `HTTP_<status>`.
        - Only the code is returned, not the problem payload or document content.

        Execution flow:
        1. Parse the response JSON and inspect `problem.code`.
        2. Return the nested code when present, otherwise return the status-based fallback.

        Failure cases:
        - Invalid JSON or unsupported response shape returns the HTTP fallback rather than hiding the status.

        Side effects:
        - None: the response is read in memory and no response or client state is modified.
        """
        try:
            payload = response.json()
            return str(payload.get("problem", {}).get("code") or f"HTTP_{response.status_code}")
        except (ValueError, AttributeError):
            return f"HTTP_{response.status_code}"

    def fetch_original(self, document_row_id: str, attempt: int) -> StoredOriginal:
        """Business purpose: Retrieve the server-owned original document bytes and ingestion profile for one authorized attempt.

        Business rules:
        - The request is scoped to the document row and attempt and carries the worker key plus a new correlation identifier.
        - The server remains authoritative for whether the row is still eligible for this ingestion attempt.
        - Media type parameters are removed and the missing structure-profile header defaults to AUTO.

        Execution flow:
        1. GET the document's original endpoint with the attempt query parameter.
        2. Convert HTTP error responses into IngestionApiError with the extracted problem code.
        3. Return the response bytes, normalized media type, and structure profile.

        Failure cases:
        - HTTP errors raise IngestionApiError for boundary retry/settlement handling; network and timeout errors propagate from httpx.

        Side effects:
        - Performs one outbound authenticated API request and returns the original bytes in memory; it does not persist or transform them.
        """
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
        """Business purpose: Submit one extracted ingestion outcome so the API can validate and settle the managed document attempt.

        Business rules:
        - The result is posted against the server-owned document row; the API validates source hashes, chunks, and attempt eligibility.
        - A successful standard result envelope returns its `data` object; a non-dictionary response or missing data becomes an empty mapping.

        Execution flow:
        1. POST the supplied result as JSON with worker and correlation headers.
        2. Raise IngestionApiError for HTTP error responses, preserving the API problem code.
        3. Parse the response envelope and return its data only when the top-level payload is a dictionary.

        Failure cases:
        - HTTP errors raise IngestionApiError; network, timeout, and invalid-success-JSON errors propagate from httpx.
        - Unexpected successful response shapes return an empty mapping rather than claiming a result was applied.

        Side effects:
        - Performs one outbound authenticated POST that may persist or reject the ingestion result through the API.
        """
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
