"""Assessment context tool."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.common.dispatch import LcspToolEnvelope, dispatch_lcsp_tool


@tool(args_schema=LcspToolEnvelope)
def get_assessment_context(**request: Any) -> dict[str, Any]:
    """Fetch bounded assessment, wizard, and artifact context for reasoning."""
    return dispatch_lcsp_tool(
        "get_assessment_context",
        LcspToolEnvelope.model_validate(request),
    )
