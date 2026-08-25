"""Consume official legal-source ingest commands and register immutable source snapshots."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from structlog import get_logger

from tools.common.capabilities.agentic_evidence.dispatch.dispatcher import LegalToolDispatcher
from tools.common.capabilities.agentic_evidence.entrypoints.legal_tool_entrypoints import (
    LegalToolExecutionContext,
)
from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.managed.boundary import AgentBoundaryBase, NonRetryableAgentBoundaryError

logger = get_logger(__name__)

LEGAL_SOURCE_INGEST_COMMAND = "command.legal-source.ingest.requested.v1"
LEGAL_SOURCE_INGEST_BOUNDARY_SOURCE = "lcsp.legal-source-ingest.v1"


class SnapshotFetcher(Protocol):
    """Abstraction for downloading and validating one official source snapshot."""

    def fetch(self, request: Any):
        """Fetch a snapshot for the supplied official-source request."""
        ...


@dataclass(frozen=True)
class LegalSourceIngestEnvelope:
    """Validated command fields needed to snapshot and register an official source."""

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


class LegalSourceIngestBoundary(AgentBoundaryBase):
    """Fetch an official source into the runtime corpus store and register provenance."""

    boundary_source = LEGAL_SOURCE_INGEST_BOUNDARY_SOURCE
    source_event = LEGAL_SOURCE_INGEST_COMMAND
    requires_pbac = False
    retry_delays_seconds = (30, 120, 600)

    def __init__(
        self,
        config,
        pbac_client=None,
        api_client: WorkerApiClient | None = None,
        snapshot_fetcher: SnapshotFetcher | None = None,
    ) -> None:
        """Create the boundary with injectable API and snapshot-fetching adapters."""
        super().__init__(config, pbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._snapshot_fetcher = snapshot_fetcher

    def handle(self, message: dict[str, Any], correlationId: str) -> None:
        """Validate the command, dispatch snapshot fetch, and register the result.

        Downloaded bytes are stored under the configured runtime corpus store so
        downstream extraction, review, chunking, and recovery steps consume the
        crawl artifacts from one pipeline-owned workspace. The fetch operation is
        forced through the canonical ``fetch_official_source_snapshot`` boundary
        before provenance registration. Fetch/runtime failures remain retryable
        exactly as before this refactor; only deterministic envelope validation
        is terminal.
        """
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
        result = dispatcher.dispatch(
            "fetch_official_source_snapshot",
            document_id=envelope.document_id,
            catalog_source_ref=envelope.catalog_source_ref,
            source_url=envelope.source_url,
            output_dir=output_dir,
            max_bytes=envelope.max_bytes,
            gateway_document_id=envelope.gateway_document_id,
            source_effect_status=envelope.source_effect_status,
            expected_document_number=envelope.expected_document_number,
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
            manifest_path=str(result.manifest_path),
            storage_root=str(storage_root),
            correlationId=correlationId,
        )

    def _storage_root(self) -> Path:
        """Resolve the runtime legal corpus artifact root or fail terminally."""
        root = getattr(self._config, "legal_source_storage_root", None)
        if not isinstance(root, str) or not root.strip():
            raise NonRetryableAgentBoundaryError("LEGAL_SOURCE_STORAGE_ROOT is not configured")
        return Path(root).resolve()

    def _source_output_dir(
        self,
        *,
        storage_root: Path,
        envelope: LegalSourceIngestEnvelope,
    ) -> Path:
        """Build the per-document crawl artifact directory under .corpus."""
        return (
            storage_root
            / "source-crawl"
            / _safe_path_segment(envelope.corpus_version_id)
            / _safe_path_segment(envelope.document_id)
        )

    def _read_envelope(self, message: dict[str, Any]) -> LegalSourceIngestEnvelope:
        """Normalize and validate the system command into a typed ingest envelope."""
        expected_identity = message.get("expectedIdentity")
        if not isinstance(expected_identity, dict):
            raise NonRetryableAgentBoundaryError("legal source ingest expectedIdentity is invalid")

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
            raise NonRetryableAgentBoundaryError("legal source ingest maxBytes is invalid")

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
        """Read the first non-empty string alias or raise a terminal command error."""
        for key in keys:
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        raise NonRetryableAgentBoundaryError(f"missing required field: {keys[0]}")

    @staticmethod
    def _read_optional_string(container: dict[str, Any], *keys: str) -> str | None:
        """Read the first non-empty optional string alias."""
        for key in keys:
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None


def _safe_path_segment(value: str) -> str:
    """Normalize a runtime identifier for a bounded artifact directory segment."""
    return "".join(ch if ch.isalnum() or ch in "._:-" else "-" for ch in value)[:160]
