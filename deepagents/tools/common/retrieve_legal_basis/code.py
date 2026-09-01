"""Agent-facing authored tool for `retrieve_legal_basis`."""

from __future__ import annotations

from typing import Any

from langchain.tools import ToolRuntime, tool
from pydantic import Field
from tools.common.runtime_envelope import (
    CorrelatedToolInput,
    dispatch_agentic_tool,
    trusted_request_from_model_input,
)


class RetrieveLegalBasisRequest(CorrelatedToolInput):
    query: str | None = Field(default=None, max_length=1_000)
    legal_rule_ids: list[str] = Field(
        default_factory=list,
        alias="legalRuleIds",
        max_length=100,
    )
    chunk_ids: list[str] = Field(default_factory=list, alias="chunkIds", max_length=100)
    include: list[str] = Field(default_factory=list, max_length=20)
    max_results: int = Field(default=10, alias="maxResults", ge=1, le=50)


@tool(args_schema=RetrieveLegalBasisRequest)
def retrieve_legal_basis(runtime: ToolRuntime | None = None, **request: Any) -> dict[str, Any]:
    """Retrieve exact governed legal context and citation references for investigation.

    Args:
        request: Domain-specific retrieval query and bounded include fields.
    """
    return dispatch_agentic_tool(
        "retrieve_legal_basis",
        trusted_request_from_model_input(
            RetrieveLegalBasisRequest.model_validate(request),
            runtime,
        ),
    )
