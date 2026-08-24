"""Consume snapshot extraction commands and persist deterministic official-text spans."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from structlog import get_logger

from tools.common.agentic_evidence.dispatcher import LegalToolDispatcher
from tools.common.agentic_evidence.legal_tool_entrypoints import (
    LegalToolExecutionContext,
)
from tools.common.platform.api_client import WorkerApiClient
from tools.common.managed.boundary import AgentBoundaryBase, NonRetryableAgentBoundaryError

from .official_text_extraction import OfficialTextExtractor
from .official_text_extraction_repository import OfficialTextExtractionRepository

logger = get_logger(__name__)

OFFICIAL_TEXT_EXTRACTION_COMMAND = "command.legal-source.extract.requested.v1"
OFFICIAL_TEXT_EXTRACTION_BOUNDARY_SOURCE = "lcsp.legal-source-extract.v1"


@dataclass(frozen=True)
class OfficialTextExtractionEnvelope:
    """Validated snapshot reference, extractor profile, and page budget."""

    snapshot_ref: str
    extractor_profile: str
    max_pages: int


class OfficialTextExtractionBoundary(AgentBoundaryBase):
    """Resolve a registered source snapshot, extract spans, and persist the result."""

    boundary_source = OFFICIAL_TEXT_EXTRACTION_BOUNDARY_SOURCE
    source_event = OFFICIAL_TEXT_EXTRACTION_COMMAND
    requires_pbac = False
    retry_delays_seconds = (30, 120, 600)

    def __init__(
        self,
        config,
        pbac_client=None,
        api_client: WorkerApiClient | None = None,
        extractor: OfficialTextExtractor | None = None,
    ) -> None:
        """Create the boundary with injectable API and extraction adapters."""
        super().__init__(config, pbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._extractor = extractor

    def handle(self, message: dict[str, Any], correlationId: str) -> None:
        """Dispatch canonical snapshot extraction and persist its registry record."""
        envelope = self._read_envelope(message)
        storage_root = self._storage_root()
        repository = OfficialTextExtractionRepository(storage_root=storage_root)
        dispatcher = LegalToolDispatcher(
            LegalToolExecutionContext(
                api_client=self._api_client,
                storage_root=storage_root,
                text_extractor=self._extractor,
            )
        )
        try:
            result = dispatcher.dispatch(
                "extract_official_text",
                snapshot_ref=envelope.snapshot_ref,
                extractor_profile=envelope.extractor_profile,
                max_pages=envelope.max_pages,
            )
        except (ValueError, RuntimeError) as exc:
            raise NonRetryableAgentBoundaryError(str(exc)) from exc
        repository.save(result)
        logger.info(
            "OFFICIAL_TEXT_EXTRACTION_COMPLETED",
            snapshot_ref=envelope.snapshot_ref,
            extraction_ref=result.extraction_ref,
            span_manifest_path=str(result.span_manifest_path),
            correlationId=correlationId,
        )

    def _storage_root(self) -> Path:
        """Resolve the configured legal-source storage root or fail terminally."""
        root = getattr(self._config, "legal_source_storage_root", None)
        if not isinstance(root, str) or not root.strip():
            raise NonRetryableAgentBoundaryError("LEGAL_SOURCE_STORAGE_ROOT is not configured")
        return Path(root).resolve()

    def _read_envelope(self, message: dict[str, Any]) -> OfficialTextExtractionEnvelope:
        """Validate extraction command fields and normalize camel/snake aliases."""
        snapshot_ref = self._read_required_string(message, "snapshotRef", "snapshot_ref")
        extractor_profile = self._read_required_string(
            message, "extractorProfile", "extractor_profile"
        )
        max_pages = message.get("maxPages", message.get("max_pages"))
        if not isinstance(max_pages, int) or max_pages < 1:
            raise NonRetryableAgentBoundaryError("official text extraction maxPages is invalid")
        return OfficialTextExtractionEnvelope(
            snapshot_ref=snapshot_ref,
            extractor_profile=extractor_profile,
            max_pages=max_pages,
        )

    @staticmethod
    def _read_required_string(container: dict[str, Any], *keys: str) -> str:
        """Read the first non-empty string alias or raise a terminal command error."""
        for key in keys:
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        raise NonRetryableAgentBoundaryError(f"missing required field: {keys[0]}")
