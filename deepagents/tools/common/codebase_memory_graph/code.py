"""Typed Codebase Memory graph tools over the indexed assessment repository.

Every dispatch indexes the hydrated repository before agents start (see
``tools.common.capabilities.platform.codebase_memory``). These tools expose that
graph directly, so agents navigate structure — definitions, callers/callees,
architecture — instead of reconstructing it from repeated grep and file reads.
Direct repository source stays authoritative for every claim.
"""

from __future__ import annotations

import json
from typing import Any, Literal

from langchain.tools import tool
from pydantic import ConfigDict, Field

from tools.common.capabilities.platform.codebase_memory import (
    CODEBASE_MEMORY_PROJECT,
    codebase_memory_cli,
)
from tools.common.capabilities.platform.repository_sandbox import (
    current_repository_backend,
)
from tools.common.runtime_envelope import RuntimeInjectedInput

_MAX_OUTPUT_CHARS = 12_000


def _run(tool_name: str, arguments: dict[str, Any]) -> str:
    backend = current_repository_backend()
    execute = getattr(backend, "execute", None)
    if not callable(execute):
        return "Codebase Memory graph is unavailable: no repository sandbox is active."
    payload = {"project": CODEBASE_MEMORY_PROJECT}
    payload.update({key: value for key, value in arguments.items() if value is not None})
    result = execute(codebase_memory_cli(tool_name, payload))
    output = str(getattr(result, "output", "") or "").strip()
    if getattr(result, "exit_code", 1) != 0:
        return f"Codebase Memory {tool_name} failed: {output[-2_000:]}"
    if len(output) > _MAX_OUTPUT_CHARS:
        return output[:_MAX_OUTPUT_CHARS] + "\n[truncated; narrow the query]"
    return output or "(no results)"


class SearchCodeGraphRequest(RuntimeInjectedInput):
    model_config = ConfigDict(extra="forbid")

    name_pattern: str | None = Field(
        default=None, description="Regex over symbol names, e.g. '.*Consent.*'."
    )
    qn_pattern: str | None = Field(
        default=None,
        description="Regex over qualified names (module path + symbol).",
    )
    label: str | None = Field(
        default=None,
        description="Node label filter: Function, Method, Class, Interface, Route, File, Module.",
    )
    limit: int = Field(default=20, ge=1, le=100)


@tool(args_schema=SearchCodeGraphRequest)
def search_code_graph(
    name_pattern: str | None = None,
    qn_pattern: str | None = None,
    label: str | None = None,
    limit: int = 20,
) -> str:
    """Find functions, classes, routes and files in the indexed repository graph.

    Use this first to locate where a concept is implemented, instead of grepping.
    Returns qualified names with file and line ranges.
    """
    return _run(
        "search_graph",
        {
            "name_pattern": name_pattern,
            "qn_pattern": qn_pattern,
            "label": label,
            "limit": limit,
        },
    )


class TraceCallPathRequest(RuntimeInjectedInput):
    model_config = ConfigDict(extra="forbid")

    function_name: str = Field(
        description="Exact function/method name or qualified name from search_code_graph."
    )
    direction: Literal["inbound", "outbound", "both"] = "both"
    depth: int = Field(default=3, ge=1, le=6)


@tool(args_schema=TraceCallPathRequest)
def trace_call_path(
    function_name: str,
    direction: Literal["inbound", "outbound", "both"] = "both",
    depth: int = 3,
) -> str:
    """Trace who calls a function (inbound) and what it calls (outbound).

    Use this to follow a data or control path — e.g. whether AI output passes
    through a review, validation or redaction step — across files.
    """
    return _run(
        "trace_path",
        {"function_name": function_name, "direction": direction, "depth": depth},
    )


class SearchCodeTextRequest(RuntimeInjectedInput):
    model_config = ConfigDict(extra="forbid")

    pattern: str = Field(description="Text or regex to find in source.")
    limit: int = Field(default=20, ge=1, le=100)


@tool(args_schema=SearchCodeTextRequest)
def search_code_text(pattern: str, limit: int = 20) -> str:
    """Graph-augmented text search: matches grouped by the enclosing symbol."""
    return _run("search_code", {"pattern": pattern, "limit": limit})


class GetArchitectureRequest(RuntimeInjectedInput):
    model_config = ConfigDict(extra="forbid")

    aspects: list[str] = Field(
        default_factory=lambda: ["all"],
        description="Aspects such as 'all', 'languages', 'packages', 'entry_points', 'routes'.",
    )


@tool(args_schema=GetArchitectureRequest)
def get_repository_architecture(aspects: list[str] | None = None) -> str:
    """Summarise the repository's architecture: languages, packages, entry points, routes."""
    return _run("get_architecture", {"aspects": aspects or ["all"]})


CODEBASE_MEMORY_GRAPH_TOOLS = [
    search_code_graph,
    trace_call_path,
    search_code_text,
    get_repository_architecture,
]

CODEBASE_MEMORY_GRAPH_GUIDANCE = (
    "The repository is already indexed into a Codebase Memory graph. Navigate it "
    "with the graph tools first: search_code_graph to locate implementations, "
    "trace_call_path to follow callers/callees across files, "
    "search_code_text for text matches grouped by symbol, and "
    "get_repository_architecture for an overview. Use grep/read_file only to "
    "confirm details the graph points you to; direct source wins on conflict."
)
