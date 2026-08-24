"""Targeted reanalysis control tool."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.common.dispatch import LcspToolEnvelope, dispatch_lcsp_tool


@tool(args_schema=LcspToolEnvelope)
def request_targeted_reanalysis(**request: Any) -> dict[str, Any]:
    """Request one targeted analyzer rerun over pinned technical evidence."""
    return dispatch_lcsp_tool(
        "request_targeted_reanalysis",
        LcspToolEnvelope.model_validate(request),
    )
