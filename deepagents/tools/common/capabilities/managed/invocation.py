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
from tools.common.capabilities.agentic_evidence.governance.authorization import ApiRbacToolAuthorizer
from tools.common.capabilities.platform.rbac_client import RbacClient
from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.platform.config import load_config
from middleware.billing_recovery import (
    drain as drain_billing_recovery,
    start_background_worker,
)
from middleware.billing_metering import (
    BillingMeteringSession,
    BillingMeteringError,
    BillingFinalizationError,
    activate_billing_metering,
)
from tools.common.capabilities.managed.boundary import AgentBoundaryBase
from orchestration.agent_stream import (
    AgentStreamSession,
    BufferedAgentStreamEmitter,
    activate_agent_stream,
    publish_agent_stream_event,
)
from tools.legal.sources.recovery.legal_corpus_recovery_driver import (
    LEGAL_CORPUS_RECOVERY_COMMAND,
)
from tools.triage.legal_rule_triage.contracts import (
    LEGAL_RULE_TRIAGE_REQUEST_COMMAND,
)


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
        "tools.common.capabilities.assessment.investigation.engineering_rule.interview_gated_boundary:InterviewGatedEngineeringAssessmentBoundary",
        "investigation.evidence-accepted",
        "event.technical-evidence.accepted.v1",
    ),
    AgentInvocationBoundary(
        "assessment_interview_resume_requested",
        "tools.common.capabilities.workflow.recovery.interview_boundary:AssessmentInterviewResumeBoundary",
        "assessment.interview-answer-submitted",
        "command.assessment-interview.resume-agent.v1",
    ),
    AgentInvocationBoundary(
        "legal_rule_triage_requested",
        "tools.triage.legal_rule_triage.boundary:LegalRuleTriageBoundary",
        "legal.engineering-rule-readiness",
        LEGAL_RULE_TRIAGE_REQUEST_COMMAND,
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
        LEGAL_CORPUS_RECOVERY_COMMAND,
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
    session = _agent_stream_session(boundary.name, message, correlation_id)
    billing_session = _billing_metering_session(boundary.name, message, correlation_id)
    try:
        billing_context = activate_billing_metering(billing_session)
        with billing_context:
            with activate_agent_stream(session):
                _run_boundary_handler(
                    boundary_handler,
                    message,
                    correlation_id,
                    boundary,
                )
    except Exception as error:
        # Keep a spendable reservation for broker-retryable execution failures.
        # Terminal failures are not going to execute again and can release now.
        if billing_session is not None:
            from middleware.failure_policy import is_terminal_task_error

            if is_terminal_task_error(error) and not isinstance(
                error, BillingMeteringError
            ):
                try:
                    billing_session.release()
                except Exception:
                    pass
        raise
    else:
        if billing_session is not None:
            try:
                billing_session.release()
            except Exception as error:
                # Do not redeliver completed model work when only finalization
                # failed. Recovery must handle the reservation separately.
                raise BillingFinalizationError(error) from error
    return {
        "boundary": boundary.name,
        "target": boundary.target,
        "source_event": boundary.source_event,
        "status": "COMPLETED",
    }


def _run_boundary_handler(
    boundary_handler: Type[AgentBoundaryBase],
    message: dict[str, Any],
    correlation_id: str,
    boundary: AgentInvocationBoundary,
) -> None:
    """Run one boundary while preserving existing stream failure telemetry."""
    publish_agent_stream_event(
        "BOUNDARY_STARTED",
        status="RUNNING",
        data={"boundary": boundary.name, "source_event": boundary.source_event},
    )
    try:
        boundary_handler.handle(message, correlation_id)
    except Exception as error:
        publish_agent_stream_event(
            "BOUNDARY_FAILED",
            status="FAILED",
            text=str(error),
            data={
                "boundary": boundary.name,
                "exception_type": type(error).__name__,
            },
        )
        raise
    publish_agent_stream_event(
        "BOUNDARY_COMPLETED",
        status="COMPLETED",
        data={"boundary": boundary.name},
    )


def _billing_metering_session(
    boundary_name: str,
    message: dict[str, Any],
    correlation_id: str,
) -> BillingMeteringSession | None:
    """Start billing from API-issued context and reject assessment bypasses."""
    message_assessment_id = _find_first_text(
        message, ("assessmentId", "assessment_id")
    )
    billing = message.get("billing")
    if not isinstance(billing, dict):
        if message_assessment_id:
            raise ValueError(
                "billing context is required for assessment model invocation"
            )
        return None
    assessment_id = _find_first_text(billing, ("assessmentId", "assessment_id"))
    run_id = _find_first_text(billing, ("runId", "run_id", "workflowRunId"))
    amount = _find_first_text(billing, ("amountCredits", "reservationCredits"))
    max_charge = _find_first_text(billing, ("maxChargeCredits",))
    provider = _find_first_text(billing, ("provider",))
    model = _find_first_text(billing, ("model",))
    max_input_tokens = _find_first_text(billing, ("maxInputTokens",))
    max_input_bytes = _find_first_text(billing, ("maxInputBytes",))
    max_output_tokens = _find_first_text(billing, ("maxOutputTokens",))
    max_reasoning_tokens = _find_first_text(billing, ("maxReasoningTokens",))
    max_invocations = _find_first_text(billing, ("maxInvocations",))
    authorized_models = billing.get("authorizedModels")
    idempotency_key = _find_first_text(billing, ("idempotencyKey",))
    # The boundary/agent owns the billing role. Never trust a role supplied inside
    # an event payload because the pricing snapshot is selected by this identity.
    role = boundary_name
    effective = billing.get("effectiveRuntimeModel")
    if not all(
        (
            assessment_id,
            run_id,
            amount,
            max_charge,
            provider,
            model,
            max_input_tokens,
            max_input_bytes,
            max_output_tokens,
            max_reasoning_tokens,
            max_invocations,
            authorized_models,
            idempotency_key,
        )
    ) or not isinstance(authorized_models, list) or any(
        not isinstance(item, dict)
        or not isinstance(item.get("provider"), str)
        or not isinstance(item.get("model"), str)
        for item in authorized_models
    ) or (
        effective is not None and not isinstance(effective, dict)
    ):
        raise ValueError("billing context is incomplete")
    if message_assessment_id and message_assessment_id != assessment_id:
        raise ValueError("billing assessment does not match invocation assessment")
    config = load_config()
    client = WorkerApiClient(config.nestjs_api_base_url, config.worker_api_key)
    if config.billing_recovery_store_path:
        drain_billing_recovery(config.billing_recovery_store_path, client)
        start_background_worker(config.billing_recovery_store_path, client)
    return BillingMeteringSession.reserve(
        api_client=client,
        assessment_id=assessment_id,
        run_id=run_id,
        agent_role=role,
        amount_credits=amount,
        max_charge_credits=max_charge,
        provider=provider.upper(),
        model=model,
        max_input_tokens=max_input_tokens,
        max_input_bytes=max_input_bytes,
        max_output_tokens=max_output_tokens,
        max_reasoning_tokens=max_reasoning_tokens,
        max_invocations=max_invocations,
        authorized_models=[
            {str(k): str(v) for k, v in item.items()}
            for item in authorized_models
        ],
        # The outbox idempotency key identifies the billing group, not a broker
        # delivery attempt. A retry must recover/replay the same reservation;
        # deriving a new key leaves the previous reservation stranded.
        idempotency_key=f"{idempotency_key}:{boundary_name}",
        effective_runtime_model=(
            {str(k): str(v) for k, v in effective.items()}
            if isinstance(effective, dict)
            else None
        ),
        recovery_store_path=config.billing_recovery_store_path,
    )



def _agent_stream_session(
    boundary_name: str,
    message: dict[str, Any],
    correlation_id: str,
) -> AgentStreamSession | None:
    """Build a customer-visible stream session when the event carries an assessment."""
    assessment_id = _find_first_text(message, ("assessmentId", "assessment_id"))
    if not assessment_id:
        return None
    run_id = _find_first_text(
        message,
        (
            "scanJobId",
            "scan_job_id",
            "workflowRunId",
            "workflow_run_id",
            "runId",
            "run_id",
            "requestId",
            "request_id",
        ),
    ) or correlation_id
    config = load_config()
    client = WorkerApiClient(config.nestjs_api_base_url, config.worker_api_key)
    return AgentStreamSession(
        assessment_id=assessment_id,
        run_id=run_id,
        correlation_id=correlation_id,
        boundary_name=boundary_name,
        emit_payload=BufferedAgentStreamEmitter(client.post_agent_stream_event),
    )


def _find_first_text(
    value: Any,
    keys: tuple[str, ...],
    *,
    depth: int = 5,
) -> str | None:
    if depth < 0:
        return None
    if isinstance(value, dict):
        for key in keys:
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        for nested in value.values():
            found = _find_first_text(nested, keys, depth=depth - 1)
            if found:
                return found
    elif isinstance(value, (list, tuple)):
        for nested in value[:50]:
            found = _find_first_text(nested, keys, depth=depth - 1)
            if found:
                return found
    return None

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

    if "rbac_client" in constructor.parameters:
        kwargs["rbac_client"] = RbacClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )

    if "api_client" in constructor.parameters:
        kwargs["api_client"] = WorkerApiClient(
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
        )
        kwargs["agentic_tool_resolver"] = AgenticToolResolver(
            registry,
            ApiRbacToolAuthorizer(
                rbac_client=RbacClient(
                    config.nestjs_api_base_url,
                    config.worker_api_key,
                    timeout_seconds=config.rbac_preflight.timeout_seconds,
                ),
            ),
            max_tool_calls=config.agentic_runtime.max_tool_calls,
        )

    return boundary_type(config, **kwargs)
