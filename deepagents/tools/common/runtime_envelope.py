"""Trusted runtime overlay for LCSP authored agentic tools."""

from __future__ import annotations

from typing import Any
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


def dispatch_agentic_tool(tool_name: str, request: TrustedAgenticToolRequest) -> dict[str, Any]:
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


__all__ = [
    "AgenticToolInvocationError",
    "AgenticToolRequest",
    "CorrelatedToolInput",
    "TrustedAgenticToolRequest",
    "ToolRuntime",
    "dispatch_agentic_tool",
    "trusted_agentic_tool_request",
    "trusted_request_from_model_input",
]
