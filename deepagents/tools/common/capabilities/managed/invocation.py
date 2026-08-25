"""Invoke LCSP domain handlers through Managed Deep Agents boundaries."""

from __future__ import annotations

import importlib
import inspect
from dataclasses import dataclass
from typing import Any, Type

from tools.common.capabilities.agentic_evidence import (
    AgenticToolResolver,
    bind_runtime_handlers,
    build_engineering_rule_agentic_registry,
)
from tools.common.capabilities.agentic_evidence.governance.authorization import ApiPbacToolAuthorizer
from tools.common.capabilities.platform.pbac_client import PbacClient
from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.platform.config import load_config
from tools.common.capabilities.managed.boundary import AgentBoundaryBase


@dataclass(frozen=True)
class AgentInvocationBoundary:
    """Static Managed Agent invocation boundary."""

    name: str
    target: str
    boundary_source: str
    source_event: str


AGENT_INVOCATION_BOUNDARIES: tuple[AgentInvocationBoundary, ...] = (
    AgentInvocationBoundary(
        "scan_requested",
        "tools.common.capabilities.evidence.scanner.scanning.scan_boundary:ScanBoundary",
        "scan.triggered",
        "command.scan.requested.v1",
    ),
    AgentInvocationBoundary(
        "targeted_reanalysis_requested",
        "tools.common.capabilities.evidence.scanner.scanning.targeted_reanalysis_boundary:TargetedReanalysisBoundary",
        "scan.targeted-reanalysis-requested",
        "command.targeted-reanalysis.requested.v1",
    ),
    AgentInvocationBoundary(
        "engineering_assessment_requested",
        "tools.common.capabilities.assessment.investigation.engineering_rule.engineering_assessment_boundary:EngineeringAssessmentBoundary",
        "investigation.evidence-accepted",
        "event.technical-evidence.accepted.v1",
    ),
    AgentInvocationBoundary(
        "legal_change_detection_requested",
        "tools.legal.sources.change_detection.legal_change_detector_boundary:LegalChangeDetectorBoundary",
        "legal.legal-change-detector",
        "cron.legal-catalog.check-updates.v1",
    ),
    AgentInvocationBoundary(
        "legal_corpus_recovery_requested",
        "tools.legal.sources.recovery.legal_corpus_recovery_boundary:LegalCorpusRecoveryBoundary",
        "legal.legal-corpus-recovery",
        "command.legal-corpus.recover.v1",
    ),
    AgentInvocationBoundary(
        "legal_source_ingest_requested",
        "tools.legal.sources.ingest.legal_source_ingest_boundary:LegalSourceIngestBoundary",
        "legal.official-source-ingest",
        "command.legal-source.ingest.v1",
    ),
    AgentInvocationBoundary(
        "official_text_extraction_requested",
        "tools.legal.sources.extraction.official_text_extraction_boundary:OfficialTextExtractionBoundary",
        "legal.official-text-extraction",
        "command.official-text.extract.v1",
    ),
    AgentInvocationBoundary(
        "ocr_fallback_requested",
        "tools.legal.sources.ocr_fallback.ocr_fallback_boundary:OcrFallbackBoundary",
        "legal.ocr-fallback",
        "command.ocr-fallback.run.v1",
    ),
    AgentInvocationBoundary(
        "ocr_quality_requested",
        "tools.legal.sources.ocr_quality.ocr_quality_boundary:OcrQualityBoundary",
        "legal.ocr-quality",
        "command.ocr-quality.evaluate.v1",
    ),
    AgentInvocationBoundary(
        "reviewed_corpus_input_requested",
        "tools.legal.corpus.reviewed_input.reviewed_corpus_input_boundary:ReviewedCorpusInputBoundary",
        "legal.reviewed-corpus-input",
        "command.reviewed-corpus-input.build.v1",
    ),
    AgentInvocationBoundary(
        "legal_chunk_build_requested",
        "tools.legal.corpus.legal_chunks.legal_chunk_boundary:LegalChunkBoundary",
        "legal.legal-chunk-build",
        "command.legal-chunks.build.v1",
    ),
    AgentInvocationBoundary(
        "vbpl_effected_chunk_set_requested",
        "tools.legal.sources.vbpl_effects.vbpl_effected_chunk_set_boundary:VbplEffectedChunkSetBoundary",
        "legal.vbpl-effected-chunk-set",
        "command.vbpl-effected-chunk-set.build.v1",
    ),
    AgentInvocationBoundary(
        "chunk_integrity_requested",
        "tools.legal.corpus.chunk_integrity.chunk_integrity_boundary:ChunkIntegrityBoundary",
        "legal.chunk-integrity",
        "command.chunk-integrity.validate.v1",
    ),
    AgentInvocationBoundary(
        "legal_retrieval_index_requested",
        "tools.legal.retrieval.index.legal_retrieval_index_boundary:LegalRetrievalIndexBoundary",
        "legal.legal-retrieval-index",
        "command.legal-retrieval-index.build.v1",
    ),
    AgentInvocationBoundary(
        "gap_analysis_requested",
        "tools.common.capabilities.reporting.gap.gap_analysis_boundary:GapAnalysisBoundary",
        "reporting.document-gap-analysis-requested",
        "document.gap-analysis-requested",
    ),
    AgentInvocationBoundary(
        "final_report_requested",
        "tools.common.capabilities.reporting.report.final_report.final_report_boundary:FinalReportBoundary",
        "reporting.document-final-report-requested",
        "document.final-report-requested",
    ),
    AgentInvocationBoundary(
        "audit_export_requested",
        "tools.common.capabilities.reporting.report.audit_export.audit_export_boundary:AuditExportBoundary",
        "reporting.audit-export-requested",
        "audit.export-requested",
    ),
)

