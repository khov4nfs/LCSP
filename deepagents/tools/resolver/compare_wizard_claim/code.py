"""Agent-facing authored tool for `compare_wizard_claim`."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.common import LcspToolEnvelope, dispatch_lcsp_tool


@tool(args_schema=LcspToolEnvelope, parse_docstring=True)
def compare_wizard_claim(**request: Any) -> dict[str, Any]:
    """Compare one Wizard claim with pinned technical evidence and surface conflicts.

    Args:
        request: LCSP server-authorized tool envelope fields.
    """
    return dispatch_lcsp_tool(
        "compare_wizard_claim",
        LcspToolEnvelope.model_validate(request),
    )
