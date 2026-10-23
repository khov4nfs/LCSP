"""Invoke LCSP domain handlers through Deep Agents boundaries."""

from __future__ import annotations

import importlib
import inspect
from dataclasses import dataclass
from typing import Any

from middleware.usage_metering import AgentRunState, activate_agent_run_state
from orchestration.agent_stream import (
    AgentStreamSession,
    BufferedAgentStreamEmitter,
    activate_agent_stream,
    publish_agent_stream_event,
)

from tools.common.capabilities.agent_runtime.boundary import AgentBoundaryBase
from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.platform.config import load_config
from tools.common.capabilities.platform.rbac_client import RbacClient


@dataclass(frozen=True)
class AgentInvocationBoundary:
    """Static Agent Runtime invocation boundary."""

    name: str
    target: str
    boundary_source: str
    source_event: str


AGENT_INVOCATION_BOUNDARIES: tuple[AgentInvocationBoundary, ...] = (
    AgentInvocationBoundary(
        "legal_change_detection_requested",
        "tools.legal.sources.change_detection.legal_change_detector_boundary:LegalChangeDetectorBoundary",
        "legal.legal-change-detector",
        "cron.legal-source.check-updates.v1",
    ),
    AgentInvocationBoundary(
        "assessment_root_requested",
        "assessment_root.boundary:AssessmentRootBoundary",
        "assessment.root-run",
        "command.assessment.root.requested.v1",
    ),
    AgentInvocationBoundary(
        "rule_set_preparation_requested",
        "rule_set_preparation.boundary:RuleSetPreparationBoundary",
        "legal.rule-set-preparation",
        "command.compliance-rule-set.preparation.requested.v1",
    ),
    AgentInvocationBoundary(
        "legal_source_ingest_requested",
        "tools.legal.sources.ingest.legal_source_ingest_boundary:LegalSourceIngestBoundary",
        "legal.official-source-ingest",
        "command.legal-source.ingest.v1",
    ),
    AgentInvocationBoundary(
        "managed_document_ingest_requested",
        "tools.legal.managed_documents.boundary:ManagedDocumentIngestBoundary",
        "legal.managed-document-ingest",
        "command.legal-source.document-ingest.requested.v1",
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
        "reviewed_legal_source_input_requested",
        "tools.legal.legal_source.reviewed_input.reviewed_legal_source_input_boundary:ReviewedLegalSourceInputBoundary",
        "legal.reviewed-legal-source-input",
        "command.reviewed-legal-source-input.build.v1",
    ),
    AgentInvocationBoundary(
        "legal_chunk_build_requested",
        "tools.legal.legal_source.legal_chunks.legal_chunk_boundary:LegalChunkBoundary",
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
        "tools.legal.legal_source.chunk_integrity.chunk_integrity_boundary:ChunkIntegrityBoundary",
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
        "audit_export_requested",
        "tools.common.capabilities.reporting.report.audit_export.audit_export_boundary:AuditExportBoundary",
        "reporting.audit-export-requested",
        "audit.export-requested",
    ),
    AgentInvocationBoundary(
        "agent_runtime_health_requested",
        "tools.common.capabilities.agent_runtime.health_boundary:AgentRuntimeHealthBoundary",
        "agent-runtime.health",
        "internal.agent-runtime.health.v1",
    ),
)

# Boundary telemetry is activity; the Assessment Root owns the persisted lifecycle.
_BOUNDARY_INDEX = {boundary.name: boundary for boundary in AGENT_INVOCATION_BOUNDARIES}
if len(_BOUNDARY_INDEX) != len(AGENT_INVOCATION_BOUNDARIES):
    raise RuntimeError("Agent Runtime invocation boundary names must be unique")


