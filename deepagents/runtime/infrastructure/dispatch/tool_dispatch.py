"""Shared LCSP dispatch helpers for authored Managed Deep Agents tools."""

from __future__ import annotations

import os
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from runtime.platform.core.api_client import WorkerApiClient
from runtime.platform.core.config import load_config


class LcspToolEnvelope(BaseModel):
    """Common input envelope for LCSP server-authorized tools."""

    model_config = ConfigDict(extra="forbid")

    assessment_id: str = Field(description="LCSP assessment UUID.")
    organization_id: str = Field(description="LCSP organization/workspace UUID.")
    user_id: str = Field(description="User UUID responsible for this run.")
    workflow_run_id: str | None = Field(
        default=None,
        description="Durable LangGraph or LCSP workflow run ID.",
    )
    correlation_id: str | None = Field(
        default=None,
        description="Correlation ID for tracing and idempotency.",
    )
    artifact_versions: dict[str, Any] = Field(
        default_factory=dict,
        description="Pinned artifact references required by the target tool.",
    )
    input: dict[str, Any] = Field(
        default_factory=dict,
        description="Tool-specific input object.",
    )


def dispatch_lcsp_tool(tool_name: str, request: LcspToolEnvelope) -> dict[str, Any]:
    """Dispatch one LCSP tool through the existing server authority boundary."""
    correlation_id = request.correlation_id or str(uuid4())
    workflow_run_id = request.workflow_run_id or correlation_id
    payload = {
        "tool_name": tool_name,
        "request_id": str(uuid4()),
        "assessment_id": request.assessment_id,
        "workflow_run_id": workflow_run_id,
        "organization_id": request.organization_id,
        "user_id": request.user_id,
        "artifact_versions": request.artifact_versions,
        "scope": {},
        "budget": {
            "maxItems": 50,
            "maxDepth": 5,
            "maxBytes": 262144,
            "maxDurationMs": 30000,
        },
        "input": request.input,
        "correlationId": correlation_id,
    }
    return _api_client().dispatch_agentic_tool(payload)


def _api_client() -> WorkerApiClient:
    try:
        config = load_config()
        return WorkerApiClient(config.nestjs_api_base_url, config.worker_api_key)
    except RuntimeError:
        base_url = os.environ.get("NESTJS_API_BASE_URL")
        api_key = os.environ.get("WORKER_API_KEY")
        if not base_url or not api_key:
            raise
        return WorkerApiClient(base_url, api_key)
