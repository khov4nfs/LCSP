"""Agent-facing authored tool for `inspect_human_review_path`."""

from __future__ import annotations

from typing import Any

from langchain.tools import ToolRuntime, tool
from pydantic import Field
from tools.common.runtime_envelope import (
    CorrelatedToolInput,
    dispatch_agentic_tool,
    trusted_request_from_model_input,
)


class InspectHumanReviewPathRequest(CorrelatedToolInput):
    subject_ref: str = Field(alias="subjectRef", min_length=1, max_length=240)
    review_refs: list[str] = Field(default_factory=list, alias="reviewRefs", max_length=50)
    include_override_paths: bool = Field(default=True, alias="includeOverridePaths")
    max_depth: int = Field(default=5, alias="maxDepth", ge=1, le=20)
    max_results: int = Field(default=20, alias="maxResults", ge=1, le=100)


@tool(args_schema=InspectHumanReviewPathRequest)
def inspect_human_review_path(runtime: ToolRuntime | None = None, **request: Any) -> dict[str, Any]:
    """Inspect bounded human-review and override evidence for the active technical scope.

    Args:
        request: Domain-specific human-review references and bounds.
    """
    return dispatch_agentic_tool(
        "inspect_human_review_path",
        trusted_request_from_model_input(
            InspectHumanReviewPathRequest.model_validate(request),
            runtime,
        ),
    )
