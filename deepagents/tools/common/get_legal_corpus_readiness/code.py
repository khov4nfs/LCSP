"""Agent-facing authored tool for `get_legal_corpus_readiness`."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.common import LcspToolEnvelope, dispatch_lcsp_tool


@tool(args_schema=LcspToolEnvelope, parse_docstring=True)
def get_legal_corpus_readiness(**request: Any) -> dict[str, Any]:
    """Read approved legal-corpus readiness without mutating corpus state.

    Args:
        request: LCSP server-authorized tool envelope fields.
    """
    return dispatch_lcsp_tool(
        "get_legal_corpus_readiness",
        LcspToolEnvelope.model_validate(request),
    )
