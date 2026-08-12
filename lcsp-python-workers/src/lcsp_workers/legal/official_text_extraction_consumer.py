from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from structlog import get_logger

from lcsp_workers.platform.api_client import WorkerApiClient
from lcsp_workers.platform.queue_consumer import ConsumerBase, NonRetryableWorkerError

from .official_text_extraction import (
    OfficialSourceSnapshotResolver,
    OfficialTextExtractor,
)
from .official_text_extraction_repository import OfficialTextExtractionRepository

logger = get_logger(__name__)

OFFICIAL_TEXT_EXTRACTION_COMMAND = "command.legal-source.extract.requested.v1"
OFFICIAL_TEXT_EXTRACTION_QUEUE = "lcsp.legal-source-extract.v1"


@dataclass(frozen=True)
class OfficialTextExtractionEnvelope:
    snapshot_ref: str
    extractor_profile: str
    max_pages: int


class OfficialTextExtractionConsumer(ConsumerBase):
    queue_name = OFFICIAL_TEXT_EXTRACTION_QUEUE
    routing_key = OFFICIAL_TEXT_EXTRACTION_COMMAND
    requires_pbac = False
    retry_delays_seconds = (30, 120, 600)

    def __init__(
        self,
        config,
        pbac_client=None,
        api_client: WorkerApiClient | None = None,
        extractor: OfficialTextExtractor | None = None,
    ) -> None:
        super().__init__(config, pbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._extractor = extractor or OfficialTextExtractor()

    def handle(self, message: dict[str, Any], correlation_id: str) -> None:
        envelope = self._read_envelope(message)
        storage_root = self._storage_root()
        repository = OfficialTextExtractionRepository(storage_root=storage_root)
        resolver = OfficialSourceSnapshotResolver(
            api_client=self._api_client,
            storage_root=storage_root,
        )
        try:
            resolved = resolver.resolve(snapshot_ref=envelope.snapshot_ref)
            output_dir = (
                storage_root
                / "official-text-extractions"
                / resolved.snapshot_ref.removeprefix("snapshot:").replace(":", "_")
            )
            result = self._extractor.extract_from_resolved_snapshot(
                resolved_snapshot=resolved,
                extractor_profile=envelope.extractor_profile,
                max_pages=envelope.max_pages,
                output_dir=output_dir,
            )
        except (ValueError, RuntimeError) as exc:
            raise NonRetryableWorkerError(str(exc)) from exc
        repository.save(result)
        logger.info(
            "OFFICIAL_TEXT_EXTRACTION_COMPLETED",
            snapshot_ref=envelope.snapshot_ref,
            extraction_ref=result.extraction_ref,
            span_manifest_path=str(result.span_manifest_path),
            correlation_id=correlation_id,
        )

    def _storage_root(self) -> Path:
        root = getattr(self._config, "legal_source_storage_root", None)
        if not isinstance(root, str) or not root.strip():
            raise NonRetryableWorkerError("LEGAL_SOURCE_STORAGE_ROOT is not configured")
        return Path(root).resolve()

    def _read_envelope(self, message: dict[str, Any]) -> OfficialTextExtractionEnvelope:
        snapshot_ref = self._read_required_string(message, "snapshotRef", "snapshot_ref")
        extractor_profile = self._read_required_string(
            message, "extractorProfile", "extractor_profile"
        )
        max_pages = message.get("maxPages", message.get("max_pages"))
        if not isinstance(max_pages, int) or max_pages < 1:
            raise NonRetryableWorkerError("official text extraction maxPages is invalid")
        return OfficialTextExtractionEnvelope(
            snapshot_ref=snapshot_ref,
            extractor_profile=extractor_profile,
            max_pages=max_pages,
        )

    @staticmethod
    def _read_required_string(container: dict[str, Any], *keys: str) -> str:
        for key in keys:
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        raise NonRetryableWorkerError(f"missing required field: {keys[0]}")
