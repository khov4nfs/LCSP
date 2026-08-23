"""Invoke former RabbitMQ consumers through Managed Deep Agents boundaries."""

from __future__ import annotations

import importlib
import inspect
from dataclasses import dataclass
from typing import Any, Type

from lcsp_workers.agentic_evidence import (
    AgenticToolResolver,
    bind_runtime_handlers,
    build_sprint6_agentic_registry,
)
from lcsp_workers.agentic_evidence.authorization import ApiPbacToolAuthorizer
from lcsp_workers.llm import (
    BudgetTracker,
    DeepAgentClient,
    LlmProviderCandidate,
    PrimaryThenFallbackLLMClient,
)
from lcsp_workers.platform.api_client import WorkerApiClient
from lcsp_workers.platform.config import WorkerConfig, load_config
from lcsp_workers.platform.queue_consumer import ConsumerBase


@dataclass(frozen=True)
class AgentInvocationBoundary:
    """Static boundary replacing one former RabbitMQ consumer queue."""

    name: str
    target: str
    queue_name: str
    routing_key: str


AGENT_INVOCATION_BOUNDARIES: tuple[AgentInvocationBoundary, ...] = (
    AgentInvocationBoundary(
        "scan_requested",
        "lcsp_workers.scanner.scan_consumer:ScanConsumer",
        "scan.triggered",
        "command.scan.requested.v1",
    ),
    AgentInvocationBoundary(
        "targeted_reanalysis_requested",
        "lcsp_workers.scanner.targeted_reanalysis_consumer:TargetedReanalysisConsumer",
        "scan.targeted-reanalysis-requested",
        "command.targeted-reanalysis.requested.v1",
    ),
    AgentInvocationBoundary(
        "engineering_assessment_requested",
        "lcsp_workers.investigation.engineering_assessment_consumer:EngineeringAssessmentConsumer",
        "investigation.evidence-accepted",
        "event.technical-evidence.accepted.v1",
    ),
    AgentInvocationBoundary(
        "technical_profile_requested",
        "lcsp_workers.intelligence.technical_profile_consumer:TechnicalProfileConsumer",
        "intelligence.evidence-accepted",
        "event.technical-evidence.accepted.v1",
    ),
    AgentInvocationBoundary(
        "ai_usage_flow_requested",
        "lcsp_workers.intelligence.ai_usage_flow_consumer:AIUsageFlowConsumer",
        "intelligence.technical-profile-ready",
        "event.technical-profile.ready.v1",
    ),
    AgentInvocationBoundary(
        "conflict_detection_requested",
        "lcsp_workers.intelligence.conflict_detection_consumer:ConflictDetectionConsumer",
        "intelligence.ai-usage-flow-ready",
        "event.ai-usage-flow.ready.v1",
    ),
    AgentInvocationBoundary(
        "verified_profile_requested",
        "lcsp_workers.intelligence.verified_profile_consumer:VerifiedProfileConsumer",
        "intelligence.all-conflicts-resolved",
        "event.reconciliation.all-conflicts-resolved.v1",
    ),
    AgentInvocationBoundary(
        "classification_requested",
        "lcsp_workers.classification.classification_consumer:ClassificationConsumer",
        "classification.legal-rule-match-ready",
        "event.legal-rule-match.ready.v1",
    ),
    AgentInvocationBoundary(
        "legal_retrieval_requested",
        "lcsp_workers.legal.legal_retrieval_consumer:LegalRetrievalConsumer",
        "legal.legal-matching-requested",
        "command.legal-matching.requested.v1",
    ),
    AgentInvocationBoundary(
        "legal_change_detection_requested",
        "lcsp_workers.legal.legal_change_detector_consumer:LegalChangeDetectorConsumer",
        "legal.legal-change-detector",
        "cron.legal-catalog.check-updates.v1",
    ),
    AgentInvocationBoundary(
        "legal_corpus_recovery_requested",
        "lcsp_workers.legal.legal_corpus_recovery_consumer:LegalCorpusRecoveryConsumer",
        "legal.legal-corpus-recovery",
        "command.legal-corpus.recover.v1",
    ),
    AgentInvocationBoundary(
        "legal_source_ingest_requested",
        "lcsp_workers.legal.legal_source_ingest_consumer:LegalSourceIngestConsumer",
        "legal.official-source-ingest",
        "command.legal-source.ingest.v1",
    ),
    AgentInvocationBoundary(
        "official_text_extraction_requested",
        "lcsp_workers.legal.official_text_extraction_consumer:OfficialTextExtractionConsumer",
        "legal.official-text-extraction",
        "command.official-text.extract.v1",
    ),
    AgentInvocationBoundary(
        "ocr_fallback_requested",
        "lcsp_workers.legal.ocr_fallback_consumer:OcrFallbackConsumer",
        "legal.ocr-fallback",
        "command.ocr-fallback.run.v1",
    ),
    AgentInvocationBoundary(
        "ocr_quality_requested",
        "lcsp_workers.legal.ocr_quality_consumer:OcrQualityConsumer",
        "legal.ocr-quality",
        "command.ocr-quality.evaluate.v1",
    ),
    AgentInvocationBoundary(
        "reviewed_corpus_input_requested",
        "lcsp_workers.legal.reviewed_corpus_input_consumer:ReviewedCorpusInputConsumer",
        "legal.reviewed-corpus-input",
        "command.reviewed-corpus-input.build.v1",
    ),
    AgentInvocationBoundary(
        "legal_chunk_build_requested",
        "lcsp_workers.legal.legal_chunk_consumer:LegalChunkConsumer",
        "legal.legal-chunk-build",
        "command.legal-chunks.build.v1",
    ),
    AgentInvocationBoundary(
        "vbpl_effected_chunk_set_requested",
        "lcsp_workers.legal.vbpl_effected_chunk_set_consumer:VbplEffectedChunkSetConsumer",
        "legal.vbpl-effected-chunk-set",
        "command.vbpl-effected-chunk-set.build.v1",
    ),
    AgentInvocationBoundary(
        "chunk_integrity_requested",
        "lcsp_workers.legal.chunk_integrity_consumer:ChunkIntegrityConsumer",
        "legal.chunk-integrity",
        "command.chunk-integrity.validate.v1",
    ),
    AgentInvocationBoundary(
        "legal_retrieval_index_requested",
        "lcsp_workers.legal.legal_retrieval_index_consumer:LegalRetrievalIndexConsumer",
        "legal.legal-retrieval-index",
        "command.legal-retrieval-index.build.v1",
    ),
    AgentInvocationBoundary(
        "gap_analysis_requested",
        "lcsp_workers.reporting.gap_analysis_consumer:GapAnalysisConsumer",
        "reporting.document-gap-analysis-requested",
        "document.gap-analysis-requested",
    ),
    AgentInvocationBoundary(
        "final_report_requested",
        "lcsp_workers.reporting.final_report_consumer:FinalReportConsumer",
        "reporting.document-final-report-requested",
        "document.final-report-requested",
    ),
    AgentInvocationBoundary(
        "audit_export_requested",
        "lcsp_workers.reporting.audit_export_consumer:AuditExportConsumer",
        "reporting.audit-export-requested",
        "audit.export-requested",
    ),
)

