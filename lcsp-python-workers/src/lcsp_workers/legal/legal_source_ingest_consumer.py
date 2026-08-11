from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Protocol

from structlog import get_logger

from lcsp_workers.platform.api_client import WorkerApiClient
from lcsp_workers.platform.queue_consumer import ConsumerBase, NonRetryableWorkerError

from .official_source_snapshot import (
    OfficialSourceSnapshotFetcher,
    OfficialSourceSnapshotRequest,
)

logger = get_logger(__name__)

LEGAL_SOURCE_INGEST_COMMAND = "command.legal-source.ingest.requested.v1"
LEGAL_SOURCE_INGEST_QUEUE = "lcsp.legal-source-ingest.v1"


class SnapshotFetcher(Protocol):
    def fetch(
        self, request: OfficialSourceSnapshotRequest
    ): ...


@dataclass(frozen=True)
class LegalSourceIngestEnvelope:
    document_id: str
    catalog_source_ref: str
    admin_catalog_version: str
    corpus_version_id: str
    idempotency_key: str
    actor_ref: str
    source_url: str
    max_bytes: int
    expected_document_number: str
    gateway_document_id: str | None
    source_effect_status: str | None


class LegalSourceIngestConsumer(ConsumerBase):
    queue_name = LEGAL_SOURCE_INGEST_QUEUE
    routing_key = LEGAL_SOURCE_INGEST_COMMAND
    requires_pbac = False
    retry_delays_seconds = (30, 120, 600)

    def __init__(
        self,
        config,
        pbac_client=None,
        api_client: WorkerApiClient | None = None,
        snapshot_fetcher: SnapshotFetcher | None = None,
    ) -> None:
        super().__init__(config, pbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._snapshot_fetcher = snapshot_fetcher or OfficialSourceSnapshotFetcher()

    def handle(self, message: dict[str, Any], correlation_id: str) -> None:
        envelope = self._read_envelope(message)
        with TemporaryDirectory(prefix="lcsp-legal-source-") as temp_dir:
            result = self._snapshot_fetcher.fetch(
                OfficialSourceSnapshotRequest(
                    document_id=envelope.document_id,
                    catalog_source_ref=envelope.catalog_source_ref,
                    source_url=envelope.source_url,
                    output_dir=Path(temp_dir),
                    max_bytes=envelope.max_bytes,
                    gateway_document_id=envelope.gateway_document_id,
                    source_effect_status=envelope.source_effect_status,
                    expected_document_number=envelope.expected_document_number,
                )
            )
            registered = result.register_with_api(
                api_client=self._api_client,
                admin_catalog_version=envelope.admin_catalog_version,
                catalog_source_ref=envelope.catalog_source_ref,
                expected_document_number=envelope.expected_document_number,
            )

        logger.info(
            "LEGAL_SOURCE_SNAPSHOT_REGISTERED",
            document_id=envelope.document_id,
            catalog_source_ref=envelope.catalog_source_ref,
            corpus_version_id=envelope.corpus_version_id,
            idempotency_key=envelope.idempotency_key,
            actor_ref=envelope.actor_ref,
            snapshot_ref=registered.get("snapshotRef"),
            correlation_id=correlation_id,
        )

    def _read_envelope(self, message: dict[str, Any]) -> LegalSourceIngestEnvelope:
        expected_identity = message.get("expectedIdentity")
        if not isinstance(expected_identity, dict):
            raise NonRetryableWorkerError("legal source ingest expectedIdentity is invalid")

        document_id = self._read_required_string(message, "documentId", "document_id")
        catalog_source_ref = self._read_required_string(
            message, "catalogSourceRef", "catalog_source_ref"
        )
        admin_catalog_version = self._read_required_string(
            message, "adminCatalogVersion", "admin_catalog_version"
        )
        corpus_version_id = self._read_required_string(
            message, "corpusVersionId", "corpus_version_id"
        )
        idempotency_key = self._read_required_string(
            message, "idempotencyKey", "idempotency_key"
        )
        actor_ref = self._read_required_string(message, "actorRef", "actor_ref")
        source_url = self._read_required_string(message, "sourceUrl", "source_url")
        expected_document_number = self._read_required_string(
            expected_identity,
            "documentNumber",
            "document_number",
        )
        max_bytes = message.get("maxBytes", message.get("max_bytes"))
        if not isinstance(max_bytes, int) or max_bytes < 1:
            raise NonRetryableWorkerError("legal source ingest maxBytes is invalid")

        gateway_document_id = self._read_optional_string(
            message, "gatewayDocumentId", "gateway_document_id"
        )
        source_effect_status = self._read_optional_string(
            message, "sourceEffectStatus", "source_effect_status"
        )
        return LegalSourceIngestEnvelope(
            document_id=document_id,
            catalog_source_ref=catalog_source_ref,
            admin_catalog_version=admin_catalog_version,
            corpus_version_id=corpus_version_id,
            idempotency_key=idempotency_key,
            actor_ref=actor_ref,
            source_url=source_url,
            max_bytes=max_bytes,
            expected_document_number=expected_document_number,
            gateway_document_id=gateway_document_id,
            source_effect_status=source_effect_status,
        )

    @staticmethod
    def _read_required_string(container: dict[str, Any], *keys: str) -> str:
        for key in keys:
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        raise NonRetryableWorkerError(f"missing required field: {keys[0]}")

    @staticmethod
    def _read_optional_string(container: dict[str, Any], *keys: str) -> str | None:
        for key in keys:
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None
