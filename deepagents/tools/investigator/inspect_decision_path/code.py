"""Agent-facing authored tool for `inspect_decision_path`."""

from __future__ import annotations

from typing import Any

from langchain.tools import ToolRuntime, tool
from pydantic import Field
from tools.common.runtime_envelope import (
    CorrelatedToolInput,
    dispatch_agentic_tool,
    trusted_request_from_model_input,
)


class InspectDecisionPathRequest(CorrelatedToolInput):
    subject_ref: str = Field(alias="subjectRef", min_length=1, max_length=240)
    decision_ref: str | None = Field(default=None, alias="decisionRef")
    influence_refs: list[str] = Field(default_factory=list, alias="influenceRefs", max_length=50)
    max_depth: int = Field(default=5, alias="maxDepth", ge=1, le=20)
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
