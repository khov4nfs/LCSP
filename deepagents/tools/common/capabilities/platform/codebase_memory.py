"""Deterministic Codebase Memory index of the hydrated assessment repository.

The sandbox ships the pinned upstream Codebase Memory MCP engine as the
``codebase-memory-graph`` command. Agents query its graph through typed tools
(see ``tools.common.codebase_memory_graph``); those queries
are only useful once the exact hydrated repository has been indexed, so every
dispatch ensures that here instead of hoping an agent runs the indexer itself.

The index is stamped with the repository hydration marker, so a new snapshot is
always re-indexed and an unchanged one is reused.
"""

from __future__ import annotations

import hashlib
import json
import shlex
from collections.abc import Callable, Mapping
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

from .repository_sandbox import REPOSITORY_META, REPOSITORY_ROOT

CODEBASE_MEMORY_COMMAND = "codebase-memory-graph"
CODEBASE_MEMORY_PROJECT = "workspace-repository"
_INDEX_STAMP = "/workspace/runtime/codebase-memory/lcsp-index-stamp.json"

CodebaseMemoryLifecycle = Callable[[str], None]


def codebase_memory_cli(tool: str, arguments: Mapping[str, Any]) -> str:
    """Shell command running one Codebase Memory tool in one-shot CLI mode."""
    return (
        f"{CODEBASE_MEMORY_COMMAND} cli --quiet {shlex.quote(tool)} "
        f"{shlex.quote(json.dumps(dict(arguments), separators=(',', ':')))}"
    )


@dataclass(frozen=True)
class CodebaseMemoryIndexIdentity:
    """Durable identity of the index a dispatch runs against (no sandbox paths)."""

    project_id: str
    index_stamp: str
    reused: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "codebaseMemoryProjectId": self.project_id,
            "codebaseMemoryIndexStamp": self.index_stamp,
            "codebaseMemoryIndexReused": self.reused,
        }


_ACTIVE_INDEX: ContextVar[CodebaseMemoryIndexIdentity | None] = ContextVar(
    "lcsp_codebase_memory_index", default=None
)


def active_codebase_memory_index() -> CodebaseMemoryIndexIdentity | None:
    """The index identity the current dispatch ensured, if any."""
    return _ACTIVE_INDEX.get()


def _stamp_hash(marker: str) -> str:
    return "sha256:" + hashlib.sha256(marker.encode("utf-8")).hexdigest()


class CodebaseMemoryIndexError(RuntimeError):
    """The hydrated repository could not be indexed for graph queries."""


def ensure_codebase_memory_index(
    backend: object,
    *,
    lifecycle: CodebaseMemoryLifecycle | None = None,
) -> bool:
    """Index the hydrated repository unless the current snapshot already is.

    Returns False when no repository is hydrated in this sandbox (boundaries
    that do not work on source). Raises CodebaseMemoryIndexError when indexing
    fails, so a dispatch never silently runs without the graph.
    """
    execute = getattr(backend, "execute", None)
    if not callable(execute):
        return False
    marker = _output(execute(f"cat {shlex.quote(REPOSITORY_META)} 2>/dev/null"))
    if not marker:
        return False
    stamp = _output(execute(f"cat {shlex.quote(_INDEX_STAMP)} 2>/dev/null"))
    if stamp == marker and _project_indexed(execute):
        _ACTIVE_INDEX.set(
            CodebaseMemoryIndexIdentity(CODEBASE_MEMORY_PROJECT, _stamp_hash(marker), True)
        )
        _emit(lifecycle, "codebase_memory_index_reused")
        return True

    _emit(lifecycle, "codebase_memory_indexing")
    result = execute(
        codebase_memory_cli(
            "index_repository",
            {"repo_path": REPOSITORY_ROOT, "mode": "full"},
        ),
        timeout=None,
    )
    output = _output(result)
    if getattr(result, "exit_code", 1) != 0 or '"status":"indexed"' not in output:
        _emit(lifecycle, "codebase_memory_index_failed")
        raise CodebaseMemoryIndexError(
            "Codebase Memory could not index the assessment repository"
            + (f": {output[-500:]}" if output else "")
        )
    execute(
        f"printf %s {shlex.quote(marker)} > {shlex.quote(_INDEX_STAMP)}"
    )
    _ACTIVE_INDEX.set(
        CodebaseMemoryIndexIdentity(CODEBASE_MEMORY_PROJECT, _stamp_hash(marker), False)
    )
    _emit(lifecycle, "codebase_memory_indexed")
    return True


def _project_indexed(execute: Callable[..., Any]) -> bool:
    listing = _output(execute(codebase_memory_cli("list_projects", {})))
    return f"{CODEBASE_MEMORY_PROJECT} {REPOSITORY_ROOT}" in listing


def _output(result: Any) -> str:
    return str(getattr(result, "output", "") or "").strip()


def _emit(lifecycle: CodebaseMemoryLifecycle | None, event: str) -> None:
    if lifecycle is not None:
        lifecycle(event)


__all__ = [
    "CODEBASE_MEMORY_COMMAND",
    "CODEBASE_MEMORY_PROJECT",
    "CodebaseMemoryIndexError",
    "CodebaseMemoryIndexIdentity",
    "active_codebase_memory_index",
    "codebase_memory_cli",
    "ensure_codebase_memory_index",
]
