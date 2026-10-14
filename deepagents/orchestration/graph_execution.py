"""Framework configuration for LCSP agents that run to a natural terminal outcome."""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from typing import Any

from deepagents.middleware import subagents

# LangGraph 1.2 requires a positive finite integer, and Deep Agents binds its own
# finite default. Use the maximum signed 32-bit integer (also exact in JSON/JS)
# as a practically unreachable technical ceiling, not a workload budget.
# This is independent of source, repository, rule, token and model-call counts.
# Explicit cancellation, native interrupts and provider failures remain operative.
LANGGRAPH_EFFECTIVELY_UNBOUNDED_RECURSION_LIMIT = (1 << 31) - 1
_active_recursion_limit: ContextVar[int | None] = ContextVar(
    "lcsp_agent_graph_recursion_limit", default=None
)


def agent_graph_config(
    config: Mapping[str, Any] | None = None,
    *,
    recursion_limit: int | None = None,
) -> dict[str, Any]:
    """Preserve runtime/checkpoint config with the caller's graph ceiling."""
    limit = recursion_limit
    if limit is None:
        limit = _active_recursion_limit.get()
    if limit is None:
        limit = LANGGRAPH_EFFECTIVELY_UNBOUNDED_RECURSION_LIMIT
    return {
        **(config or {}),
        "recursion_limit": limit,
    }


@contextmanager
def agent_graph_recursion_limit(limit: int) -> Iterator[None]:
    token = _active_recursion_limit.set(limit)
    try:
        yield
    finally:
        _active_recursion_limit.reset(token)


# Declarative task() delegates are compiled by this public Deep Agents factory.
# LangChain binds 9_999 to those child graphs, overriding the ambient parent
# config. Apply the same technical config after native compilation, including
# lazily compiled response-schema variants. Keep all native middleware,
# permissions, tools, state and delegation behavior intact.
_native_create_sub_agent = subagents.create_sub_agent


@wraps(_native_create_sub_agent)
def _create_sub_agent(*args: Any, **kwargs: Any) -> Any:
    return _native_create_sub_agent(*args, **kwargs).with_config(agent_graph_config())


subagents.create_sub_agent = _create_sub_agent
