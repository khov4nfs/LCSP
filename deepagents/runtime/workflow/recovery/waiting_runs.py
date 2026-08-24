"""Waiting run resume control tool."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.common.dispatch import LcspToolEnvelope, dispatch_lcsp_tool


@tool(args_schema=LcspToolEnvelope)
def resume_waiting_runs(**request: Any) -> dict[str, Any]:
    """Resume LCSP runs waiting for an activated legal corpus version."""
    return dispatch_lcsp_tool(
        "resume_waiting_runs",
        LcspToolEnvelope.model_validate(request),
    )
