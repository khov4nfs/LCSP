"""Agent-facing authored tool for `inspect_human_review_path`."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.common import LcspToolEnvelope, dispatch_lcsp_tool


@tool(args_schema=LcspToolEnvelope, parse_docstring=True)
def inspect_human_review_path(**request: Any) -> dict[str, Any]:
    """Inspect bounded human-review and override evidence for the active technical scope.

    Args:
        request: LCSP server-authorized tool envelope fields.
    """
    return dispatch_lcsp_tool(
        "inspect_human_review_path",
        LcspToolEnvelope.model_validate(request),
    )
