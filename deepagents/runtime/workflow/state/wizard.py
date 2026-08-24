"""Wizard claim comparison tool."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.common.dispatch import LcspToolEnvelope, dispatch_lcsp_tool


@tool(args_schema=LcspToolEnvelope)
def compare_wizard_claim(**request: Any) -> dict[str, Any]:
    """Compare a wizard claim with pinned technical evidence and known conflicts."""
    return dispatch_lcsp_tool(
        "compare_wizard_claim",
        LcspToolEnvelope.model_validate(request),
    )
