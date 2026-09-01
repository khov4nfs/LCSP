"""Agent-facing authored tool for `get_symbol_context`."""

from __future__ import annotations

from typing import Any

from langchain.tools import ToolRuntime, tool
from pydantic import Field
from tools.common.runtime_envelope import (
    CorrelatedToolInput,
    dispatch_agentic_tool,
    trusted_request_from_model_input,
)


class SymbolContextRequest(CorrelatedToolInput):
    symbol_ref: str = Field(alias="symbolRef", min_length=1, max_length=240)
    include_callers: bool = Field(default=True, alias="includeCallers")
    include_callees: bool = Field(default=True, alias="includeCallees")
    max_bytes: int = Field(default=16_384, alias="maxBytes", ge=1, le=131_072)


@tool(args_schema=SymbolContextRequest)
def get_symbol_context(runtime: ToolRuntime | None = None, **request: Any) -> dict[str, Any]:
    """Read bounded structural context around one pinned symbol reference.

    Args:
        request: Domain-specific symbol reference and context bounds.
    """
    return dispatch_agentic_tool(
        "get_symbol_context",
        trusted_request_from_model_input(SymbolContextRequest.model_validate(request), runtime),
    )
