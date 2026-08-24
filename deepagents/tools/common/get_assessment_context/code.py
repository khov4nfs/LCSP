"""Agent-facing authored tool for `get_assessment_context`."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.common import LcspToolEnvelope, dispatch_lcsp_tool


@tool(args_schema=LcspToolEnvelope, parse_docstring=True)
def get_assessment_context(**request: Any) -> dict[str, Any]:
    """Fetch bounded assessment and Wizard context for the active LCSP run.

    Args:
        request: LCSP server-authorized tool envelope fields.
    """
    return dispatch_lcsp_tool(
        "get_assessment_context",
        LcspToolEnvelope.model_validate(request),
    )
