"""Agent-facing authored tool for `retrieve_legal_basis`."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.common import LcspToolEnvelope, dispatch_lcsp_tool


@tool(args_schema=LcspToolEnvelope, parse_docstring=True)
def retrieve_legal_basis(**request: Any) -> dict[str, Any]:
    """Retrieve exact governed legal context and citation references for investigation.

    Args:
        request: LCSP server-authorized tool envelope fields.
    """
    return dispatch_lcsp_tool(
        "retrieve_legal_basis",
        LcspToolEnvelope.model_validate(request),
    )
