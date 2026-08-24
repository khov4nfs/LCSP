"""Verified profile context tool."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.common.dispatch import LcspToolEnvelope, dispatch_lcsp_tool


@tool(args_schema=LcspToolEnvelope)
def get_verified_profile(**request: Any) -> dict[str, Any]:
    """Fetch the verified profile context for one LCSP assessment."""
    return dispatch_lcsp_tool(
        "get_verified_profile",
        LcspToolEnvelope.model_validate(request),
    )
