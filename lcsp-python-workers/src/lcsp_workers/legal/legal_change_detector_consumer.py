"""Consume legal catalog check-update commands and trigger partial updates if changes are detected."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
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
        storage_root = self._storage_root()
        output_dir = self._source_output_dir(storage_root=storage_root, envelope=envelope)
        dispatcher = LegalToolDispatcher(
            LegalToolExecutionContext(
                api_client=self._api_client,
                storage_root=storage_root,
                snapshot_fetcher=self._snapshot_fetcher,
            )
        )

        # 1. Fetch new snapshot (similar to ingestion)
        logger.info(
            "FETCHING_NEW_SNAPSHOT_FOR_UPDATE_CHECK",
            document_id=envelope.document_id,
            output_dir=str(output_dir),
        )
        result = dispatcher.dispatch(
            "fetch_official_source_snapshot",
            document_id=envelope.document_id,
            catalog_source_ref=envelope.catalog_source_ref,
            source_url=envelope.source_url,
            output_dir=output_dir,
            max_bytes=envelope.max_bytes,
            gateway_document_id=envelope.gateway_document_id,
            source_effect_status=None,
            expected_document_number=envelope.expected_document_number,
        )
        old_html = self._read_base_snapshot_html(
            storage_root=storage_root,
            snapshot_ref=envelope.base_snapshot_ref,
        )

        html_path = next(output_dir.glob("*.html"), None)
        if not html_path:
            raise NonRetryableWorkerError("Failed to fetch new HTML for comparison")
        new_html = html_path.read_text(encoding="utf-8")

        context = build_partial_update_context(
            document_id=envelope.document_id,
            source_url=envelope.source_url,
            base_snapshot_ref=envelope.base_snapshot_ref,
            new_snapshot_ref="PENDING_NEW_SNAPSHOT_REF",
            old_html=old_html,
            new_html=new_html,
        )

        if context:
            registered = result.register_with_api(
                api_client=self._api_client,
                admin_catalog_version=envelope.admin_catalog_version,
                catalog_source_ref=envelope.catalog_source_ref,
                expected_document_number=envelope.expected_document_number,
            )

            final_context = build_partial_update_context(
                document_id=envelope.document_id,
                source_url=envelope.source_url,
                base_snapshot_ref=envelope.base_snapshot_ref,
                new_snapshot_ref=registered.get("snapshotRef", "UNKNOWN"),
                old_html=old_html,
                new_html=new_html,
            )

            if final_context:
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

    def _storage_root(self) -> Path:
        """Resolve the runtime legal corpus artifact root or fail terminally."""
        root = getattr(self._config, "legal_source_storage_root", None)
        if not isinstance(root, str) or not root.strip():
            raise NonRetryableWorkerError("LEGAL_SOURCE_STORAGE_ROOT is not configured")
        return Path(root).resolve()

    def _source_output_dir(
        self,
        *,
        storage_root: Path,
        envelope: CheckUpdatesEnvelope,
    ) -> Path:
        """Build the cron crawl artifact directory under .corpus."""
        return (
            storage_root
            / "source-crawl"
            / "cron"
            / _safe_path_segment(envelope.document_id)
        )

    def _read_base_snapshot_html(self, *, storage_root: Path, snapshot_ref: str) -> str:
        """Read the prior source snapshot object from the runtime corpus store."""
        if not snapshot_ref.strip():
            raise NonRetryableWorkerError("missing baseSnapshotRef")
        record = self._api_client.get_official_source_snapshot(snapshot_ref=snapshot_ref)
        object_key = record.get("snapshotObjectKey") or record.get("snapshot_object_key")
        if not isinstance(object_key, str) or not object_key.strip():
            raise NonRetryableWorkerError("base snapshot object key is unavailable")
        object_path = (storage_root / object_key).resolve()
        try:
            object_path.relative_to(storage_root.resolve())
        except ValueError as exc:
            raise NonRetryableWorkerError("base snapshot object key escapes storage root") from exc
        if not object_path.is_file():
            raise NonRetryableWorkerError(
                f"base snapshot object is missing from corpus store: {object_key}"
            )
        return object_path.read_text(encoding="utf-8")


def _safe_path_segment(value: str) -> str:
    """Normalize a runtime identifier for a bounded artifact directory segment."""
    return "".join(ch if ch.isalnum() or ch in "._:-" else "-" for ch in value)[:160]
