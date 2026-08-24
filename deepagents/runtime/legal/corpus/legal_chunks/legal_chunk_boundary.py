from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from structlog import get_logger

from tools.common.agentic_evidence.dispatcher import LegalToolDispatcher
from tools.common.agentic_evidence.legal_tool_entrypoints import (
    LegalToolExecutionContext,
)
from tools.common.managed.boundary import AgentBoundaryBase, NonRetryableAgentBoundaryError

from .legal_chunk_repository import LegalChunkRepository

logger = get_logger(__name__)

LEGAL_CHUNK_COMMAND = "command.legal-source.chunking.requested.v1"
LEGAL_CHUNK_BOUNDARY_SOURCE = "lcsp.legal-source-chunking.v1"


@dataclass(frozen=True)
class LegalChunkEnvelope:
    reviewed_input_ref: str
    document_identity_ref: str
    chunk_schema_version: str


class LegalChunkBoundary(AgentBoundaryBase):
    boundary_source = LEGAL_CHUNK_BOUNDARY_SOURCE
    source_event = LEGAL_CHUNK_COMMAND
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
                "build_legal_chunks",
                reviewed_input_ref=envelope.reviewed_input_ref,
                document_identity_ref=envelope.document_identity_ref,
                chunk_schema_version=envelope.chunk_schema_version,
            )
        except (ValueError, RuntimeError, OSError) as exc:
            raise NonRetryableAgentBoundaryError(str(exc)) from exc
        LegalChunkRepository(storage_root=storage_root).save(result.to_record())
        logger.info(
            "LEGAL_CHUNK_SET_BUILT",
            reviewed_input_ref=envelope.reviewed_input_ref,
            chunk_set_ref=result.chunk_set_ref,
            correlationId=correlationId,
        )

    def _storage_root(self) -> Path:
        root = getattr(self._config, "legal_source_storage_root", None)
        if not isinstance(root, str) or not root.strip():
            raise NonRetryableAgentBoundaryError("LEGAL_SOURCE_STORAGE_ROOT is not configured")
        return Path(root).resolve()

    def _read_envelope(self, message: dict[str, Any]) -> LegalChunkEnvelope:
        reviewed_input_ref = self._read_required_string(
            message, "reviewedInputRef", "reviewed_input_ref"
        )
        document_identity_ref = self._read_required_string(
            message, "documentIdentityRef", "document_identity_ref"
        )
        chunk_schema_version = self._read_required_string(
            message, "chunkSchemaVersion", "chunk_schema_version"
        )
        return LegalChunkEnvelope(
            reviewed_input_ref=reviewed_input_ref,
            document_identity_ref=document_identity_ref,
            chunk_schema_version=chunk_schema_version,
        )

    @staticmethod
    def _read_required_string(container: dict[str, Any], *keys: str) -> str:
        for key in keys:
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        raise NonRetryableAgentBoundaryError(f"missing required field: {keys[0]}")
