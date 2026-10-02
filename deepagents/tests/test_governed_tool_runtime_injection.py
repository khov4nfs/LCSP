"""Registry-level invariant: every registered strict tool schema tolerates the injected ToolRuntime.

Deep Agents' ToolNode merges the injected ``runtime`` into tool args before explicit
``args_schema`` validation. A strict (extra="forbid") schema that does not inherit
``RuntimeInjectedInput`` rejects it, and every live call of that tool fails. This test
walks the tools actually registered on the product subagents (not a hand-kept list), so a
new strict tool cannot silently reintroduce the bug.
"""

from __future__ import annotations

import inspect

import pytest
from pydantic import BaseModel

from subagents import FLOW_SUBAGENTS
from tools.common.codebase_memory_graph import CODEBASE_MEMORY_GRAPH_TOOLS
from tools.common.runtime_envelope import RuntimeInjectedInput


def _registered_tools():
    seen = {}
    for spec in FLOW_SUBAGENTS:
        for tool in spec.get("tools") or ():
            seen[getattr(tool, "name", repr(tool))] = tool
    # The scan job's AI-discovery agent registers the Codebase Memory tools directly.
    for tool in CODEBASE_MEMORY_GRAPH_TOOLS:
        seen[tool.name] = tool
    return sorted(seen.items())


def _receives_injected_runtime(tool) -> bool:
    func = getattr(tool, "func", None) or getattr(tool, "coroutine", None)
    return func is not None and "runtime" in inspect.signature(func).parameters


def _strict_schema(tool):
    # Only tools whose function takes the injected ToolRuntime get it merged into args.
    if not _receives_injected_runtime(tool):
        return None
    schema = getattr(tool, "args_schema", None)
    if isinstance(schema, type) and issubclass(schema, BaseModel):
        if schema.model_config.get("extra") == "forbid":
            return schema
    return None


STRICT = [(name, _strict_schema(tool)) for name, tool in _registered_tools() if _strict_schema(tool)]


def test_registry_is_not_empty() -> None:
    names = {name for name, _ in _registered_tools()}
    assert {"submit_rule_assessment", "cite_repository_source"} <= names


@pytest.mark.parametrize("name,schema", STRICT, ids=[name for name, _ in STRICT])
def test_strict_registered_schema_inherits_runtime_injected_input(name, schema) -> None:
    assert issubclass(schema, RuntimeInjectedInput), (
        f"{name}: strict args_schema must inherit RuntimeInjectedInput or every live call "
        "fails on the injected ToolRuntime"
    )


@pytest.mark.parametrize("name,schema", STRICT, ids=[name for name, _ in STRICT])
def test_model_authored_runtime_dict_is_still_rejected(name, schema) -> None:
    # Only a real ToolRuntime is stripped; a model-authored "runtime" field stays forbidden.
    with pytest.raises(Exception):
        schema.model_validate({"runtime": {"forged": True}})
