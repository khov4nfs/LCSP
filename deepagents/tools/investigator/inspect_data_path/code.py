"""Agent-facing authored tool for `inspect_data_path`."""

from __future__ import annotations

from typing import Any, Literal

from langchain.tools import ToolRuntime, tool
from pydantic import Field
from tools.common.runtime_envelope import (
    CorrelatedToolInput,
    dispatch_agentic_tool,
    trusted_request_from_model_input,
)


class InspectDataPathRequest(CorrelatedToolInput):
    subject_ref: str | None = Field(default=None, alias="subjectRef", max_length=240)
    start_ref: str | None = Field(default=None, alias="startRef", max_length=240)
    direction: Literal["FORWARD", "BACKWARD"] = Field(default="FORWARD")
    max_hops: int = Field(default=5, alias="maxHops", ge=1, le=20)
    max_results: int = Field(default=20, alias="maxResults", ge=1, le=100)


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
