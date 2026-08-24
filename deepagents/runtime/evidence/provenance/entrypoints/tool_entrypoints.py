"""Canonical CQRS/protected-system tool adapters.

Technical analysis is deliberately absent from this module. Program graph traversal,
evidence synthesis and remediation processing live in Python-local tool modules. These
entrypoints only cross the trusted NestJS CQRS/authority boundary.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Mapping
from tools.common.platform.api_client import WorkerApiClient
from .registry import AgenticToolRequest

@dataclass(frozen=True)
class AgenticToolExecutionContext:
    api_client: WorkerApiClient
    user_id: str
    organization_id: str
    policy_id: str | None = None
    policy_version: str | None = None

def _dispatch_via_internal_api(tool_name: str, request: AgenticToolRequest, context: AgenticToolExecutionContext) -> Mapping[str, Any]:
    payload: dict[str, Any] = {"tool_name": tool_name, "request_id": str(request.request_id), "assessment_id": str(request.assessment_id), "workflow_run_id": str(request.workflow_run_id), "organization_id": context.organization_id, "user_id": context.user_id, "artifact_versions": request.artifact_versions, "scope": request.scope, "budget": {"maxItems": request.budget.max_items, "maxDepth": request.budget.max_depth, "maxBytes": request.budget.max_bytes, "maxDurationMs": request.budget.max_duration_ms}, "input": request.input, "correlationId": str(request.correlationId)}
    if context.policy_id: payload["policy_id"] = context.policy_id
    if context.policy_version: payload["policy_version"] = context.policy_version
    return context.api_client.dispatch_agentic_tool(payload)

def _adapter(name: str, request: AgenticToolRequest, context: AgenticToolExecutionContext) -> Mapping[str, Any]: return _dispatch_via_internal_api(name, request, context)

def resume_waiting_runs(request, context): return _adapter("resume_waiting_runs", request, context)
def request_targeted_reanalysis(request, context): return _adapter("request_targeted_reanalysis", request, context)
def get_gap_evidence_trace(request, context): return _adapter("get_gap_evidence_trace", request, context)
def get_reconciliation_context(request, context): return _adapter("get_reconciliation_context", request, context)
def get_artifact_chain(request, context): return _adapter("get_artifact_chain", request, context)
def get_assessment_context(request, context): return _adapter("get_assessment_context", request, context)
def get_verified_profile(request, context): return _adapter("get_verified_profile", request, context)
def compare_wizard_claim(request, context): return _adapter("compare_wizard_claim", request, context)
def get_classification_baseline(request, context): return _adapter("get_classification_baseline", request, context)
def get_gap_requirements(request, context): return _adapter("get_gap_requirements", request, context)
def validate_classification_proposal(request, context): return _adapter("validate_classification_proposal", request, context)
def evaluate_gap_matrix(request, context): return _adapter("evaluate_gap_matrix", request, context)
def get_admin_source_catalog(request, context): return _adapter("get_admin_source_catalog", request, context)
def get_legal_corpus_readiness(request, context): return _adapter("get_legal_corpus_readiness", request, context)
def retrieve_legal_basis(request, context): return _adapter("retrieve_legal_basis", request, context)
def get_legal_rule_match(request, context): return _adapter("get_legal_rule_match", request, context)
def validate_citation_set(request, context): return _adapter("validate_citation_set", request, context)
def reconcile_profile_to_verified_profile(request, context): return _adapter("reconcile_profile_to_verified_profile", request, context)
def submit_classification_for_independent_review(request, context): return _adapter("submit_classification_for_independent_review", request, context)
def resolve_independent_classification_review(request, context): return _adapter("resolve_independent_classification_review", request, context)
