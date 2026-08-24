"""Worker-authenticated document artifact reads and callbacks."""
from __future__ import annotations

from typing import Any

from tools.common.platform.api_client import WorkerApiClient, WorkerCallbackError


class DocumentRuntimeClient(WorkerApiClient):
    """Thin document-specific adapter over the shared retry/redaction HTTP client."""

    def get_generation_context(self, document_request_id: str) -> dict[str, Any]:
        data = self._get_with_retry(
            f"/internal/document-requests/{document_request_id}/generation-context"
        )
        if not isinstance(data, dict):
            raise WorkerCallbackError("Document generation context response was invalid.")
        return data

    def post_document_callback(
        self,
        document_request_id: str,
        *,
        status: str,
        document_url: str | None = None,
        error_code: str | None = None,
        blocked_reason: str | None = None,
    ) -> dict[str, Any]:
        payload = {
            "document_request_id": document_request_id,
            "status": status,
            "document_url": document_url,
            "error_code": error_code,
            "blocked_reason": blocked_reason,
        }
        data = self._post_with_retry(
            f"/internal/document-requests/{document_request_id}/callback",
            {key: value for key, value in payload.items() if value is not None},
        )
        if not isinstance(data, dict):
            raise WorkerCallbackError("Document callback response was invalid.")
        return data
