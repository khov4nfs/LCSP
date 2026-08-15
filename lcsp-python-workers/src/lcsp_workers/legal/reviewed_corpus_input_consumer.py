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

from .reviewed_corpus_input_repository import ReviewedCorpusInputRepository

logger = get_logger(__name__)

REVIEWED_CORPUS_INPUT_COMMAND = "command.legal-source.reviewed-input.requested.v1"
REVIEWED_CORPUS_INPUT_QUEUE = "lcsp.legal-source-reviewed-input.v1"


@dataclass(frozen=True)
class ReviewedCorpusInputEnvelope:
    extraction_ref: str
    quality_manifest_ref: str
    correction_profile: str


class ReviewedCorpusInputConsumer(ConsumerBase):
    queue_name = REVIEWED_CORPUS_INPUT_QUEUE
    routing_key = REVIEWED_CORPUS_INPUT_COMMAND
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
                "build_reviewed_corpus_input",
                extraction_ref=envelope.extraction_ref,
                quality_manifest_ref=envelope.quality_manifest_ref,
                correction_profile=envelope.correction_profile,
            )
        except (ValueError, RuntimeError, OSError) as exc:
            raise NonRetryableWorkerError(str(exc)) from exc
        ReviewedCorpusInputRepository(storage_root=storage_root).save(
            result.to_record()
        )
        logger.info(
            "REVIEWED_CORPUS_INPUT_BUILT",
            extraction_ref=envelope.extraction_ref,
            quality_manifest_ref=envelope.quality_manifest_ref,
            reviewed_input_ref=result.reviewed_input_ref,
            correlationId=correlationId,
        )

    def _storage_root(self) -> Path:
        root = getattr(self._config, "legal_source_storage_root", None)
        if not isinstance(root, str) or not root.strip():
            raise NonRetryableWorkerError("LEGAL_SOURCE_STORAGE_ROOT is not configured")
        return Path(root).resolve()

    def _read_envelope(self, message: dict[str, Any]) -> ReviewedCorpusInputEnvelope:
        extraction_ref = self._read_required_string(
            message, "extractionRef", "extraction_ref"
        )
        quality_manifest_ref = self._read_required_string(
            message, "qualityManifestRef", "quality_manifest_ref"
        )
        correction_profile = self._read_required_string(
            message, "correctionProfile", "correction_profile"
        )
        return ReviewedCorpusInputEnvelope(
            extraction_ref=extraction_ref,
            quality_manifest_ref=quality_manifest_ref,
            correction_profile=correction_profile,
        )

    @staticmethod
    def _read_required_string(container: dict[str, Any], *keys: str) -> str:
        for key in keys:
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        raise NonRetryableWorkerError(f"missing required field: {keys[0]}")
