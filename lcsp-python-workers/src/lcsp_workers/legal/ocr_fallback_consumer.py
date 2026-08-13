from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from structlog import get_logger

from lcsp_workers.platform.api_client import WorkerApiClient
from lcsp_workers.platform.queue_consumer import ConsumerBase, NonRetryableWorkerError

from .official_text_extraction import OfficialSourceSnapshotResolver
from .official_text_extraction_repository import OfficialTextExtractionRepository
from .ocr_fallback import OcrFallbackRequest, OcrFallbackTool
from .ocr_fallback_repository import OcrFallbackRepository

logger = get_logger(__name__)

OCR_FALLBACK_COMMAND = "command.legal-source.ocr-fallback.requested.v1"
OCR_FALLBACK_QUEUE = "lcsp.legal-source-ocr-fallback.v1"


@dataclass(frozen=True)
class OcrFallbackEnvelope:
    snapshot_ref: str
    fallback_proof_ref: str
    page_numbers: list[int]
    ocr_profile: str


class OcrFallbackConsumer(ConsumerBase):
    queue_name = OCR_FALLBACK_QUEUE
    routing_key = OCR_FALLBACK_COMMAND
    requires_pbac = False
    retry_delays_seconds = ()

    def __init__(
        self,
        config,
        pbac_client=None,
        api_client: WorkerApiClient | None = None,
        tool: OcrFallbackTool | None = None,
    ) -> None:
        super().__init__(config, pbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._tool = tool

    def handle(self, message: dict[str, Any], correlationId: str) -> None:
        envelope = self._read_envelope(message)
        storage_root = self._storage_root()
        repository = OcrFallbackRepository(storage_root=storage_root)
        tool = self._tool or OcrFallbackTool(
            snapshot_resolver=OfficialSourceSnapshotResolver(
                api_client=self._api_client,
                storage_root=storage_root,
            ),
            extraction_repository=OfficialTextExtractionRepository(
                storage_root=storage_root
            ),
        )
        try:
            result = tool.run(
                OcrFallbackRequest(
                    snapshot_ref=envelope.snapshot_ref,
                    fallback_proof_ref=envelope.fallback_proof_ref,
                    page_numbers=envelope.page_numbers,
                    ocr_profile=envelope.ocr_profile,
                    output_dir=self._output_dir(
                        storage_root=storage_root,
                        snapshot_ref=envelope.snapshot_ref,
                    ),
                )
            )
        except (ValueError, RuntimeError, OSError, TimeoutError) as exc:
            raise NonRetryableWorkerError(str(exc)) from exc
        repository.save(result.to_record())
        logger.info(
            "OCR_FALLBACK_COMPLETED",
            snapshot_ref=envelope.snapshot_ref,
            ocr_ref=result.ocr_ref,
            provenance_ref=result.provenance_ref,
            correlationId=correlationId,
        )

    def _storage_root(self) -> Path:
        root = getattr(self._config, "legal_source_storage_root", None)
        if not isinstance(root, str) or not root.strip():
            raise NonRetryableWorkerError("LEGAL_SOURCE_STORAGE_ROOT is not configured")
        return Path(root).resolve()

    def _output_dir(self, *, storage_root: Path, snapshot_ref: str) -> Path:
        return (
            storage_root
            / "official-ocr-fallbacks"
            / snapshot_ref.removeprefix("snapshot:").replace(":", "_")
        )

    def _read_envelope(self, message: dict[str, Any]) -> OcrFallbackEnvelope:
        snapshot_ref = self._read_required_string(message, "snapshotRef", "snapshot_ref")
        fallback_proof_ref = self._read_required_string(
            message, "fallbackProofRef", "fallback_proof_ref"
        )
        ocr_profile = self._read_required_string(message, "ocrProfile", "ocr_profile")
        raw_page_numbers = message.get("pageNumbers", message.get("page_numbers"))
        if not isinstance(raw_page_numbers, list) or not raw_page_numbers:
            raise NonRetryableWorkerError("OCR fallback pageNumbers is invalid")
        page_numbers: list[int] = []
        for value in raw_page_numbers:
            if not isinstance(value, int) or value < 1:
                raise NonRetryableWorkerError("OCR fallback pageNumbers is invalid")
            page_numbers.append(value)
        if len(set(page_numbers)) != len(page_numbers):
            raise NonRetryableWorkerError("OCR fallback pageNumbers must be unique")
        return OcrFallbackEnvelope(
            snapshot_ref=snapshot_ref,
            fallback_proof_ref=fallback_proof_ref,
            page_numbers=page_numbers,
            ocr_profile=ocr_profile,
        )

    @staticmethod
    def _read_required_string(container: dict[str, Any], *keys: str) -> str:
        for key in keys:
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        raise NonRetryableWorkerError(f"missing required field: {keys[0]}")
