"""Agent-facing authored tool for `inspect_decision_path`."""

from __future__ import annotations

from typing import Any, Literal

from langchain.tools import ToolRuntime, tool
from pydantic import Field
from tools.common.runtime_envelope import (
    CorrelatedToolInput,
    dispatch_agentic_tool,
    trusted_request_from_model_input,
)


class InspectDecisionPathRequest(CorrelatedToolInput):
    subject_ref: str | None = Field(default=None, alias="subjectRef", max_length=240)
    start_ref: str | None = Field(default=None, alias="startRef", max_length=240)
    action_categories: list[Literal["SCORE", "RANK", "RECOMMEND", "APPROVE", "REJECT", "STATUS_CHANGE"]] = Field(default_factory=list, alias="actionCategories", max_length=6)
    max_hops: int = Field(default=5, alias="maxHops", ge=1, le=20)
    max_results: int = Field(default=20, alias="maxResults", ge=1, le=100)


@tool(args_schema=InspectDecisionPathRequest)
def inspect_decision_path(runtime: ToolRuntime | None = None, **request: Any) -> dict[str, Any]:
    """Inspect structural decision influence evidence without producing a legal conclusion.

    Args:
        request: Domain-specific decision-path references and bounds.
    """
    return dispatch_agentic_tool(
        "inspect_decision_path",
        trusted_request_from_model_input(
            InspectDecisionPathRequest.model_validate(request),
            runtime,
        ),
    )
