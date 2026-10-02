"""Limit which tools one agent role may see and call.

Deep Agents attaches filesystem, shell and ``task`` tools to every subagent. Some LCSP
roles must not read the repository at all (the Interview sees only the bounded
Customer-safe need and Customer context), so this middleware advertises only
the role's own tools and rejects any other tool name the model still emits.
"""

from __future__ import annotations

from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import ToolMessage


class AllowedToolsMiddleware(AgentMiddleware):
    """Advertise and execute only an explicit set of tool names."""

    def __init__(self, allowed: frozenset[str] | set[str] | tuple[str, ...]) -> None:
        super().__init__()
        self.allowed = frozenset(allowed)

    def wrap_model_call(self, request, handler):
        return handler(self._scoped(request))

    async def awrap_model_call(self, request, handler):
        return await handler(self._scoped(request))

    def wrap_tool_call(self, request, handler):
        rejected = self._rejected(request)
        return rejected if rejected is not None else handler(request)

    async def awrap_tool_call(self, request, handler):
        rejected = self._rejected(request)
        return rejected if rejected is not None else await handler(request)

    def _scoped(self, request):
        tools = [tool for tool in request.tools if _tool_name(tool) in self.allowed]
        return request.override(tools=tools)

    def _rejected(self, request) -> ToolMessage | None:
        call = getattr(request, "tool_call", None) or {}
        name = str(call.get("name") or "")
        if name in self.allowed:
            return None
        return ToolMessage(
            content=f"Tool '{name}' is not available to this agent.",
            tool_call_id=str(call.get("id") or ""),
            name=name,
            status="error",
        )


def _tool_name(tool: Any) -> str:
    if isinstance(tool, dict):
        return str(tool.get("name") or (tool.get("function") or {}).get("name") or "")
    return str(getattr(tool, "name", "") or "")


__all__ = ["AllowedToolsMiddleware"]
