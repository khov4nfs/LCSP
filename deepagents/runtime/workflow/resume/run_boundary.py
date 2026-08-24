"""Managed boundary invocation tool."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.common.managed.invocation import invoke_boundary
from tools.invocation.schema import LcspInvocationRequest


@tool(args_schema=LcspInvocationRequest)
def invoke_lcsp_boundary(**request: Any) -> dict[str, Any]:
    """Invoke one LCSP boundary through Managed Deep Agents."""
    parsed = LcspInvocationRequest.model_validate(request)
    return invoke_boundary(
        parsed.boundary_name,
        parsed.message,
        parsed.correlation_id,
    )
