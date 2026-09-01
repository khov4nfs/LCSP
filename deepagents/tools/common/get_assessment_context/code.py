"""Agent-facing authored tool for `get_assessment_context`."""

from __future__ import annotations

from typing import Any

from langchain.tools import ToolRuntime, tool
from pydantic import Field
from tools.common.runtime_envelope import (
    CorrelatedToolInput,
    dispatch_agentic_tool,
    trusted_request_from_model_input,
)


class AssessmentContextRequest(CorrelatedToolInput):
    include: list[str] = Field(default_factory=list, max_length=20)
    fields: list[str] = Field(default_factory=list, max_length=50)


@tool(args_schema=AssessmentContextRequest)
def get_assessment_context(runtime: ToolRuntime | None = None, **request: Any) -> dict[str, Any]:
    """Fetch bounded assessment and Wizard context for the active LCSP run.

    Args:
        request: Domain-specific assessment context fields.
    """
    return dispatch_agentic_tool(
        "get_assessment_context",
        trusted_request_from_model_input(AssessmentContextRequest.model_validate(request), runtime),
    )
