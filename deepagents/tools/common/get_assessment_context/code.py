"""Agent-facing authored tool for `get_assessment_context`."""

from __future__ import annotations

from typing import Any
import os
import time
from uuid import uuid4

import httpx
from langchain.tools import tool
from pydantic import BaseModel, ConfigDict, Field


class AgenticToolRequest(BaseModel):
    """Identity, pinned artifacts, and bounded input required by this tool."""

    model_config = ConfigDict(extra="forbid")

    assessment_id: str = Field(description="LCSP assessment UUID.")
    organization_id: str = Field(description="LCSP organization/workspace UUID.")
    user_id: str = Field(description="User UUID responsible for this run.")
    workflow_run_id: str | None = Field(default=None, description="Durable workflow run ID.")
    correlation_id: str | None = Field(default=None, description="Correlation ID for tracing.")
    artifact_versions: dict[str, Any] = Field(default_factory=dict, description="Pinned artifact references.")
    input: dict[str, Any] = Field(default_factory=dict, description="Tool-specific input object.")


class AgenticToolInvocationError(RuntimeError):
    """Raised when the trusted internal tool port cannot complete a request."""


def _dispatch_agentic_tool(tool_name: str, request: AgenticToolRequest) -> dict[str, Any]:
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
        "organization_id": request.organization_id,
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



@tool(args_schema=AgenticToolRequest, parse_docstring=True)
def get_assessment_context(**request: Any) -> dict[str, Any]:
    """Fetch bounded assessment and Wizard context for the active LCSP run.

    Args:
        request: LCSP server-authorized tool envelope fields.
    """
    return _dispatch_agentic_tool("get_assessment_context", AgenticToolRequest.model_validate(request))
