"""Human-approved LCSP control tools for Managed Deep Agents."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.lcsp_dispatch import LcspToolEnvelope, dispatch_lcsp_tool


@tool(args_schema=LcspToolEnvelope)
def request_targeted_reanalysis(**request: Any) -> dict[str, Any]:
    """Request one targeted analyzer rerun over pinned technical evidence."""
    return dispatch_lcsp_tool(
        "request_targeted_reanalysis",
        LcspToolEnvelope.model_validate(request),
    )


@tool(args_schema=LcspToolEnvelope)
def resume_waiting_runs(**request: Any) -> dict[str, Any]:
    """Resume LCSP runs waiting for an activated legal corpus version."""
    return dispatch_lcsp_tool(
        "resume_waiting_runs",
        LcspToolEnvelope.model_validate(request),
    )


@tool(args_schema=LcspToolEnvelope)
def submit_classification_for_independent_review(**request: Any) -> dict[str, Any]:
    """Submit a classification proposal for independent human review."""
    return dispatch_lcsp_tool(
        "submit_classification_for_independent_review",
        LcspToolEnvelope.model_validate(request),
    )