_BOUNDARY_INDEX = {boundary.name: boundary for boundary in AGENT_INVOCATION_BOUNDARIES}
if len(_BOUNDARY_INDEX) != len(AGENT_INVOCATION_BOUNDARIES):
    raise RuntimeError("Managed Agent invocation boundary names must be unique")


def invocation_boundary_manifest() -> tuple[dict[str, str], ...]:
    """Return all former queue consumers now addressable as agent boundaries."""
    return tuple(
        {
            "name": boundary.name,
            "target": boundary.target,
            "queue_name": boundary.queue_name,
            "routing_key": boundary.routing_key,
        }
        for boundary in AGENT_INVOCATION_BOUNDARIES
    )


def invoke_boundary(
    boundary_name: str,
    message: dict[str, Any],
    correlation_id: str,
) -> dict[str, Any]:
    """Invoke one former queue consumer without RabbitMQ process ownership."""
    boundary = _BOUNDARY_INDEX.get(boundary_name)
    if boundary is None:
        raise ValueError(f"unknown managed agent invocation boundary: {boundary_name}")
    consumer = build_consumer(boundary.target)
    consumer.handle(message, correlation_id)
    return {
        "boundary": boundary.name,
        "target": boundary.target,
        "routing_key": boundary.routing_key,
        "status": "COMPLETED",
    }


def load_consumer(target: str) -> Type[ConsumerBase]:
    """Resolve and validate a consumer class from an import target."""
    module_name, separator, class_name = target.partition(":")
    if not separator or not module_name or not class_name:
        raise ValueError("consumer target must use module.path:ClassName syntax")

    module = importlib.import_module(module_name)
    consumer_type = getattr(module, class_name, None)
    if not inspect.isclass(consumer_type) or not issubclass(consumer_type, ConsumerBase):
        raise TypeError(f"{target} is not a ConsumerBase implementation")
    return consumer_type


def build_consumer(target: str) -> ConsumerBase:
    """Construct a former consumer and inject only the dependencies it declares."""
    config = load_config()
    consumer_type = load_consumer(target)
    constructor = inspect.signature(consumer_type)
    kwargs: dict[str, object] = {}

    if "pbac_client" in constructor.parameters:
        from lcsp_workers.platform.pbac_client import PbacClient

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

    return consumer_type(config, **kwargs)


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
