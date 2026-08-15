from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from structlog import get_logger

from lcsp_workers.platform.queue_consumer import ConsumerBase, NonRetryableWorkerError

from .chunk_integrity_repository import ChunkIntegrityRepository
from .legal_chunk_repository import LegalChunkRepository
from .legal_retrieval_index_builder import (
    BuildLegalRetrievalIndexRequest,
    LegalRetrievalIndexBuilder,
)
from .legal_retrieval_index_repository import LegalRetrievalIndexRepository

logger = get_logger(__name__)

LEGAL_RETRIEVAL_INDEX_COMMAND = "command.legal-index-build.requested.v1"
LEGAL_RETRIEVAL_INDEX_QUEUE = "lcsp.legal-index-build.v1"


@dataclass(frozen=True)
class LegalRetrievalIndexEnvelope:
    chunk_set_ref: str
    integrity_manifest_ref: str
    index_profile: str


class LegalRetrievalIndexConsumer(ConsumerBase):
    queue_name = LEGAL_RETRIEVAL_INDEX_QUEUE
    routing_key = LEGAL_RETRIEVAL_INDEX_COMMAND
    requires_pbac = False
    retry_delays_seconds = ()

    def handle(self, message: dict[str, Any], correlationId: str) -> None:
        envelope = self._read_envelope(message)
        storage_root = self._storage_root()
        builder = LegalRetrievalIndexBuilder(
            storage_root=storage_root,
            chunk_repository=LegalChunkRepository(storage_root=storage_root),
            integrity_repository=ChunkIntegrityRepository(storage_root=storage_root),
        )
        try:
            result = builder.build(
                BuildLegalRetrievalIndexRequest(
                    chunk_set_ref=envelope.chunk_set_ref,
                    integrity_manifest_ref=envelope.integrity_manifest_ref,
                    index_profile=envelope.index_profile,
                )
            )
        except (ValueError, RuntimeError, OSError) as exc:
            raise NonRetryableWorkerError(str(exc)) from exc
        LegalRetrievalIndexRepository(storage_root=storage_root).save(result.to_record())
        logger.info(
            "LEGAL_RETRIEVAL_INDEX_BUILT",
            chunk_set_ref=envelope.chunk_set_ref,
            index_ref=result.index_ref,
            correlationId=correlationId,
        )

    def _storage_root(self) -> Path:
        root = getattr(self._config, "legal_source_storage_root", None)
        if not isinstance(root, str) or not root.strip():
            raise NonRetryableWorkerError("LEGAL_SOURCE_STORAGE_ROOT is not configured")
        return Path(root).resolve()

    def _read_envelope(self, message: dict[str, Any]) -> LegalRetrievalIndexEnvelope:
        chunk_set_ref = self._read_required_string(message, "chunkSetRef", "chunk_set_ref")
        integrity_manifest_ref = self._read_required_string(
            message, "integrityManifestRef", "integrity_manifest_ref"
        )
        index_profile = self._read_required_string(message, "indexProfile", "index_profile")
        return LegalRetrievalIndexEnvelope(
            chunk_set_ref=chunk_set_ref,
            integrity_manifest_ref=integrity_manifest_ref,
            index_profile=index_profile,
        )

    @staticmethod
    def _read_required_string(container: dict[str, Any], *keys: str) -> str:
        for key in keys:
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        raise NonRetryableWorkerError(f"missing required field: {keys[0]}")
