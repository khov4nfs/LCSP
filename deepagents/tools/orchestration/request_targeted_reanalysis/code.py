"""Agent-facing authored tool for `request_targeted_reanalysis`."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.common import LcspToolEnvelope, dispatch_lcsp_tool


@tool(args_schema=LcspToolEnvelope, parse_docstring=True)
def request_targeted_reanalysis(**request: Any) -> dict[str, Any]:
    """Request one allow-listed targeted analyzer rerun for a bounded pinned evidence scope.

    Args:
        request: LCSP server-authorized tool envelope fields.
    """
    return dispatch_lcsp_tool(
        "request_targeted_reanalysis",
        LcspToolEnvelope.model_validate(request),
    )
