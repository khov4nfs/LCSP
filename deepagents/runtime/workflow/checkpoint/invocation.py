"""Invoke LCSP domain handlers through Managed Deep Agents boundaries."""

from __future__ import annotations

import importlib
import inspect
from dataclasses import dataclass
from typing import Any, Type

from tools.common.agentic_evidence import (
    AgenticToolResolver,
    bind_runtime_handlers,
    build_sprint6_agentic_registry,
)
from tools.common.agentic_evidence.authorization import ApiPbacToolAuthorizer
from tools.common.llm import (
    BudgetTracker,
    DeepAgentClient,
    LlmProviderCandidate,
    PrimaryThenFallbackLLMClient,
)
from tools.common.platform.api_client import WorkerApiClient
from tools.common.platform.config import WorkerConfig, load_config
from tools.common.managed.boundary import AgentBoundaryBase


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
        "tools.graph.scanner.scan_boundary:ScanBoundary",
        "scan.triggered",
        "command.scan.requested.v1",
    ),
    AgentInvocationBoundary(
        "targeted_reanalysis_requested",
        "tools.graph.scanner.targeted_reanalysis_boundary:TargetedReanalysisBoundary",
        "scan.targeted-reanalysis-requested",
        "command.targeted-reanalysis.requested.v1",
    ),
    AgentInvocationBoundary(
        "engineering_assessment_requested",
        "tools.engineer_rule.investigation.engineering_assessment_boundary:EngineeringAssessmentBoundary",
        "investigation.evidence-accepted",
        "event.technical-evidence.accepted.v1",
    ),
    AgentInvocationBoundary(
        "technical_profile_requested",
        "tools.engineer_rule.intelligence.technical_profile_boundary:TechnicalProfileBoundary",
        "intelligence.evidence-accepted",
        "event.technical-evidence.accepted.v1",
    ),
    AgentInvocationBoundary(
        "ai_usage_flow_requested",
        "tools.engineer_rule.intelligence.ai_usage_flow_boundary:AIUsageFlowBoundary",
        "intelligence.technical-profile-ready",
        "event.technical-profile.ready.v1",
    ),
    AgentInvocationBoundary(
        "conflict_detection_requested",
        "tools.engineer_rule.intelligence.conflict_detection_boundary:ConflictDetectionBoundary",
        "intelligence.ai-usage-flow-ready",
        "event.ai-usage-flow.ready.v1",
    ),
    AgentInvocationBoundary(
        "verified_profile_requested",
        "tools.engineer_rule.intelligence.verified_profile_boundary:VerifiedProfileBoundary",
        "intelligence.all-conflicts-resolved",
        "event.reconciliation.all-conflicts-resolved.v1",
    ),
    AgentInvocationBoundary(
        "classification_requested",
        "tools.classification.classification.classification_boundary:ClassificationBoundary",
        "classification.legal-rule-match-ready",
        "event.legal-rule-match.ready.v1",
    ),
    AgentInvocationBoundary(
        "legal_retrieval_requested",
        "tools.legal.legal.legal_retrieval_boundary:LegalRetrievalBoundary",
        "legal.legal-matching-requested",
        "command.legal-matching.requested.v1",
    ),
    AgentInvocationBoundary(
        "legal_change_detection_requested",
        "tools.legal.legal.legal_change_detector_boundary:LegalChangeDetectorBoundary",
        "legal.legal-change-detector",
        "cron.legal-catalog.check-updates.v1",
    ),
    AgentInvocationBoundary(
        "legal_corpus_recovery_requested",
        "tools.legal.legal.legal_corpus_recovery_boundary:LegalCorpusRecoveryBoundary",
        "legal.legal-corpus-recovery",
        "command.legal-corpus.recover.v1",
    ),
    AgentInvocationBoundary(
        "legal_source_ingest_requested",
        "tools.legal.legal.legal_source_ingest_boundary:LegalSourceIngestBoundary",
        "legal.official-source-ingest",
        "command.legal-source.ingest.v1",
    ),
    AgentInvocationBoundary(
        "official_text_extraction_requested",
        "tools.legal.legal.official_text_extraction_boundary:OfficialTextExtractionBoundary",
        "legal.official-text-extraction",
        "command.official-text.extract.v1",
    ),
    AgentInvocationBoundary(
        "ocr_fallback_requested",
        "tools.legal.legal.ocr_fallback_boundary:OcrFallbackBoundary",
        "legal.ocr-fallback",
        "command.ocr-fallback.run.v1",
    ),
    AgentInvocationBoundary(
        "ocr_quality_requested",
        "tools.legal.legal.ocr_quality_boundary:OcrQualityBoundary",
        "legal.ocr-quality",
        "command.ocr-quality.evaluate.v1",
    ),
    AgentInvocationBoundary(
        "reviewed_corpus_input_requested",
        "tools.legal.legal.reviewed_corpus_input_boundary:ReviewedCorpusInputBoundary",
        "legal.reviewed-corpus-input",
        "command.reviewed-corpus-input.build.v1",
    ),
    AgentInvocationBoundary(
        "legal_chunk_build_requested",
        "tools.legal.legal.legal_chunk_boundary:LegalChunkBoundary",
        "legal.legal-chunk-build",
        "command.legal-chunks.build.v1",
    ),
    AgentInvocationBoundary(
        "vbpl_effected_chunk_set_requested",
        "tools.legal.legal.vbpl_effected_chunk_set_boundary:VbplEffectedChunkSetBoundary",
        "legal.vbpl-effected-chunk-set",
        "command.vbpl-effected-chunk-set.build.v1",
    ),
    AgentInvocationBoundary(
        "chunk_integrity_requested",
        "tools.legal.legal.chunk_integrity_boundary:ChunkIntegrityBoundary",
        "legal.chunk-integrity",
        "command.chunk-integrity.validate.v1",
    ),
    AgentInvocationBoundary(
        "legal_retrieval_index_requested",
        "tools.legal.legal.legal_retrieval_index_boundary:LegalRetrievalIndexBoundary",
        "legal.legal-retrieval-index",
        "command.legal-retrieval-index.build.v1",
    ),
    AgentInvocationBoundary(
        "gap_analysis_requested",
        "tools.gap.reporting.gap_analysis_boundary:GapAnalysisBoundary",
        "reporting.document-gap-analysis-requested",
        "document.gap-analysis-requested",
    ),
    AgentInvocationBoundary(
        "final_report_requested",
        "tools.reports.reporting.final_report_boundary:FinalReportBoundary",
        "reporting.document-final-report-requested",
        "document.final-report-requested",
    ),
    AgentInvocationBoundary(
        "audit_export_requested",
        "tools.reports.reporting.audit_export_boundary:AuditExportBoundary",
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
        from tools.common.platform.pbac_client import PbacClient

        kwargs["pbac_client"] = PbacClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )

    if "agentic_tool_resolver" in constructor.parameters:
        api_client = WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        registry = build_sprint6_agentic_registry()
        bind_runtime_handlers(
            registry,
            api_client=api_client,
            user_id="managed-deep-agent-runtime",
            organization_id="managed-deep-agent-runtime",
        )
        kwargs["agentic_tool_resolver"] = AgenticToolResolver(
            registry,
            ApiPbacToolAuthorizer(
                base_url=config.nestjs_api_base_url,
                worker_api_key=config.worker_api_key,
                timeout_seconds=config.pbac_preflight.timeout_seconds,
            ),
            max_tool_calls=config.agentic_runtime.max_tool_calls,
        )

    llm_client = None
    if "llm_client" in constructor.parameters:
        llm_client = build_llm_client(config)

    if "llm_client" in constructor.parameters and llm_client is not None:
        kwargs["llm_client"] = llm_client

    return boundary_type(config, **kwargs)


def build_llm_client(config: WorkerConfig):
    """Build the primary/fallback LLM client when enabled."""
    runtime = config.llm_runtime
    if not runtime.enabled:
        return None

    budget_tracker = BudgetTracker(
        monthly_budget_usd=runtime.monthly_budget_usd,
        monthly_token_cap=runtime.monthly_token_cap,
        redis_url=runtime.redis_url,
    )
    providers: list[LlmProviderCandidate] = []
    for provider in runtime.providers:
        if not provider.api_key:
            continue
        providers.append(
            LlmProviderCandidate(
                name=provider.provider,
                client=DeepAgentClient(
                    provider=provider.provider,
                    api_key=provider.api_key,
                    model=provider.model,
                    budget_tracker=budget_tracker,
                    max_tokens_per_call=runtime.max_tokens_per_call,
                    timeout_seconds=runtime.provider_timeout_seconds,
                ),
            )
        )

    if not providers:
        return None

    return PrimaryThenFallbackLLMClient(
        tuple(providers),
        fallback_on_codes=runtime.fallback_on_codes,
        max_provider_attempts=runtime.max_provider_attempts,
    )
