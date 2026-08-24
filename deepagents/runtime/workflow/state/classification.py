"""Classification context tools."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.common.dispatch import LcspToolEnvelope, dispatch_lcsp_tool


@tool(args_schema=LcspToolEnvelope)
def get_classification_baseline(**request: Any) -> dict[str, Any]:
    """Fetch the current classification baseline for an assessment."""
    return dispatch_lcsp_tool(
        "get_classification_baseline",
        LcspToolEnvelope.model_validate(request),
    )


@tool(args_schema=LcspToolEnvelope)
def get_legal_rule_match(**request: Any) -> dict[str, Any]:
    """Fetch matched legal rules for a bounded assessment scope."""
    return dispatch_lcsp_tool(
        "get_legal_rule_match",
        LcspToolEnvelope.model_validate(request),
    )
