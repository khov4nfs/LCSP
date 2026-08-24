"""Agent-facing authored tool for `get_symbol_context`."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.common import LcspToolEnvelope, dispatch_lcsp_tool


@tool(args_schema=LcspToolEnvelope, parse_docstring=True)
def get_symbol_context(**request: Any) -> dict[str, Any]:
    """Read bounded structural context around one pinned symbol reference.

    Args:
        request: LCSP server-authorized tool envelope fields.
    """
    return dispatch_lcsp_tool(
        "get_symbol_context",
        LcspToolEnvelope.model_validate(request),
    )
