from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from structlog import get_logger

from lcsp_workers.platform.queue_consumer import ConsumerBase, NonRetryableWorkerError

from .official_text_extraction_repository import OfficialTextExtractionRepository
from .ocr_fallback_repository import OcrFallbackRepository
from .ocr_quality_repository import OcrQualityRepository
from .ocr_quality_validator import EvaluateOcrQualityRequest, OcrQualityValidator

logger = get_logger(__name__)

OCR_QUALITY_COMMAND = "command.legal-source.ocr-quality.requested.v1"
OCR_QUALITY_QUEUE = "lcsp.legal-source-ocr-quality.v1"


@dataclass(frozen=True)
class OcrQualityEnvelope:
    extraction_ref: str
    expected_identity_ref: str
    quality_profile: str


class OcrQualityConsumer(ConsumerBase):
    queue_name = OCR_QUALITY_QUEUE
    routing_key = OCR_QUALITY_COMMAND
    requires_pbac = False
    retry_delays_seconds = ()

    def handle(self, message: dict[str, Any], correlationId: str) -> None:
        envelope = self._read_envelope(message)
        storage_root = self._storage_root()
        validator = OcrQualityValidator(
            storage_root=storage_root,
            extraction_repository=OfficialTextExtractionRepository(
                storage_root=storage_root
            ),
            ocr_repository=OcrFallbackRepository(storage_root=storage_root),
        )
        try:
            result = validator.evaluate(
                EvaluateOcrQualityRequest(
                    extraction_ref=envelope.extraction_ref,
                    expected_identity_ref=envelope.expected_identity_ref,
                    quality_profile=envelope.quality_profile,
                )
            )
        except (ValueError, RuntimeError, OSError) as exc:
            raise NonRetryableWorkerError(str(exc)) from exc
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
            raise NonRetryableWorkerError("LEGAL_SOURCE_STORAGE_ROOT is not configured")
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
        raise NonRetryableWorkerError(f"missing required field: {keys[0]}")
