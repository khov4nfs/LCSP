"""Agent-facing authored tool for `inspect_data_path`."""

from __future__ import annotations

from typing import Any

from langchain.tools import ToolRuntime, tool
from pydantic import Field
from tools.common.runtime_envelope import (
    CorrelatedToolInput,
    dispatch_agentic_tool,
    trusted_request_from_model_input,
)


class InspectDataPathRequest(CorrelatedToolInput):
    subject_ref: str = Field(alias="subjectRef", min_length=1, max_length=240)
    source_ref: str | None = Field(default=None, alias="sourceRef")
    sink_ref: str | None = Field(default=None, alias="sinkRef")
    data_categories: list[str] = Field(default_factory=list, alias="dataCategories", max_length=50)
    max_depth: int = Field(default=5, alias="maxDepth", ge=1, le=20)


@tool(args_schema=InspectDataPathRequest)
def inspect_data_path(runtime: ToolRuntime | None = None, **request: Any) -> dict[str, Any]:
    """Inspect a bounded data path without inferring unsupported business or legal meaning.

    Args:
        request: Domain-specific data-path references and bounds.
    """
    return dispatch_agentic_tool(
        "inspect_data_path",
        trusted_request_from_model_input(InspectDataPathRequest.model_validate(request), runtime),
    )
