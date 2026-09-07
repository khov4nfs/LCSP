"""Agent-facing authored tool for `search_program_graph`."""

from __future__ import annotations

from typing import Any

from langchain.tools import ToolRuntime, tool
from pydantic import Field
from tools.common.runtime_envelope import (
    CorrelatedToolInput,
    dispatch_agentic_tool,
    trusted_request_from_model_input,
)


class SearchProgramGraphRequest(CorrelatedToolInput):
    query: str | None = Field(default=None, max_length=1_000)
    path_prefixes: list[str] = Field(default_factory=list, alias="pathPrefixes", max_length=20)
    max_results: int = Field(default=10, alias="maxResults", ge=1, le=50)


@tool(args_schema=SearchProgramGraphRequest)
def search_program_graph(runtime: ToolRuntime | None = None, **request: Any) -> dict[str, Any]:
    """Search the pinned Program Evidence Graph and return bounded provenance-backed nodes.

    Args:
        request: Domain-specific Program Evidence Graph search fields.
    """
    return dispatch_agentic_tool(
        "search_evidence",
        trusted_request_from_model_input(SearchProgramGraphRequest.model_validate(request), runtime),
    )
