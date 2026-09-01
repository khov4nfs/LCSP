"""Agent-facing authored tool for `get_scan_coverage`."""

from __future__ import annotations

from typing import Any

from langchain.tools import ToolRuntime, tool
from pydantic import Field
from tools.common.runtime_envelope import (
    CorrelatedToolInput,
    dispatch_agentic_tool,
    trusted_request_from_model_input,
)


class ScanCoverageRequest(CorrelatedToolInput):
    scope_refs: list[str] = Field(default_factory=list, alias="scopeRefs", max_length=100)
    path_prefixes: list[str] = Field(default_factory=list, alias="pathPrefixes", max_length=50)
    include_unresolved_frontiers: bool = Field(
        default=True,
        alias="includeUnresolvedFrontiers",
    )
    max_results: int = Field(default=50, alias="maxResults", ge=1, le=200)


@tool(args_schema=ScanCoverageRequest)
def get_scan_coverage(runtime: ToolRuntime | None = None, **request: Any) -> dict[str, Any]:
    """Read deterministic scanner coverage and unresolved frontiers before planning.

    Args:
        request: Domain-specific coverage scope fields.
    """
    return dispatch_agentic_tool(
        "get_scan_coverage",
        trusted_request_from_model_input(ScanCoverageRequest.model_validate(request), runtime),
    )
