"""Agent-facing authored tool for `find_provider_invocations`."""

from __future__ import annotations

from typing import Any

from langchain.tools import ToolRuntime, tool
from pydantic import Field
from tools.common.runtime_envelope import (
    CorrelatedToolInput,
    dispatch_agentic_tool,
    trusted_request_from_model_input,
)


class ProviderInvocationsRequest(CorrelatedToolInput):
    provider: str | None = Field(default=None, max_length=120)
    model_id: str | None = Field(default=None, alias="modelId")
    path_prefixes: list[str] = Field(default_factory=list, alias="pathPrefixes", max_length=50)
    include_test_code: bool = Field(default=False, alias="includeTestCode")
    max_results: int = Field(default=20, alias="maxResults", ge=1, le=100)


@tool(args_schema=ProviderInvocationsRequest)
def find_provider_invocations(runtime: ToolRuntime | None = None, **request: Any) -> dict[str, Any]:
    """Find bounded AI provider/model invocation evidence in the Program Evidence Graph.

    Args:
        request: Domain-specific provider/model invocation search fields.
    """
    return dispatch_agentic_tool(
        "find_provider_invocations",
        trusted_request_from_model_input(
            ProviderInvocationsRequest.model_validate(request),
            runtime,
        ),
    )
