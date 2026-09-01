"""Agent-facing authored tool for `trace_static_flow`."""

from __future__ import annotations

from typing import Any

from langchain.tools import ToolRuntime, tool
from pydantic import Field
from tools.common.runtime_envelope import (
    CorrelatedToolInput,
    dispatch_agentic_tool,
    trusted_request_from_model_input,
)


class TraceStaticFlowRequest(CorrelatedToolInput):
    start_ref: str = Field(alias="startRef", min_length=1, max_length=240)
    target_ref: str | None = Field(default=None, alias="targetRef")
    edge_types: list[str] = Field(default_factory=list, alias="edgeTypes", max_length=50)
    max_depth: int = Field(default=5, alias="maxDepth", ge=1, le=20)
    max_results: int = Field(default=20, alias="maxResults", ge=1, le=100)


@tool(args_schema=TraceStaticFlowRequest)
def trace_static_flow(runtime: ToolRuntime | None = None, **request: Any) -> dict[str, Any]:
    """Trace a bounded static flow from an evidence-backed graph reference.

    Args:
        request: Domain-specific static-flow references and bounds.
    """
    return dispatch_agentic_tool(
        "trace_static_flow",
        trusted_request_from_model_input(TraceStaticFlowRequest.model_validate(request), runtime),
    )
