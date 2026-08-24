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

from .ocr_quality_repository import OcrQualityRepository

logger = get_logger(__name__)

OCR_QUALITY_COMMAND = "command.legal-source.ocr-quality.requested.v1"
OCR_QUALITY_BOUNDARY_SOURCE = "lcsp.legal-source-ocr-quality.v1"


@dataclass(frozen=True)
class OcrQualityEnvelope:
    extraction_ref: str
    expected_identity_ref: str
    quality_profile: str


class OcrQualityBoundary(AgentBoundaryBase):
    boundary_source = OCR_QUALITY_BOUNDARY_SOURCE
    source_event = OCR_QUALITY_COMMAND
    requires_pbac = False
    retry_delays_seconds = ()

    def handle(self, message: dict[str, Any], correlationId: str) -> None:
        envelope = self._read_envelope(message)
        storage_root = self._storage_root()
        dispatcher = LegalToolDispatcher(
            LegalToolExecutionContext(
                api_client=None,
                storage_root=storage_root,
            )
        )
        try:
            result = dispatcher.dispatch(
                "evaluate_ocr_quality",
                extraction_ref=envelope.extraction_ref,
                expected_identity_ref=envelope.expected_identity_ref,
                quality_profile=envelope.quality_profile,
            )
        except (ValueError, RuntimeError, OSError) as exc:
            raise NonRetryableAgentBoundaryError(str(exc)) from exc
        OcrQualityRepository(storage_root=storage_root).save(result.to_record())
        logger.info(
            "OCR_QUALITY_EVALUATED",
            extraction_ref=envelope.extraction_ref,
            quality_manifest_ref=result.quality_manifest_ref,
            correlationId=correlationId,
        )

    def _storage_root(self) -> Path:
        root = getattr(self._config, "legal_source_storage_root", None)
        if not isinstance(root, str) or not root.strip():
            raise NonRetryableAgentBoundaryError("LEGAL_SOURCE_STORAGE_ROOT is not configured")
        return Path(root).resolve()

    def _read_envelope(self, message: dict[str, Any]) -> OcrQualityEnvelope:
        extraction_ref = self._read_required_string(
            message, "extractionRef", "extraction_ref"
        )
        expected_identity_ref = self._read_required_string(
            message, "expectedIdentityRef", "expected_identity_ref"
        )
        quality_profile = self._read_required_string(
            message, "qualityProfile", "quality_profile"
        )
        return OcrQualityEnvelope(
            extraction_ref=extraction_ref,
            expected_identity_ref=expected_identity_ref,
            quality_profile=quality_profile,
        )

    @staticmethod
    def _read_required_string(container: dict[str, Any], *keys: str) -> str:
        for key in keys:
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        raise NonRetryableAgentBoundaryError(f"missing required field: {keys[0]}")
