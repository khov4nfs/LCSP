"""Python-owned remediation processing over CQRS-provided immutable gap evidence."""
from __future__ import annotations
import hashlib
from typing import Any, Mapping
from .registry import AgenticToolRequest

COLLECT_EVIDENCE = "remediation:collect-evidence"
RESOLVE_CONFLICT = "remediation:resolve-conflict"
EXPAND_COVERAGE = "remediation:expand-coverage"
TOOL_VERSION = "2.0.0"
CONFIG_HASH = "sha256:" + hashlib.sha256(b"python-gap-remediation-v2").hexdigest()


def propose_gap_remediation(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    """Create a bounded remediation proposal in Python; Nest is queried only for facts."""
    row_ref = str(request.input.get("rowRef") or "")
    template_id = str(request.input.get("templateId") or "")
    trace = context.api_client.dispatch_agentic_tool(_cqrs_trace_payload(request, context, row_ref))
    coverage = str(trace.get("coverageState") or "UNAVAILABLE")
    result = trace.get("result") if isinstance(trace.get("result"), dict) else {}
    resolver = str(result.get("resolverType") or "")
    evidence_refs = [str(value) for value in trace.get("evidenceRefs") or [] if str(value)]
    limitations = list(trace.get("limitations") or [])
    expected = _expected_template(coverage, resolver)
    if expected is None:
        return _response(request, row_ref, template_id, coverage, evidence_refs, limitations, "NEEDS_INPUT", None, "Gap evidence is insufficient to choose a remediation path.")
    if template_id != expected:
        return _response(request, row_ref, template_id, coverage, evidence_refs, limitations, "BLOCKED", None, f"Template {template_id!r} is not allowed for resolver {resolver!r}; expected {expected!r}.")
    proposal_ref = "remediation:" + hashlib.sha256(f"{row_ref}:{template_id}".encode()).hexdigest()[:24]
    proposal = {
        "proposalRef": proposal_ref,
        "rowRef": row_ref,
        "templateId": template_id,
        "requiredIndependentValidation": True,
        "problem": _problem(resolver, coverage),
        "suggestedAction": _suggested_action(template_id),
        "verification": "Re-run the pinned assessment after evidence/code changes; only new accepted evidence may close the gap.",
        "sourceTrace": result.get("layers") or [],
    }
    return _response(request, row_ref, template_id, coverage, evidence_refs, limitations, "READY", proposal, None)


def _cqrs_trace_payload(request: AgenticToolRequest, context, row_ref: str) -> dict[str, Any]:
    return {
        "tool_name": "get_gap_evidence_trace",
        "request_id": str(request.request_id),
        "assessment_id": str(request.assessment_id),
        "workflow_run_id": str(request.workflow_run_id),
        "organization_id": context.organization_id,
        "user_id": context.user_id,
        "artifact_versions": request.artifact_versions,
        "scope": request.scope,
        "budget": {"maxItems": request.budget.max_items, "maxDepth": request.budget.max_depth, "maxBytes": request.budget.max_bytes, "maxDurationMs": request.budget.max_duration_ms},
        "input": {"rowRef": row_ref},
        "correlationId": str(request.correlationId),
        **({"policy_id": context.policy_id} if getattr(context, "policy_id", None) else {}),
        **({"policy_version": context.policy_version} if getattr(context, "policy_version", None) else {}),
    }


def _expected_template(coverage: str, resolver: str) -> str | None:
    normalized_coverage, normalized_resolver = coverage.upper(), resolver.upper()
    if normalized_coverage in {"LIMITED", "OUT_OF_COVERAGE"}: return EXPAND_COVERAGE
    if "CITATION" in normalized_resolver or "CONFLICT" in normalized_resolver: return RESOLVE_CONFLICT
    if "COLLECT" in normalized_resolver or "REFRESH" in normalized_resolver: return COLLECT_EVIDENCE
    return None


def _problem(resolver: str, coverage: str) -> str:
    if coverage.upper() in {"LIMITED", "OUT_OF_COVERAGE"}: return "Evidence coverage is insufficient for this gap row."
    if "CITATION" in resolver.upper() or "CONFLICT" in resolver.upper(): return "Existing evidence or legal citation context requires reconciliation."
    return "Required evidence for this gap row is missing or stale."


def _suggested_action(template_id: str) -> str:
    return {COLLECT_EVIDENCE: "Collect or re-scan the missing evidence and keep the original gap open until independently validated.", RESOLVE_CONFLICT: "Resolve the evidence/declaration conflict, preserve both provenance chains, then re-evaluate the rule.", EXPAND_COVERAGE: "Expand static-analysis coverage for the unresolved path and re-run the assessment."}[template_id]


def _response(request: AgenticToolRequest, row_ref: str, template_id: str, coverage: str, evidence_refs: list[str], limitations: list[Any], status: str, proposal: dict[str, Any] | None, reason: str | None) -> dict[str, Any]:
    result = proposal or {"proposalRef": "", "rowRef": row_ref, "templateId": template_id, "requiredIndependentValidation": True}
    if reason: result["reason"] = reason
    return {"status": status, "toolName": "propose_gap_remediation", "toolVersion": TOOL_VERSION, "configHash": CONFIG_HASH, "correlationId": str(request.correlationId), "artifactVersions": {"gapRowRef": row_ref}, "provenanceRef": "remediation-proposal:" + hashlib.sha256(str(request.correlationId).encode()).hexdigest()[:24], "coverageState": coverage, "evidenceRefs": evidence_refs, "limitations": limitations, "result": result}
