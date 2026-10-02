from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from tools.common.capabilities.platform.codebase_memory import (
    CodebaseMemoryIndexError,
    ensure_codebase_memory_index,
)
from tools.common.capabilities.platform.repository_sandbox import (
    activate_repository_backend,
)
from tools.common.codebase_memory_graph.code import (
    search_code_graph,
    trace_call_path,
)


class FakeSandbox:
    """Just enough of the sandbox shell to run the index lifecycle."""

    def __init__(self, *, marker: str | None, index_ok: bool = True):
        self.files: dict[str, str] = {}
        if marker is not None:
            self.files["/workspace/repository/.lcsp/repository.json"] = marker
        self.index_ok = index_ok
        self.indexed = False
        self.commands: list[str] = []

    def execute(self, command: str, *, timeout=None):
        self.commands.append(command)
        if command.startswith("cat "):
            path = command.split()[1].strip("'")
            return SimpleNamespace(output=self.files.get(path, ""), exit_code=0)
        if command.startswith("printf %s "):
            content, path = command[len("printf %s ") :].rsplit(" > ", 1)
            self.files[path.strip("'")] = content.strip("'")
            return SimpleNamespace(output="", exit_code=0)
        if " index_repository " in command:
            self.indexed = self.index_ok
            status = "indexed" if self.index_ok else "error"
            return SimpleNamespace(
                output=json.dumps({"status": status}, separators=(",", ":")),
                exit_code=0 if self.index_ok else 1,
            )
        if " list_projects " in command:
            listing = (
                "  workspace-repository /workspace/repository -"
                if self.indexed
                else "projects: 0"
            )
            return SimpleNamespace(output=listing, exit_code=0)
        return SimpleNamespace(output="graph-result", exit_code=0)


def test_first_dispatch_indexes_then_an_unchanged_snapshot_reuses_the_index() -> None:
    sandbox = FakeSandbox(marker='{"snapshotId":"s1"}')
    events: list[str] = []

    assert ensure_codebase_memory_index(sandbox, lifecycle=events.append)
    assert events == ["codebase_memory_indexing", "codebase_memory_indexed"]

    events.clear()
    index_runs = sum(" index_repository " in c for c in sandbox.commands)
    assert ensure_codebase_memory_index(sandbox, lifecycle=events.append)
    assert events == ["codebase_memory_index_reused"]
    assert sum(" index_repository " in c for c in sandbox.commands) == index_runs


def test_a_new_snapshot_is_reindexed() -> None:
    sandbox = FakeSandbox(marker='{"snapshotId":"s1"}')
    ensure_codebase_memory_index(sandbox)
    sandbox.files["/workspace/repository/.lcsp/repository.json"] = '{"snapshotId":"s2"}'
    events: list[str] = []

    ensure_codebase_memory_index(sandbox, lifecycle=events.append)

    assert events == ["codebase_memory_indexing", "codebase_memory_indexed"]


def test_failed_indexing_stops_the_dispatch_instead_of_running_without_the_graph() -> None:
    sandbox = FakeSandbox(marker='{"snapshotId":"s1"}', index_ok=False)
    events: list[str] = []

    with pytest.raises(CodebaseMemoryIndexError):
        ensure_codebase_memory_index(sandbox, lifecycle=events.append)
    assert events == ["codebase_memory_indexing", "codebase_memory_index_failed"]


def test_no_hydrated_repository_means_nothing_to_index() -> None:
    sandbox = FakeSandbox(marker=None)
    assert ensure_codebase_memory_index(sandbox) is False
    assert not any(" index_repository " in c for c in sandbox.commands)


def test_graph_tools_query_the_indexed_assessment_repository() -> None:
    sandbox = FakeSandbox(marker="{}")
    with activate_repository_backend(sandbox):
        assert search_code_graph.invoke({"name_pattern": ".*Consent.*"}) == "graph-result"
        trace_call_path.invoke({"function_name": "submit", "direction": "inbound"})

    search, trace = sandbox.commands[-2:]
    assert "codebase-memory-graph cli --quiet search_graph" in search
    assert '"project":"workspace-repository"' in search
    assert '"name_pattern":".*Consent.*"' in search
    assert "trace_path" in trace and '"direction":"inbound"' in trace
