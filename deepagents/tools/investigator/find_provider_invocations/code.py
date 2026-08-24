"""Agent-facing authored tool for `find_provider_invocations`."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.common import LcspToolEnvelope, dispatch_lcsp_tool


@tool(args_schema=LcspToolEnvelope, parse_docstring=True)
def find_provider_invocations(**request: Any) -> dict[str, Any]:
    """Find bounded AI provider/model invocation evidence in the Program Evidence Graph.

    Args:
        request: LCSP server-authorized tool envelope fields.
    """
    return dispatch_lcsp_tool(
        "find_provider_invocations",
        LcspToolEnvelope.model_validate(request),
    )
