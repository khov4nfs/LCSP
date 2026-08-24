"""Agent-facing authored tool for `get_scan_coverage`."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.common import LcspToolEnvelope, dispatch_lcsp_tool


@tool(args_schema=LcspToolEnvelope, parse_docstring=True)
def get_scan_coverage(**request: Any) -> dict[str, Any]:
    """Read deterministic scanner coverage and unresolved frontiers before planning.

    Args:
        request: LCSP server-authorized tool envelope fields.
    """
    return dispatch_lcsp_tool(
        "get_scan_coverage",
        LcspToolEnvelope.model_validate(request),
    )
