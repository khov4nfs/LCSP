"""Optional MCP tool loading for LCSP Deep Agents.

Codebase Memory is intentionally provided inside the repository sandbox as the
`codebase-memory-graph` command so it indexes the exact assessment repository.
Remote MCP servers remain optional assistive tools and are not required for LCSP
startup.
"""

from __future__ import annotations

import asyncio
import os
import warnings
from typing import Any


MCP_SERVER_TARGETS: dict[str, str] = {
    "langchain_docs": "https://docs.langchain.com/mcp",
    "langchain_reference": "https://reference.langchain.com/mcp",
}
_MCP_ADAPTERS: list[Any] = []
_MCP_TOOLS: list[Any] | None = None


def load_optional_mcp_tools() -> list[Any]:
    """Load native LangChain MCP tools when explicitly enabled.

    Remote MCP discovery can perform network handshakes, so LCSP keeps it opt-in
    for local startup. Codebase Memory remains available inside the Docker
    sandbox independently of this remote-tool path.
    """
    global _MCP_TOOLS
    if os.getenv("LCSP_ENABLE_REMOTE_MCP", "").strip().lower() not in {
        "1",
        "true",
        "yes",
        "on",
    }:
        return []
    if _MCP_TOOLS is None:
        _MCP_TOOLS = asyncio.run(_load_mcp_tools())
    return list(_MCP_TOOLS)


async def _load_mcp_tools() -> list[Any]:
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=UserWarning, module="langchain.mcp")
        from langchain.mcp import MCPAdapter

    tools: list[Any] = []
    for target in MCP_SERVER_TARGETS.values():
        adapter = MCPAdapter(target)
        await adapter.__aenter__()
        _MCP_ADAPTERS.append(adapter)
        tools.extend(await adapter.list_tools())
    return tools


__all__ = ["MCP_SERVER_TARGETS", "load_optional_mcp_tools"]
