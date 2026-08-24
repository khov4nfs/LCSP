"""Classification review control tool."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.common.dispatch import LcspToolEnvelope, dispatch_lcsp_tool


@tool(args_schema=LcspToolEnvelope)
def submit_classification_for_independent_review(**request: Any) -> dict[str, Any]:
    """Submit a classification proposal for independent human review."""
    return dispatch_lcsp_tool(
        "submit_classification_for_independent_review",
        LcspToolEnvelope.model_validate(request),
    )
