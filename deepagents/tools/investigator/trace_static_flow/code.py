"""Agent-facing authored tool for `trace_static_flow`."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.common import LcspToolEnvelope, dispatch_lcsp_tool


@tool(args_schema=LcspToolEnvelope, parse_docstring=True)
def trace_static_flow(**request: Any) -> dict[str, Any]:
    """Trace a bounded static flow from an evidence-backed graph reference.

    Args:
        request: LCSP server-authorized tool envelope fields.
    """
    return dispatch_lcsp_tool(
        "trace_static_flow",
        LcspToolEnvelope.model_validate(request),
    )
