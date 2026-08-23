"""Managed Agent invocation boundaries for former LCSP queue consumers."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool
from pydantic import BaseModel, ConfigDict, Field

from lcsp_workers.managed.invocation import (
    invocation_boundary_manifest,
    invoke_boundary,
)


class LcspInvocationRequest(BaseModel):
    """Input for invoking one former queue consumer as an agent boundary."""

    model_config = ConfigDict(extra="forbid")

    boundary_name: str = Field(description="Managed invocation boundary name.")
    message: dict[str, Any] = Field(description="Consumer-compatible message body.")
    correlation_id: str = Field(description="Correlation ID for the invocation.")


@tool
def list_lcsp_invocation_boundaries() -> tuple[dict[str, str], ...]:
    """List all former LCSP queue consumers now exposed as agent boundaries."""
    return invocation_boundary_manifest()


@tool(args_schema=LcspInvocationRequest)
def invoke_lcsp_boundary(**request: Any) -> dict[str, Any]:
    """Invoke one LCSP boundary without starting a RabbitMQ worker process."""
    parsed = LcspInvocationRequest.model_validate(request)
    return invoke_boundary(
        parsed.boundary_name,
        parsed.message,
        parsed.correlation_id,
    )
