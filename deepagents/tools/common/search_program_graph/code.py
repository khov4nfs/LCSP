"""Agent-facing authored tool for `search_program_graph`."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.common import LcspToolEnvelope, dispatch_lcsp_tool


@tool(args_schema=LcspToolEnvelope, parse_docstring=True)
def search_program_graph(**request: Any) -> dict[str, Any]:
    """Search the pinned Program Evidence Graph and return bounded provenance-backed nodes.

    Args:
        request: LCSP server-authorized tool envelope fields.
    """
    return dispatch_lcsp_tool(
        "search_evidence",
        LcspToolEnvelope.model_validate(request),
    )
