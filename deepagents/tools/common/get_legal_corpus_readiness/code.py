"""Agent-facing authored tool for `get_legal_corpus_readiness`."""

from __future__ import annotations

from typing import Any

from langchain.tools import ToolRuntime, tool
from pydantic import Field
from tools.common.runtime_envelope import (
    CorrelatedToolInput,
    dispatch_agentic_tool,
    trusted_request_from_model_input,
)


class LegalCorpusReadinessRequest(CorrelatedToolInput):
    include: list[str] = Field(default_factory=list, max_length=20)
    effective_date: str | None = Field(default=None, alias="effectiveDate")
    legal_corpus_version_id: str | None = Field(
        default=None,
        alias="legalCorpusVersionId",
    )


@tool(args_schema=LegalCorpusReadinessRequest)
def get_legal_corpus_readiness(runtime: ToolRuntime | None = None, **request: Any) -> dict[str, Any]:
    """Read approved legal-corpus readiness without mutating corpus state.

    Args:
        request: Domain-specific legal corpus readiness filters.
    """
    return dispatch_agentic_tool(
        "get_legal_corpus_readiness",
        trusted_request_from_model_input(
            LegalCorpusReadinessRequest.model_validate(request),
            runtime,
        ),
    )
