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

from .repository_sandbox import REPOSITORIES_ROOT, REPOSITORY_META, REPOSITORY_ROOT, RepositoryPin

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
    """Business purpose: Report which Codebase Memory index this dispatch ensured, so graph tools query the right project.

    Business rules:
    - A multi-repository assessment has one index over its shared repositories root; any other assessment has the
      index of its one repository.
    - Nothing is reported for a dispatch that has not indexed a repository.

    Execution flow:
    1. Read the dispatch-local index registry.
    2. Return the ensured identity or no identity.

    Failure cases:
    - No identity means no index was ensured; callers fall back to the original project name.

    Side effects:
    - Reads a dispatch-local context variable only.
    """
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
    """Business purpose: Ensure the hydrated assessment repository is indexed in Codebase Memory so the Root agent can perform graph queries.

    Business rules:
    - If no repository is hydrated in the sandbox, return False without indexing.
    - If an existing index stamp matches the repository metadata stamp and the project is listed, reuse the index.
    - Reindex a changed repository marker, including a changed immutable source prefix, before graph investigation.
    - The indexing service owns its locks and process state; this boundary cannot infer that a lock is stale.

    Execution flow:
    1. Inspect the backend for executable capability and repository metadata stamp.
    2. Check existing index stamp; if identical and project is registered, set active index context and return True.
    3. Run one-shot index_repository CLI command in full mode without deleting service-owned lock state.
    4. Validate exit code and output for indexed status; update the index stamp and active context only after success.

    Failure cases:
    - Raises CodebaseMemoryIndexError if indexing fails or does not emit "status":"indexed"; lock contention preserves the prior index and stops dispatch.

    Side effects:
    - Emits lifecycle events, invokes sandbox indexing, writes the successful index stamp and sets the active index ContextVar; never deletes daemon locks or unrelated state.
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


def ensure_codebase_memory_set_index(
    backend: object,
    pins: list[RepositoryPin],
    *,
    lifecycle: CodebaseMemoryLifecycle | None = None,
) -> CodebaseMemoryIndexIdentity:
    """Business purpose: Index every repository of a multi-repository assessment as one graph, so a single query can
    follow code across repositories and every result path already names its repository.

    Business rules:
    - The shared repositories root is indexed as one project whose name is read from the engine listing by path, never
      guessed; each repository is a top-level directory named by its repository key.
    - The index is reused only when its stamp equals the combined repository markers and the project is registered;
      a changed snapshot, commit or source prefix of any repository re-indexes the set.
    - A repository that is not hydrated stops the run: a missing graph must never be silent.

    Execution flow:
    1. Read every repository marker and combine them into one stamp.
    2. Reuse a current index, otherwise index the shared root in full mode.
    3. Resolve the registered project, record the stamp and set the active index.

    Failure cases:
    - A missing marker, an indexing failure or an unregistered project raises CodebaseMemoryIndexError before model work.

    Side effects:
    - Emits lifecycle events, invokes sandbox indexing, writes the successful stamp and sets the active index.
    """
    execute = getattr(backend, "execute", None)
    if not callable(execute):
        raise CodebaseMemoryIndexError("repository sandbox cannot run Codebase Memory")
    markers: list[str] = []
    for pin in pins:
        marker = _output(execute(f"cat {shlex.quote(pin.marker_path)} 2>/dev/null"))
        if not marker:
            raise CodebaseMemoryIndexError(
                f"repository {pin.key} is not hydrated, so it cannot be indexed"
            )
        markers.append(marker)
    combined = "\n".join(markers)
    stamp = _output(execute(f"cat {shlex.quote(_INDEX_STAMP)} 2>/dev/null"))
    listing = _output(execute(codebase_memory_cli("list_projects", {})))
    project = _project_for_path(listing, REPOSITORIES_ROOT)
    if stamp == combined and project is not None:
        identity = CodebaseMemoryIndexIdentity(project, _stamp_hash(combined), True)
        _ACTIVE_INDEX.set(identity)
        _emit(lifecycle, "codebase_memory_index_reused")
        return identity

    _emit(lifecycle, "codebase_memory_indexing")
    result = execute(
        codebase_memory_cli("index_repository", {"repo_path": REPOSITORIES_ROOT, "mode": "full"}),
        timeout=None,
    )
    output = _output(result)
    if getattr(result, "exit_code", 1) != 0 or '"status":"indexed"' not in output:
        _emit(lifecycle, "codebase_memory_index_failed")
        raise CodebaseMemoryIndexError(
            "Codebase Memory could not index the assessment repositories"
            + (f": {output[-500:]}" if output else "")
        )
    listing = _output(execute(codebase_memory_cli("list_projects", {})))
    project = _project_for_path(listing, REPOSITORIES_ROOT)
    if project is None:
        raise CodebaseMemoryIndexError(
            "Codebase Memory did not register a project for the assessment repositories"
        )
    execute(f"printf %s {shlex.quote(combined)} > {shlex.quote(_INDEX_STAMP)}")
    identity = CodebaseMemoryIndexIdentity(project, _stamp_hash(combined), False)
    _ACTIVE_INDEX.set(identity)
    _emit(lifecycle, "codebase_memory_indexed")
    return identity


def _project_for_path(listing: str, path: str) -> str | None:
    """Business purpose: Find the Codebase Memory project the engine registered for a repository directory.

    Business rules:
    - The directory column must match exactly, so a repository whose path prefixes another can never claim its project.
    - The project name always comes from the engine listing, never from a guessed naming rule.

    Execution flow:
    1. Split each listing line into columns.
    2. Return the project of the first line whose path column equals the repository path.

    Failure cases:
    - No match returns no project; the caller treats the repository as not indexed.

    Side effects:
    - Pure computation: it reads no sandbox state and writes nothing.
    """
    for line in listing.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[1] == path:
            return parts[0]
    return None


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
    "ensure_codebase_memory_set_index",
]
