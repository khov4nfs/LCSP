"""Agent-facing authored tool for `inspect_data_path`."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.common import LcspToolEnvelope, dispatch_lcsp_tool


@tool(args_schema=LcspToolEnvelope, parse_docstring=True)
def inspect_data_path(**request: Any) -> dict[str, Any]:
    """Inspect a bounded data path without inferring unsupported business or legal meaning.

    Args:
        request: LCSP server-authorized tool envelope fields.
    """
    return dispatch_lcsp_tool(
        "inspect_data_path",
        LcspToolEnvelope.model_validate(request),
    )
