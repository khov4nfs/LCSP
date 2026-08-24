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

logger = get_logger(__name__)

VBPL_EFFECTED_CHUNK_SET_COMMAND = (
    "command.legal-source.vbpl-effected-chunk-set.requested.v1"
)
VBPL_EFFECTED_CHUNK_SET_BOUNDARY_SOURCE = "lcsp.legal-source-vbpl-effected-chunk-set.v1"


@dataclass(frozen=True)
class VbplEffectedChunkSetEnvelope:
    source_manifest_path: Path
    normalized_payload_path: Path
    document_identity_ref: str
    reviewed_input_ref: str
    output_dir: Path | None = None
    run_id: str | None = None
    chunk_set_ref: str | None = None
    relationship_manifest_ref: str | None = None
    no_propagate_repealed_descendants: bool = False


class VbplEffectedChunkSetBoundary(AgentBoundaryBase):
    boundary_source = VBPL_EFFECTED_CHUNK_SET_BOUNDARY_SOURCE
    source_event = VBPL_EFFECTED_CHUNK_SET_COMMAND
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
                "build_vbpl_effected_chunk_set",
                source_manifest_path=envelope.source_manifest_path,
                normalized_payload_path=envelope.normalized_payload_path,
                document_identity_ref=envelope.document_identity_ref,
                reviewed_input_ref=envelope.reviewed_input_ref,
                output_dir=envelope.output_dir,
                run_id=envelope.run_id,
                chunk_set_ref=envelope.chunk_set_ref,
                relationship_manifest_ref=envelope.relationship_manifest_ref,
                no_propagate_repealed_descendants=(
                    envelope.no_propagate_repealed_descendants
                ),
            )
        except (ValueError, RuntimeError, OSError) as exc:
            raise NonRetryableAgentBoundaryError(str(exc)) from exc
        logger.info(
            "VBPL_EFFECTED_CHUNK_SET_BUILT",
            chunk_set_ref=result["chunkSetRef"],
            relationship_manifest_ref=result["relationshipManifestRef"],
            chunk_count=result["chunkCount"],
            relationship_count=result["relationshipCount"],
            correlationId=correlationId,
        )

    def _storage_root(self) -> Path:
        root = getattr(self._config, "legal_source_storage_root", None)
        if not isinstance(root, str) or not root.strip():
            raise NonRetryableAgentBoundaryError("LEGAL_SOURCE_STORAGE_ROOT is not configured")
        return Path(root).resolve()

    def _read_envelope(self, message: dict[str, Any]) -> VbplEffectedChunkSetEnvelope:
        return VbplEffectedChunkSetEnvelope(
            source_manifest_path=self._read_path(
                message, "sourceManifestPath", "source_manifest_path"
            ),
            normalized_payload_path=self._read_path(
                message, "normalizedPayloadPath", "normalized_payload_path"
            ),
            document_identity_ref=self._read_required_string(
                message, "documentIdentityRef", "document_identity_ref"
            ),
            reviewed_input_ref=self._read_required_string(
                message, "reviewedInputRef", "reviewed_input_ref"
            ),
            output_dir=self._read_optional_path(message, "outputDir", "output_dir"),
            run_id=self._read_optional_string(message, "runId", "run_id"),
            chunk_set_ref=self._read_optional_string(
                message, "chunkSetRef", "chunk_set_ref"
            ),
            relationship_manifest_ref=self._read_optional_string(
                message,
                "relationshipManifestRef",
                "relationship_manifest_ref",
            ),
            no_propagate_repealed_descendants=bool(
                message.get("noPropagateRepealedDescendants")
                or message.get("no_propagate_repealed_descendants")
                or False
            ),
        )

    @classmethod
    def _read_path(cls, container: dict[str, Any], *keys: str) -> Path:
        value = cls._read_required_string(container, *keys)
        return Path(value).resolve()

    @classmethod
    def _read_optional_path(cls, container: dict[str, Any], *keys: str) -> Path | None:
        value = cls._read_optional_string(container, *keys)
        return Path(value).resolve() if value is not None else None

    @staticmethod
    def _read_required_string(container: dict[str, Any], *keys: str) -> str:
        for key in keys:
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        raise NonRetryableAgentBoundaryError(f"missing required field: {keys[0]}")

    @staticmethod
    def _read_optional_string(container: dict[str, Any], *keys: str) -> str | None:
        for key in keys:
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None