def invocation_boundary_manifest() -> tuple[dict[str, str], ...]:
    """Return all domain handlers addressable as Agent Runtime boundaries."""
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
    """Invoke one Agent Runtime boundary by name."""
    boundary = _BOUNDARY_INDEX.get(boundary_name)
    if boundary is None:
        raise ValueError(f"unknown agent runtime invocation boundary: {boundary_name}")
    boundary_handler = build_boundary(boundary.target)
    session = _agent_stream_session(boundary.name, message, correlation_id)
    run_state = _agent_run_state(boundary.name, message, correlation_id)
    with activate_agent_run_state(run_state), activate_agent_stream(session):
        if boundary.name == "assessment_root_requested":
            # Root telemetry starts only after the canonical execution lease is claimed.
            boundary_handler.handle(message, correlation_id)
        else:
            _run_boundary_handler(boundary_handler, message, correlation_id, boundary)
    return {
        "boundary": boundary.name,
        "target": boundary.target,
        "source_event": boundary.source_event,
        "status": "COMPLETED",
    }


def report_external_boundary_timeout(
    boundary_name: str,
    message: dict[str, Any],
    correlation_id: str,
    reason_code: str,
) -> None:
    """Journal a deadline failure raised outside the in-process boundary handler."""
    session = _agent_stream_session(boundary_name, message, correlation_id)
    with activate_agent_stream(session):
        publish_agent_stream_event(
            "BOUNDARY_FAILED",
            status="FAILED",
            text="Agent Runtime boundary timed out",
            data={"boundary": boundary_name, "reasonCode": reason_code},
        )


def _run_boundary_handler(
    boundary_handler: type[AgentBoundaryBase],
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


def _agent_run_state(
    boundary_name: str,
    message: dict[str, Any],
    correlation_id: str,
) -> AgentRunState:
    """Run-scoped state for every boundary; stream transport also covers preparation."""
    assessment_id = _find_first_text(message, ("assessmentId", "assessment_id"))
    preparation_run_id = _find_first_text(
        message, ("preparationRunId", "preparation_run_id")
    )
    run_id = _find_first_text(
        message,
        (
            "runId",
            "run_id",
            "workflowRunId",
            "workflow_run_id",
            "scanJobId",
            "scan_job_id",
            "documentRequestId",
            "requestId",
            "request_id",
            "preparationRunId",
            "preparation_run_id",
        ),
    ) or preparation_run_id or correlation_id
    client = None
    if assessment_id or preparation_run_id:
        config = load_config()
        client = WorkerApiClient(config.nestjs_api_base_url, config.worker_api_key)
    # The boundary owns the agent role; never trust one supplied inside an event payload.
    return AgentRunState(
        run_id=run_id,
        agent_role=boundary_name,
        assessment_id=assessment_id,
        preparation_run_id=preparation_run_id,
        api_client=client,
    )


def _agent_stream_session(
    boundary_name: str,
    message: dict[str, Any],
    correlation_id: str,
) -> AgentStreamSession | None:
    """Build the shared stream session for an assessment or preparation boundary."""
    assessment_id = _find_first_text(message, ("assessmentId", "assessment_id"))
    preparation_run_id = _find_first_text(
        message, ("preparationRunId", "preparation_run_id")
    )
    if not assessment_id and not preparation_run_id:
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
            "preparationRunId",
            "preparation_run_id",
        ),
    ) or preparation_run_id or correlation_id
    config = load_config()
    client = WorkerApiClient(config.nestjs_api_base_url, config.worker_api_key)
    return AgentStreamSession(
        assessment_id=assessment_id,
        run_id=run_id,
        correlation_id=correlation_id,
        boundary_name=boundary_name,
        boundary_type=("RULE_SET_PREPARATION" if preparation_run_id else "ASSESSMENT"),
        boundary_id=preparation_run_id or assessment_id,
        preparation_run_id=preparation_run_id,
        emit_payload=(client.post_agent_stream_event if boundary_name == "assessment_root_requested"
                      else BufferedAgentStreamEmitter(client.post_agent_stream_event)),
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

def load_boundary(target: str) -> type[AgentBoundaryBase]:
    """Resolve and validate a Agent Runtime boundary class from an import target."""
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

    return boundary_type(config, **kwargs)
