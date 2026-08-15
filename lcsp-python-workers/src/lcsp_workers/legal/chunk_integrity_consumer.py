from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from structlog import get_logger

from lcsp_workers.agentic_evidence.dispatcher import LegalToolDispatcher
from lcsp_workers.agentic_evidence.legal_tool_entrypoints import (
    LegalToolExecutionContext,
)
from lcsp_workers.platform.queue_consumer import ConsumerBase, NonRetryableWorkerError

from .chunk_integrity_repository import ChunkIntegrityRepository

logger = get_logger(__name__)

CHUNK_INTEGRITY_COMMAND = "command.legal-source.chunk-integrity.requested.v1"
CHUNK_INTEGRITY_QUEUE = "lcsp.legal-source-chunk-integrity.v1"


@dataclass(frozen=True)
class ChunkIntegrityEnvelope:
    chunk_set_ref: str
    relationship_manifest_ref: str
    validation_profile: str


class ChunkIntegrityConsumer(ConsumerBase):
    queue_name = CHUNK_INTEGRITY_QUEUE
    routing_key = CHUNK_INTEGRITY_COMMAND
    requires_pbac = False
    retry_delays_seconds = ()

    def handle(self, message: dict[str, Any], correlationId: str) -> None:
        envelope = self._read_envelope(message)
        storage_root = self._storage_root()
        dispatcher = LegalToolDispatcher(
            LegalToolExecutionContext(api_client=None, storage_root=storage_root)
        )
        try:
            result = dispatcher.dispatch(
                "validate_chunk_integrity",
                chunk_set_ref=envelope.chunk_set_ref,
                relationship_manifest_ref=envelope.relationship_manifest_ref,
                validation_profile=envelope.validation_profile,
            )
        except (ValueError, RuntimeError, OSError) as exc:
            raise NonRetryableWorkerError(str(exc)) from exc
        ChunkIntegrityRepository(storage_root=storage_root).save(result.to_record())
        logger.info(
            "CHUNK_INTEGRITY_VALIDATED",
            chunk_set_ref=envelope.chunk_set_ref,
            validation_manifest_ref=result.validation_manifest_ref,
            correlationId=correlationId,
        )

    def _storage_root(self) -> Path:
        root = getattr(self._config, "legal_source_storage_root", None)
        if not isinstance(root, str) or not root.strip():
            raise NonRetryableWorkerError("LEGAL_SOURCE_STORAGE_ROOT is not configured")
        return Path(root).resolve()

    def _read_envelope(self, message: dict[str, Any]) -> ChunkIntegrityEnvelope:
        chunk_set_ref = self._read_required_string(message, "chunkSetRef", "chunk_set_ref")
        relationship_manifest_ref = self._read_required_string(
            message,
            "relationshipManifestRef",
            "relationship_manifest_ref",
        )
        validation_profile = self._read_required_string(
            message, "validationProfile", "validation_profile"
        )
        return ChunkIntegrityEnvelope(
            chunk_set_ref=chunk_set_ref,
            relationship_manifest_ref=relationship_manifest_ref,
            validation_profile=validation_profile,
        )

    @staticmethod
    def _read_required_string(container: dict[str, Any], *keys: str) -> str:
        for key in keys:
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        raise NonRetryableWorkerError(f"missing required field: {keys[0]}")
