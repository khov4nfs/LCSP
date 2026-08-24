"""Consume bounded OCR fallback commands for legal snapshots without canonical text."""

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

from .ocr_fallback import OcrFallbackTool
from .ocr_fallback_repository import OcrFallbackRepository

logger = get_logger(__name__)

OCR_FALLBACK_COMMAND = "command.legal-source.ocr-fallback.requested.v1"
OCR_FALLBACK_BOUNDARY_SOURCE = "lcsp.legal-source-ocr-fallback.v1"


@dataclass(frozen=True)
class OcrFallbackEnvelope:
    """Validated snapshot, fallback proof, bounded pages, and OCR profile."""

    snapshot_ref: str
    fallback_proof_ref: str
    page_numbers: list[int]
    ocr_profile: str


class OcrFallbackBoundary(AgentBoundaryBase):
    """Run OCR only for explicitly bounded pages backed by fallback proof."""

    boundary_source = OCR_FALLBACK_BOUNDARY_SOURCE
    source_event = OCR_FALLBACK_COMMAND
    requires_pbac = False
    retry_delays_seconds = ()

    def __init__(
        self,
        config,
        pbac_client=None,
        api_client: WorkerApiClient | None = None,
        tool: OcrFallbackTool | None = None,
    ) -> None:
        """Create the boundary with optional injected API/OCR tool adapters."""
        super().__init__(config, pbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._tool = tool

    def handle(self, message: dict[str, Any], correlationId: str) -> None:
        """Validate fallback authorization, dispatch bounded OCR, and persist it."""
        envelope = self._read_envelope(message)
        storage_root = self._storage_root()
        repository = OcrFallbackRepository(storage_root=storage_root)
        dispatcher = LegalToolDispatcher(
            LegalToolExecutionContext(
                api_client=self._api_client,
                storage_root=storage_root,
                ocr_tool=self._tool,
            )
        )
        try:
            result = dispatcher.dispatch(
                "run_ocr_fallback",
                snapshot_ref=envelope.snapshot_ref,
                fallback_proof_ref=envelope.fallback_proof_ref,
                page_numbers=envelope.page_numbers,
                ocr_profile=envelope.ocr_profile,
                output_dir=self._output_dir(
                    storage_root=storage_root,
                    snapshot_ref=envelope.snapshot_ref,
                ),
            )
        except (ValueError, RuntimeError, OSError, TimeoutError) as exc:
            raise NonRetryableAgentBoundaryError(str(exc)) from exc
        repository.save(result.to_record())
        logger.info(
            "OCR_FALLBACK_COMPLETED",
            snapshot_ref=envelope.snapshot_ref,
            ocr_ref=result.ocr_ref,
            provenance_ref=result.provenance_ref,
            correlationId=correlationId,
        )

    def _storage_root(self) -> Path:
        """Resolve the legal-source storage root or fail the command terminally."""
        root = getattr(self._config, "legal_source_storage_root", None)
        if not isinstance(root, str) or not root.strip():
            raise NonRetryableAgentBoundaryError("LEGAL_SOURCE_STORAGE_ROOT is not configured")
        return Path(root).resolve()

    def _output_dir(self, *, storage_root: Path, snapshot_ref: str) -> Path:
        """Build the versioned OCR artifact directory for a snapshot reference."""
        return (
            storage_root
            / "official-ocr-fallbacks"
            / snapshot_ref.removeprefix("snapshot:").replace(":", "_")
        )

    def _read_envelope(self, message: dict[str, Any]) -> OcrFallbackEnvelope:
        """Validate required fields and require unique positive page numbers."""
        snapshot_ref = self._read_required_string(message, "snapshotRef", "snapshot_ref")
        fallback_proof_ref = self._read_required_string(
            message, "fallbackProofRef", "fallback_proof_ref"
        )
        ocr_profile = self._read_required_string(message, "ocrProfile", "ocr_profile")
        raw_page_numbers = message.get("pageNumbers", message.get("page_numbers"))
        if not isinstance(raw_page_numbers, list) or not raw_page_numbers:
            raise NonRetryableAgentBoundaryError("OCR fallback pageNumbers is invalid")
        page_numbers: list[int] = []
        for value in raw_page_numbers:
            if not isinstance(value, int) or value < 1:
                raise NonRetryableAgentBoundaryError("OCR fallback pageNumbers is invalid")
            page_numbers.append(value)
        if len(set(page_numbers)) != len(page_numbers):
            raise NonRetryableAgentBoundaryError("OCR fallback pageNumbers must be unique")
        return OcrFallbackEnvelope(
            snapshot_ref=snapshot_ref,
            fallback_proof_ref=fallback_proof_ref,
            page_numbers=page_numbers,
            ocr_profile=ocr_profile,
        )

    @staticmethod
    def _read_required_string(container: dict[str, Any], *keys: str) -> str:
        """Read the first non-empty string alias or raise a terminal command error."""
        for key in keys:
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        raise NonRetryableAgentBoundaryError(f"missing required field: {keys[0]}")
