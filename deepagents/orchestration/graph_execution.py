"""Framework configuration for LCSP agents that run to a natural terminal outcome."""

from __future__ import annotations

from collections.abc import Mapping
from functools import wraps
from typing import Any

from deepagents.middleware import subagents

# LangGraph 1.2 requires a positive finite integer, and Deep Agents binds its own
# finite default. Use the maximum signed 32-bit integer (also exact in JSON/JS)
# as a practically unreachable technical ceiling, not a workload budget.
# This is independent of source, repository, rule, token and model-call counts.
# Explicit cancellation, native interrupts and provider failures remain operative.
LANGGRAPH_EFFECTIVELY_UNBOUNDED_RECURSION_LIMIT = (1 << 31) - 1
def agent_graph_config(config: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Preserve runtime/checkpoint config with the infrastructure ceiling.

    Business purpose: Retain native runtime/checkpoint configuration while avoiding a workload-based graph recursion cutoff.

    Business rules:
    - Override only recursion_limit with the existing positive finite infrastructure ceiling; cancellation, interrupts and provider failures remain active.

    Execution flow:
    1. Copy the supplied configuration and set the common effectively-unbounded recursion limit.

    Failure cases:
    - An absent or falsey configuration becomes an empty mapping; truthy invalid non-mapping inputs fail during mapping expansion.

    Side effects:
    - None: returns a new configuration dictionary without executing or modifying a graph.
    """
    return {
        **(config or {}),
        "recursion_limit": LANGGRAPH_EFFECTIVELY_UNBOUNDED_RECURSION_LIMIT,
    }


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
