"""Gap requirement context tool."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.common.dispatch import LcspToolEnvelope, dispatch_lcsp_tool


@tool(args_schema=LcspToolEnvelope)
def get_gap_requirements(**request: Any) -> dict[str, Any]:
    """Fetch bounded compliance gap requirements for follow-up reasoning."""
    return dispatch_lcsp_tool(
        "get_gap_requirements",
        LcspToolEnvelope.model_validate(request),
    )
