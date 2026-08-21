"""Consume legal catalog check-update commands and trigger partial updates if changes are detected."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from structlog import get_logger

from lcsp_workers.agentic_evidence.dispatcher import LegalToolDispatcher
from lcsp_workers.agentic_evidence.legal_tool_entrypoints import (
    LegalToolExecutionContext,
)
from lcsp_workers.legal.partial_update_context_builder import build_partial_update_context
from lcsp_workers.platform.api_client import WorkerApiClient
from lcsp_workers.platform.queue_consumer import ConsumerBase, NonRetryableWorkerError

logger = get_logger(__name__)

LEGAL_CHANGE_DETECTOR_COMMAND = "cron.legal-catalog.check-updates.v1"
LEGAL_CHANGE_DETECTOR_QUEUE = "lcsp.legal-change-detector.v1"
PARTIAL_UPDATE_EXCHANGE = "lcsp.legal-partial-updates"


@dataclass(frozen=True)
class CheckUpdatesEnvelope:
    """Validated command fields needed to check updates for a document."""
    
    document_id: str
    catalog_source_ref: str
    source_url: str
    base_snapshot_ref: str
    admin_catalog_version: str
    idempotency_key: str
    actor_ref: str
    expected_document_number: str
    gateway_document_id: str | None
    max_bytes: int


class LegalChangeDetectorConsumer(ConsumerBase):
    """Detect changes in legal sources and emit partial update context if needed."""

    queue_name = LEGAL_CHANGE_DETECTOR_QUEUE
    routing_key = LEGAL_CHANGE_DETECTOR_COMMAND
    requires_pbac = False
    retry_delays_seconds = (30, 120, 600)

    def __init__(
        self,
        config,
        pbac_client=None,
        api_client: WorkerApiClient | None = None,
        snapshot_fetcher=None,
    ) -> None:
        super().__init__(config, pbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._snapshot_fetcher = snapshot_fetcher

    def handle(self, message: dict[str, Any], correlationId: str) -> None:
        envelope = self._read_envelope(message)

        with TemporaryDirectory(prefix="lcsp-legal-update-") as temp_dir:
            temp_root = Path(temp_dir)
            dispatcher = LegalToolDispatcher(
                LegalToolExecutionContext(
                    api_client=self._api_client,
                    storage_root=temp_root,
                    snapshot_fetcher=self._snapshot_fetcher,
                )
            )

            # 1. Fetch new snapshot (similar to ingestion)
            logger.info("FETCHING_NEW_SNAPSHOT_FOR_UPDATE_CHECK", document_id=envelope.document_id)
            result = dispatcher.dispatch(
                "fetch_official_source_snapshot",
                document_id=envelope.document_id,
                catalog_source_ref=envelope.catalog_source_ref,
                source_url=envelope.source_url,
                output_dir=temp_root,
                max_bytes=envelope.max_bytes,
                gateway_document_id=envelope.gateway_document_id,
                source_effect_status=None,
                expected_document_number=envelope.expected_document_number,
            )
            
            # Note: result contains paths to the downloaded artifacts in temp_root.
            # We assume it provides access to the HTML path.
            # We would also need to fetch the old HTML.
            
            # Fetch old HTML content (Placeholder logic, adapt to actual API client capabilities)
            # old_html = self._api_client.get_snapshot_content(envelope.base_snapshot_ref)
            old_html = "<html>...OLD HTML PLACEHOLDER...</html>" 
            
            # Get new HTML content from fetched result
            html_path = next(temp_root.glob("*.html"), None)
            if not html_path:
                raise NonRetryableWorkerError("Failed to fetch new HTML for comparison")
            new_html = html_path.read_text(encoding="utf-8")
            
            # 2. Build Partial Update Context
            context = build_partial_update_context(
                document_id=envelope.document_id,
                source_url=envelope.source_url,
                base_snapshot_ref=envelope.base_snapshot_ref,
                new_snapshot_ref="PENDING_NEW_SNAPSHOT_REF", # Would be assigned upon registration
                old_html=old_html,
                new_html=new_html,
            )

            if context:
                # 3. Register new snapshot if there are changes
                registered = result.register_with_api(
                    api_client=self._api_client,
                    admin_catalog_version=envelope.admin_catalog_version,
                    catalog_source_ref=envelope.catalog_source_ref,
                    expected_document_number=envelope.expected_document_number,
                )
                
                # Replace pending ref with actual registered ref
                final_context = build_partial_update_context(
                    document_id=envelope.document_id,
                    source_url=envelope.source_url,
                    base_snapshot_ref=envelope.base_snapshot_ref,
                    new_snapshot_ref=registered.get("snapshotRef", "UNKNOWN"),
                    old_html=old_html,
                    new_html=new_html,
                )

                if final_context:
                    # 4. Publish partial update context to next queue for Engineer AI
                    self._publish_partial_update(final_context.to_dict(), correlationId)

                logger.info(
                    "LEGAL_CHANGE_DETECTED",
                    document_id=envelope.document_id,
                    correlationId=correlationId,
                )
            else:
                logger.info(
                    "NO_LEGAL_CHANGE_DETECTED",
                    document_id=envelope.document_id,
                    correlationId=correlationId,
                )

    def _publish_partial_update(self, payload: dict[str, Any], correlationId: str) -> None:
        """Publish the partial update context to the exchange."""
        # Assuming the base class or channel has publish mechanism.
        # This is a generic representation.
        logger.info(
            "PUBLISHING_PARTIAL_UPDATE_CONTEXT",
            document_id=payload.get("documentId"),
            correlationId=correlationId,
        )
        if hasattr(self, "channel") and self.channel:
            self.channel.basic_publish(
                exchange=PARTIAL_UPDATE_EXCHANGE,
                routing_key="event.legal-catalog.partial-update.v1",
                body=json.dumps(payload, ensure_ascii=False).encode("utf-8")
            )

    def _read_envelope(self, message: dict[str, Any]) -> CheckUpdatesEnvelope:
        document_id = str(message.get("documentId") or "")
        if not document_id:
            raise NonRetryableWorkerError("missing documentId")
            
        return CheckUpdatesEnvelope(
            document_id=document_id,
            catalog_source_ref=str(message.get("catalogSourceRef") or ""),
            source_url=str(message.get("sourceUrl") or ""),
            base_snapshot_ref=str(message.get("baseSnapshotRef") or ""),
            admin_catalog_version=str(message.get("adminCatalogVersion") or ""),
            idempotency_key=str(message.get("idempotencyKey") or ""),
            actor_ref=str(message.get("actorRef") or ""),
            expected_document_number=str(message.get("expectedDocumentNumber") or ""),
            gateway_document_id=message.get("gatewayDocumentId"),
            max_bytes=int(message.get("maxBytes") or 50_000_000),
        )
