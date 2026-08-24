"""Legal corpus context tools."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.common.dispatch import LcspToolEnvelope, dispatch_lcsp_tool


@tool(args_schema=LcspToolEnvelope)
def get_legal_corpus_readiness(**request: Any) -> dict[str, Any]:
    """Fetch legal corpus readiness and activation context."""
    return dispatch_lcsp_tool(
        "get_legal_corpus_readiness",
        LcspToolEnvelope.model_validate(request),
    )


@tool(args_schema=LcspToolEnvelope)
def retrieve_legal_basis(**request: Any) -> dict[str, Any]:
    """Retrieve approved legal basis and citation candidates for a query."""
    return dispatch_lcsp_tool(
        "retrieve_legal_basis",
        LcspToolEnvelope.model_validate(request),
    )


@tool(args_schema=LcspToolEnvelope)
def validate_citation_set(**request: Any) -> dict[str, Any]:
    """Validate that proposed citations map to approved corpus evidence."""
    return dispatch_lcsp_tool(
        "validate_citation_set",
        LcspToolEnvelope.model_validate(request),
    )
