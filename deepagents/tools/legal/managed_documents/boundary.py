"""Consume ``command.legal-source.document-ingest.requested.v1`` and ingest one managed document."""

from __future__ import annotations

import re
from typing import Any

from structlog import get_logger

from tools.common.capabilities.agent_runtime.boundary import (
    AgentBoundaryBase,
    NonRetryableAgentBoundaryError,
)
from tools.legal.managed_documents.client import DocumentIngestionClient, IngestionApiError
from tools.legal.managed_documents.ingest import FAILURE_EXTRACTION, failed, ingest_document

logger = get_logger(__name__)

LEGAL_SOURCE_DOCUMENT_INGEST_COMMAND = "command.legal-source.document-ingest.requested.v1"
LEGAL_SOURCE_DOCUMENT_INGEST_SOURCE = "legal.managed-document-ingest"
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
# The API answers these for a stale or already settled delivery; there is nothing left to do.
_SETTLED = {"LEGAL_SOURCE_DOCUMENT_NOT_RETRYABLE", "LEGAL_SOURCE_DOCUMENT_NOT_FOUND", "LEGAL_SOURCE_VERSION_IMMUTABLE"}


class ManagedDocumentIngestBoundary(AgentBoundaryBase):
    """One queue message ingests one document attempt; the API owns every state change."""

    boundary_source = LEGAL_SOURCE_DOCUMENT_INGEST_SOURCE
    source_event = LEGAL_SOURCE_DOCUMENT_INGEST_COMMAND
    requires_rbac = False
    retry_delays_seconds = (15, 60, 300)

    def __init__(self, config, rbac_client=None, client: Any | None = None) -> None:
        super().__init__(config, rbac_client)
        self._client = client or DocumentIngestionClient(config.nestjs_api_base_url, config.worker_api_key)

    def handle(self, message: dict[str, Any], correlationId: str) -> dict[str, Any]:
        """Business purpose: Process one queued managed-document ingestion attempt through the API-owned result lifecycle.

        Business rules:
        - The command must contain a UUID-shaped document row identifier and a positive integer attempt; booleans are not valid attempts.
        - The API owns ingestion state transitions, retry eligibility, and whether a posted result is applied.
        - Settled stale deliveries are skipped, transient API errors are retried by the boundary, and permanent API/content refusals are not retried as the same payload.
        - A parser crash is converted to an explicit extraction failure so the API can settle that document attempt.

        Execution flow:
        1. Validate document and attempt identity before making any API request.
        2. Fetch the original bytes and profile, applying settled/retryable/permanent API error handling.
        3. Ingest the document; convert unexpected parser errors to the standard extraction failure result.
        4. Post the ingestion result, skip settled deliveries, and submit a failed result if the API rejects the content itself.
        5. Log and return the original extraction result's state with the last API response's applied flag; after a fallback FAILED post these fields can describe different payloads.

        Failure cases:
        - Invalid command fields raise NonRetryableAgentBoundaryError.
        - Retryable API errors propagate for broker retry; permanent fetch errors become nonretryable boundary errors.
        - If the fallback failed-result post also fails, its API error propagates rather than claiming the attempt was settled.

        Side effects:
        - Fetches original document bytes and posts an ingestion result through the worker API, may invoke local extraction/chunking, and emits structured logs; it does not mutate lifecycle state locally.
        """
        document_row_id = message.get("documentRowId")
        attempt = message.get("attempt")
        if not isinstance(document_row_id, str) or not _UUID.match(document_row_id):
            raise NonRetryableAgentBoundaryError("document ingest command has no valid documentRowId")
        if not isinstance(attempt, int) or isinstance(attempt, bool) or attempt < 1:
            raise NonRetryableAgentBoundaryError("document ingest command has no valid attempt")

        try:
            original = self._client.fetch_original(document_row_id, attempt)
        except IngestionApiError as error:
            if error.code in _SETTLED:
                return {"state": "SKIPPED", "reason": error.code}
            if error.retryable:
                raise
            raise NonRetryableAgentBoundaryError(f"document ingest rejected: {error.code}") from error

        try:
            result = ingest_document(
                data=original.data,
                media_type=original.media_type,
                structure_profile=original.structure_profile,
                attempt=attempt,
            )
        except Exception as error:  # noqa: BLE001 - a parser crash must settle as a failed document
            logger.warning("LEGAL_SOURCE_DOCUMENT_INGEST_CRASHED", error_type=type(error).__name__)
            result = failed(attempt, FAILURE_EXTRACTION)

        try:
            outcome = self._client.post_result(document_row_id, result)
        except IngestionApiError as error:
            if error.code in _SETTLED:
                return {"state": "SKIPPED", "reason": error.code}
            if error.retryable:
                raise
            # The API refused the content itself (for example a chunk it cannot verify): record it.
            outcome = self._client.post_result(document_row_id, failed(attempt, FAILURE_EXTRACTION))
        logger.info(
            "LEGAL_SOURCE_DOCUMENT_INGESTED",
            document_row_id=document_row_id,
            attempt=attempt,
            outcome=result["outcome"],
            chunks=len(result.get("chunks", [])),
            applied=outcome.get("applied"),
        )
        return {"state": result["outcome"], "applied": bool(outcome.get("applied"))}