_BOUNDARY_INDEX = {boundary.name: boundary for boundary in AGENT_INVOCATION_BOUNDARIES}
if len(_BOUNDARY_INDEX) != len(AGENT_INVOCATION_BOUNDARIES):
    raise RuntimeError("Managed Agent invocation boundary names must be unique")


def invocation_boundary_manifest() -> tuple[dict[str, str], ...]:
    """Return all domain handlers addressable as Managed Agent boundaries."""
    return tuple(
        {
            "name": boundary.name,
            "target": boundary.target,
            "boundary_source": boundary.boundary_source,
            "source_event": boundary.source_event,
        }
        for boundary in AGENT_INVOCATION_BOUNDARIES
    )


def invoke_boundary(
    boundary_name: str,
    message: dict[str, Any],
    correlation_id: str,
) -> dict[str, Any]:
    """Invoke one Managed Agent boundary by name."""
    boundary = _BOUNDARY_INDEX.get(boundary_name)
    if boundary is None:
        raise ValueError(f"unknown managed agent invocation boundary: {boundary_name}")
    boundary_handler = build_boundary(boundary.target)
    boundary_handler.handle(message, correlation_id)
    return {
        "boundary": boundary.name,
        "target": boundary.target,
        "source_event": boundary.source_event,
        "status": "COMPLETED",
    }


def load_boundary(target: str) -> Type[AgentBoundaryBase]:
    """Resolve and validate a Managed Agent boundary class from an import target."""
    module_name, separator, class_name = target.partition(":")
    if not separator or not module_name or not class_name:
        raise ValueError("boundary target must use module.path:ClassName syntax")

    module = importlib.import_module(module_name)
    boundary_type = getattr(module, class_name, None)
    if not inspect.isclass(boundary_type) or not issubclass(boundary_type, AgentBoundaryBase):
        raise TypeError(f"{target} is not a AgentBoundaryBase implementation")
    return boundary_type


def build_boundary(target: str) -> AgentBoundaryBase:
    """Construct a boundary handler and inject only the dependencies it declares."""
    config = load_config()
    boundary_type = load_boundary(target)
    constructor = inspect.signature(boundary_type)
    kwargs: dict[str, object] = {}

    if "pbac_client" in constructor.parameters:
        kwargs["pbac_client"] = PbacClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )

    if "agentic_tool_resolver" in constructor.parameters:
        api_client = WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        registry = build_engineering_rule_agentic_registry()
        bind_runtime_handlers(
            registry,
            api_client=api_client,
            user_id="managed-deep-agent-runtime",
            organization_id="managed-deep-agent-runtime",
        )
        kwargs["agentic_tool_resolver"] = AgenticToolResolver(
            registry,
            ApiPbacToolAuthorizer(
                pbac_client=PbacClient(
                    config.nestjs_api_base_url,
                    config.worker_api_key,
                    timeout_seconds=config.pbac_preflight.timeout_seconds,
                ),
            ),
            max_tool_calls=config.agentic_runtime.max_tool_calls,
        )

    return boundary_type(config, **kwargs)
