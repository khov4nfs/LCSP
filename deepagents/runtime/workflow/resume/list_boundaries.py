"""Managed boundary catalog tool."""

from __future__ import annotations

from langchain.tools import tool

from tools.common.managed.invocation import invocation_boundary_manifest


@tool
def list_lcsp_invocation_boundaries() -> tuple[dict[str, str], ...]:
    """List all LCSP invocation boundaries now exposed as agent boundaries."""
    return invocation_boundary_manifest()
