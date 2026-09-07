"""Trusted runtime overlay for LCSP authored agentic tools."""

from __future__ import annotations

from typing import Any, Mapping
from uuid import uuid4
import os
import time

import httpx
from langchain.tools import ToolRuntime
from pydantic import BaseModel, ConfigDict, Field

from orchestration.context import LCSPRunContext


class AgenticToolRequest(BaseModel):
    """Model-visible tool payload.

    Trusted identity and pinned artifact fields are injected only from
    ``ToolRuntime.context``. They are deliberately absent from this schema so the
    model cannot supply or override them.
    """

    model_config = ConfigDict(extra="forbid")

    correlation_id: str | None = Field(default=None, description="Correlation ID for tracing.")
    input: dict[str, Any] = Field(default_factory=dict, description="Tool-specific input object.")


class CorrelatedToolInput(BaseModel):
    """Base class for domain-specific model-visible tool arguments."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    correlation_id: str | None = Field(default=None, alias="correlationId")


class TrustedAgenticToolRequest(BaseModel):
    """Internal request envelope after trusted runtime injection."""

    model_config = ConfigDict(extra="forbid")

    assessment_id: str
    user_id: str
    workflow_run_id: str | None = None
    correlation_id: str | None = None
    artifact_versions: dict[str, Any] = Field(default_factory=dict)
    input: dict[str, Any] = Field(default_factory=dict)


class AgenticToolInvocationError(RuntimeError):
    """Raised when the trusted internal tool port cannot complete a request."""


def _coerce_runtime_context(runtime: ToolRuntime | None) -> LCSPRunContext | None:
    if runtime is None:
        return None
    context = runtime.context
    if isinstance(context, LCSPRunContext):
        return context
    if isinstance(context, dict):
        try:
            return LCSPRunContext(**context)
        except TypeError:
            return None
    return None


def trusted_agentic_tool_request(
    request: dict[str, Any],
    runtime: ToolRuntime | None = None,
) -> TrustedAgenticToolRequest:
    """Overlay model-visible payload with immutable runtime identity."""
    value = AgenticToolRequest.model_validate(request)
    context = _coerce_runtime_context(runtime)
    if context is None:
        raise AgenticToolInvocationError("LCSP agentic tool requires ToolRuntime context.")
    if not context.assessment_id:
        raise AgenticToolInvocationError("LCSP agentic tool requires assessment_id.")
    if not context.user_id:
        raise AgenticToolInvocationError("LCSP agentic tool requires trusted user_id.")
    return TrustedAgenticToolRequest(
        assessment_id=context.assessment_id,
        user_id=context.user_id,
        workflow_run_id=context.workflow_run_id,
        correlation_id=value.correlation_id,
        artifact_versions=dict(context.artifact_versions),
        input=value.input,
    )


def trusted_request_from_model_input(
    request: dict[str, Any] | BaseModel,
    runtime: ToolRuntime | None = None,
) -> TrustedAgenticToolRequest:
    """Overlay a domain-specific model-visible payload with runtime identity."""
    if isinstance(request, BaseModel):
        data = request.model_dump(by_alias=True, exclude_none=True)
    else:
        data = dict(request)
    correlation_id = data.pop("correlationId", None) or data.pop("correlation_id", None)
    return trusted_agentic_tool_request(
        {"correlation_id": correlation_id, "input": data},
        runtime,
    )


_PYTHON_LOCAL_TOOLS = {
    "get_scan_coverage",
    "search_evidence",
    "inspect_decision_path",
    "inspect_data_path",
    "inspect_human_review_path",
    "find_provider_invocations",
    "get_evidence_subgraph",
    "get_symbol_context",
    "trace_static_flow",
    "find_similar_symbols",
    "inspect_deployment_context",
    "propose_missing_targets",
    "get_finding_detail",
}

_custom_api_client = None


def set_agentic_tool_api_client(client: Any | None) -> None:
    """Override api_client used by local tool dispatcher (useful in tests)."""
    global _custom_api_client
    _custom_api_client = client


def _get_api_client():
    if _custom_api_client is not None:
        return _custom_api_client
    from tools.common.capabilities.platform.api_client import WorkerApiClient
    from tools.common.capabilities.platform.config import load_config

    try:
        config = load_config()
        return WorkerApiClient(config.nestjs_api_base_url, config.worker_api_key)
    except Exception:
        base_url = (os.environ.get("NESTJS_API_BASE_URL") or "").rstrip("/")
        api_key = os.environ.get("WORKER_API_KEY") or ""
        return WorkerApiClient(base_url, api_key)


def _normalize_canonical_input(tool_name: str, raw_input: dict[str, Any]) -> dict[str, Any]:
    data = dict(raw_input)
    if tool_name == "get_scan_coverage":
        return {"maxResults": int(data.get("maxResults", 50))}

    if tool_name == "search_evidence":
        out: dict[str, Any] = {"maxResults": int(data.get("maxResults", 10))}
        if data.get("query"):
            out["query"] = str(data["query"])
        if data.get("pathPrefixes"):
            out["pathPrefixes"] = list(data["pathPrefixes"])
        return out

    if tool_name == "inspect_decision_path":
        start_ref = data.get("startRef") or data.get("subjectRef") or ""
        out = {
            "startRef": str(start_ref),
            "maxHops": int(data.get("maxHops") or 5),
            "maxResults": int(data.get("maxResults", 20)),
        }
        if data.get("actionCategories"):
            out["actionCategories"] = list(data["actionCategories"])
        return out

    if tool_name == "inspect_data_path":
        start_ref = data.get("startRef") or data.get("subjectRef") or ""
        direction = str(data.get("direction", "FORWARD")).upper()
        if direction not in {"FORWARD", "BACKWARD"}:
            direction = "FORWARD"
        return {
            "startRef": str(start_ref),
            "direction": direction,
            "maxHops": int(data.get("maxHops") or 5),
            "maxResults": int(data.get("maxResults", 20)),
        }

    if tool_name == "inspect_human_review_path":
        start_ref = data.get("startRef") or data.get("subjectRef") or ""
        return {
            "startRef": str(start_ref),
            "maxHops": int(data.get("maxHops") or 5),
            "maxResults": int(data.get("maxResults", 20)),
        }

    return {k: v for k, v in data.items() if v is not None}


def dispatch_agentic_tool(tool_name: str, request: TrustedAgenticToolRequest) -> dict[str, Any]:
    from uuid import UUID
    from tools.common.capabilities.agentic_evidence import (
        ApiRbacToolAuthorizer,
        AgenticToolRequest as InternalAgenticToolRequest,
        AgenticToolValidationError,
        ToolRuntimeTarget,
        bind_runtime_handlers,
        build_engineering_rule_agentic_registry,
        runtime_binding,
    )

    binding = runtime_binding(tool_name)
    if binding.runtime_target == ToolRuntimeTarget.PYTHON_LOCAL:
        registry = build_engineering_rule_agentic_registry()
        api_client = _get_api_client()
        bind_runtime_handlers(registry, api_client=api_client, user_id=request.user_id)

        rbac_client = getattr(api_client, "rbac_client", None)
        if rbac_client is None and api_client is not None:
            base_url = getattr(api_client, "_base_url", None)
            api_key = getattr(api_client, "_api_key", None)
            if base_url and api_key:
                from tools.common.capabilities.platform.rbac_client import RbacClient
                rbac_client = RbacClient(base_url, api_key)

        if rbac_client is None:
            raise AgenticToolValidationError("AGENTIC_TOOL_RBAC_UNAVAILABLE")

        authorizer = ApiRbacToolAuthorizer(rbac_client=rbac_client)

        capability = registry.capability(tool_name)
        correlation_id = request.correlation_id or str(uuid4())
        workflow_run_id = request.workflow_run_id or correlation_id

        canonical_input = _normalize_canonical_input(tool_name, request.input)

        agentic_request = InternalAgenticToolRequest.model_validate({
            "toolName": tool_name,
            "requestId": str(uuid4()),
            "assessmentId": request.assessment_id,
            "workflowRunId": workflow_run_id,
            "artifactVersions": dict(request.artifact_versions),
            "correlationId": correlation_id,
            "budget": {
                "maxItems": min(50, capability.max_items),
                "maxDepth": min(5, capability.max_depth),
                "maxBytes": min(262144, capability.max_bytes),
                "maxDurationMs": min(30000, capability.max_duration_ms),
            },
            "input": canonical_input,
        })
        registry.validate_model_request(agentic_request)
        authorizer.authorize(
            tool_name=tool_name,
            user_id=request.user_id,
            correlationId=UUID(correlation_id) if isinstance(correlation_id, str) else correlation_id,
        )
        result = registry.invoke_model_tool(agentic_request)

        # Record retrieved evidence refs and rich safe metadata into active turn ledger
        from subagents.interview.customer_safe_projection import (
            GovernedEvidenceMetadata,
            get_active_turn_evidence_ledger,
            normalize_coverage_state,
            normalize_resolution_state,
        )
        ledger = get_active_turn_evidence_ledger()
        if ledger is not None and isinstance(result, Mapping):
            raw_cov = result.get("coverageState") or result.get("coverage_state")
            coverage_state = normalize_coverage_state(raw_cov) if raw_cov is not None else "READY"
            coverage_limitations = tuple(result.get("coverageNotes") or result.get("coverageLimitations") or ())

            # Process top-level evidenceRefs
            top_refs = list(result.get("evidenceRefs") or [])
            for ref in top_refs:
                ledger.record_metadata(
                    GovernedEvidenceMetadata(
                        evidence_ref=ref,
                        resolution_state=normalize_resolution_state(result.get("resolutionState") or result.get("resolution_state")),
                        coverage_state=coverage_state,
                        coverage_limitations=coverage_limitations,
                        safe_observation=str(result.get("summary") or result.get("label") or ""),
                    )
                )

            # Process node-level evidenceRefs
            if "nodes" in result:
                for node in result["nodes"]:
                    if isinstance(node, Mapping):
                        node_res = normalize_resolution_state(node.get("resolution_state") or node.get("resolutionState"))
                        node_label = str(node.get("label") or node.get("name") or "")
                        node_refs = list(node.get("evidence_refs") or node.get("evidenceRefs") or [])
                        for ref in node_refs:
                            ledger.record_metadata(
                                GovernedEvidenceMetadata(
                                    evidence_ref=ref,
                                    resolution_state=node_res,
                                    coverage_state=coverage_state,
                                    coverage_limitations=coverage_limitations,
                                    safe_observation=node_label,
                                )
                            )

            # Process edge-level evidenceRefs
            if "edges" in result:
                for edge in result["edges"]:
                    if isinstance(edge, Mapping):
                        edge_res = normalize_resolution_state(edge.get("resolution_state") or edge.get("resolutionState"))
                        edge_refs = list(edge.get("evidence_refs") or edge.get("evidenceRefs") or [])
                        for ref in edge_refs:
                            ledger.record_metadata(
                                GovernedEvidenceMetadata(
                                    evidence_ref=ref,
                                    resolution_state=edge_res,
                                    coverage_state=coverage_state,
                                    coverage_limitations=coverage_limitations,
                                )
                            )

        if isinstance(result, dict):
            return result
        return dict(result)

    base_url = (os.environ.get("NESTJS_API_BASE_URL") or "").rstrip("/")
    api_key = os.environ.get("WORKER_API_KEY") or ""
    if not base_url or not api_key:
        raise AgenticToolInvocationError("NESTJS_API_BASE_URL and WORKER_API_KEY are required for agentic tools.")

    correlation_id = request.correlation_id or str(uuid4())
    payload = {
        "tool_name": tool_name,
        "request_id": str(uuid4()),
        "assessment_id": request.assessment_id,
        "workflow_run_id": request.workflow_run_id or correlation_id,
        "user_id": request.user_id,
        "artifact_versions": request.artifact_versions,
        "scope": {},
        "budget": {"maxItems": 50, "maxDepth": 5, "maxBytes": 262144, "maxDurationMs": 30000},
        "input": request.input,
        "correlationId": correlation_id,
    }
    headers = {"X-Worker-Api-Key": api_key, "X-Correlation-Id": correlation_id}

    for attempt in range(3):
        try:
            response = httpx.post(
                f"{base_url}/internal/evidence/agentic-tools/dispatch",
                json=payload,
                headers=headers,
                timeout=30.0,
            )
        except httpx.RequestError as exc:
            if attempt == 2:
                raise AgenticToolInvocationError("Agentic tool request failed after 3 attempts.") from exc
            time.sleep(2**attempt)
            continue

        if response.status_code >= 500:
            if attempt == 2:
                raise AgenticToolInvocationError(f"Agentic tool returned server error {response.status_code}.")
            time.sleep(2**attempt)
            continue
        if response.status_code >= 400:
            raise AgenticToolInvocationError(f"Agentic tool returned client error {response.status_code}.")

        data = response.json()
        if isinstance(data, dict) and data.get("ok") is True:
            data = data.get("data")
        if not isinstance(data, dict):
            raise AgenticToolInvocationError("Agentic tool response was invalid.")
        return data

    raise AgenticToolInvocationError("Agentic tool request failed unexpectedly.")


def get_active_turn_evidence_ledger() -> Any:
    from subagents.interview.customer_safe_projection import get_active_turn_evidence_ledger as _fn
    return _fn()


def set_active_turn_evidence_ledger(ledger: Any) -> Any:
    from subagents.interview.customer_safe_projection import set_active_turn_evidence_ledger as _fn
    return _fn(ledger)


def reset_active_turn_evidence_ledger(token: Any) -> None:
    from subagents.interview.customer_safe_projection import reset_active_turn_evidence_ledger as _fn
    _fn(token)


__all__ = [
    "AgenticToolInvocationError",
    "AgenticToolRequest",
    "CorrelatedToolInput",
    "TrustedAgenticToolRequest",
    "ToolRuntime",
    "dispatch_agentic_tool",
    "get_active_turn_evidence_ledger",
    "reset_active_turn_evidence_ledger",
    "set_active_turn_evidence_ledger",
    "set_agentic_tool_api_client",
    "trusted_agentic_tool_request",
    "trusted_request_from_model_input",
]
