"""Canonical execution entrypoints for registered API/Agentic tools.

Architecture invariant: every canonical ``tool_name`` represented by this runtime
has a real public function with exactly the same snake_case name. These functions
are intentionally thin: they provide a stable, searchable execution boundary
while domain logic remains owned by the downstream NestJS CQRS handler or
protected worker runtime.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from lcsp_workers.platform.api_client import WorkerApiClient

from .registry import AgenticToolRequest


@dataclass(frozen=True)
class AgenticToolExecutionContext:
    """Trusted dependencies required by canonical tool entrypoints."""

    api_client: WorkerApiClient
    user_id: str
    organization_id: str
    policy_id: str | None = None
    policy_version: str | None = None


def _dispatch_via_internal_api(
    tool_name: str,
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    """Send one canonical tool invocation through the protected API boundary."""
    payload: dict[str, Any] = {
        "tool_name": tool_name,
        "request_id": str(request.request_id),
        "assessment_id": str(request.assessment_id),
        "workflow_run_id": str(request.workflow_run_id),
        "organization_id": context.organization_id,
        "user_id": context.user_id,
        "artifact_versions": request.artifact_versions,
        "scope": request.scope,
        "budget": {
            "maxItems": request.budget.max_items,
            "maxDepth": request.budget.max_depth,
            "maxBytes": request.budget.max_bytes,
            "maxDurationMs": request.budget.max_duration_ms,
        },
        "input": request.input,
        "correlationId": str(request.correlationId),
    }
    if context.policy_id:
        payload["policy_id"] = context.policy_id
    if context.policy_version:
        payload["policy_version"] = context.policy_version
    return context.api_client.dispatch_agentic_tool(payload)


def resume_waiting_runs(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("resume_waiting_runs", request, context)


def propose_gap_remediation(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("propose_gap_remediation", request, context)


def get_gap_evidence_trace(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("get_gap_evidence_trace", request, context)


def get_reconciliation_context(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("get_reconciliation_context", request, context)


def request_targeted_reanalysis(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("request_targeted_reanalysis", request, context)


def propose_missing_targets(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("propose_missing_targets", request, context)


def inspect_deployment_context(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("inspect_deployment_context", request, context)


def inspect_decision_path(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("inspect_decision_path", request, context)


def get_artifact_chain(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("get_artifact_chain", request, context)


def find_similar_symbols(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("find_similar_symbols", request, context)


def inspect_human_review_path(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("inspect_human_review_path", request, context)


def inspect_data_path(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("inspect_data_path", request, context)


def find_provider_invocations(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("find_provider_invocations", request, context)


def get_finding_detail(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("get_finding_detail", request, context)


def get_symbol_context(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("get_symbol_context", request, context)


def get_scan_coverage(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("get_scan_coverage", request, context)


def search_evidence(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("search_evidence", request, context)


def get_evidence_subgraph(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("get_evidence_subgraph", request, context)


def trace_static_flow(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("trace_static_flow", request, context)


# The tools below are handled by the internal NestJS dispatcher but are not all
# part of the Python LLM-callable catalog. They still expose exact-name execution
# entrypoints so a developer can trace the canonical name directly to the CQRS
# owner without widening model access.


def get_assessment_context(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("get_assessment_context", request, context)


def get_verified_profile(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("get_verified_profile", request, context)


def compare_wizard_claim(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("compare_wizard_claim", request, context)


def get_classification_baseline(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("get_classification_baseline", request, context)


def get_gap_requirements(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("get_gap_requirements", request, context)


def validate_classification_proposal(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("validate_classification_proposal", request, context)


def evaluate_gap_matrix(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("evaluate_gap_matrix", request, context)


def get_admin_source_catalog(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("get_admin_source_catalog", request, context)


def get_legal_corpus_readiness(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("get_legal_corpus_readiness", request, context)


def retrieve_legal_basis(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("retrieve_legal_basis", request, context)


def get_legal_rule_match(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("get_legal_rule_match", request, context)


def validate_citation_set(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    return _dispatch_via_internal_api("validate_citation_set", request, context)


def reconcile_profile_to_verified_profile(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    """Dispatch the protected reconciliation mutation through Nest CommandBus."""
    return _dispatch_via_internal_api(
        "reconcile_profile_to_verified_profile", request, context
    )


def submit_classification_for_independent_review(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    """Dispatch protected review submission with pinned PBAC policy metadata."""
    return _dispatch_via_internal_api(
        "submit_classification_for_independent_review", request, context
    )


def resolve_independent_classification_review(
    request: AgenticToolRequest,
    context: AgenticToolExecutionContext,
) -> Mapping[str, Any]:
    """Dispatch protected review resolution with pinned PBAC policy metadata."""
    return _dispatch_via_internal_api(
        "resolve_independent_classification_review", request, context
    )
