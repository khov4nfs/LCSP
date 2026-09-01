"""Agent-facing authored tool for `request_targeted_reanalysis`."""

from __future__ import annotations

from typing import Any

from langchain.tools import ToolRuntime, tool
from pydantic import Field
from tools.common.runtime_envelope import (
    CorrelatedToolInput,
    dispatch_agentic_tool,
    trusted_request_from_model_input,
)


class TargetedReanalysisRequest(CorrelatedToolInput):
    analyzer_id: str = Field(alias="analyzerId", min_length=1, max_length=160)
    scope_refs: list[str] = Field(default_factory=list, alias="scopeRefs", max_length=100)
    reason: str = Field(min_length=1, max_length=1_000)
    idempotency_key: str | None = Field(default=None, alias="idempotencyKey")


@tool(args_schema=TargetedReanalysisRequest)
def request_targeted_reanalysis(runtime: ToolRuntime | None = None, **request: Any) -> dict[str, Any]:
    """Request one allow-listed targeted analyzer rerun for a bounded pinned evidence scope.

    Args:
        request: Domain-specific analyzer and bounded evidence scope fields.
    """
    return dispatch_agentic_tool(
        "request_targeted_reanalysis",
        trusted_request_from_model_input(
            TargetedReanalysisRequest.model_validate(request),
            runtime,
        ),
    )
