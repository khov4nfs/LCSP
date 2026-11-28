"""Assessment repository as the persistent working database for Deep Agents."""

from __future__ import annotations

import io
import hashlib
import json
import re
import shlex
import tarfile
import tempfile
import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Iterator, Mapping

from deepagents.backends.protocol import (
    BackendProtocol,
    DeleteResult,
    EditResult,
    FileDownloadResponse,
    FileUploadResponse,
    GlobResult,
    GrepResult,
    LsResult,
    SandboxBackendProtocol,
    WriteResult,
)
from langgraph.config import get_config
from tools.common.capabilities.platform.config import load_config
from tools.common.capabilities.platform.docker_sandbox import DockerSandboxManager
from tools.common.capabilities.platform.logging import get_logger
from tools.common.capabilities.platform.repository_snapshot_client import (
    RepositoryArchiveRequest,
    RepositorySnapshotClient,
    RepositoryTreePathManifest,
)
from tools.common.capabilities.platform.repository_workspace import RepositoryWorkspace

_LOGGER = get_logger(__name__)


REPOSITORY_ROOT = "/workspace/repository"
REPOSITORY_META = f"{REPOSITORY_ROOT}/.lcsp/repository.json"
REPOSITORY_AGENT_STATE = f"{REPOSITORY_ROOT}/.lcsp/agent"
_ARCHIVE_PATH = "/tmp/lcsp-assessment-repository.tar.gz"
# A multi-repository assessment keeps every pinned repository side by side under one root, one directory per
# repository key. The agent sees that root as "/", so every path starts with "/<repositoryKey>/".
REPOSITORIES_ROOT = "/workspace/repositories"
REPOSITORY_SET_META = f"{REPOSITORIES_ROOT}/.lcsp/repository-set.json"
REPOSITORIES_AGENT_STATE = f"{REPOSITORIES_ROOT}/.lcsp/agent"
_REPOSITORY_KEY_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
_COMMIT_PATTERN = re.compile(r"^[0-9a-fA-F]{40,64}$")
_RESERVED_REPOSITORY_DIRS = {".git", ".lcsp"}
_MAX_SOURCE_SCOPE_EXCLUSION_SAMPLES = 100
_ACTIVE_BACKEND: ContextVar[object | None] = ContextVar(
    "lcsp_repository_thread_backend",
    default=None,
)
_DOCKER_SANDBOX_MANAGER = DockerSandboxManager()
RepositoryHydrationLifecycle = Callable[[str], None]

_SOURCE_PATH_EDGE_WHITESPACE = " \t\n\v\f\r\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


def _canonical_source_path(value: object, *, maximum_length: int | None = None) -> bool:
    """Business purpose: Recognize an unambiguous repository-relative source path.

    Business rules:
    - Preserve literal interior spaces and Unicode; never trim, decode or normalize a supplied path.
    - Reject empty, absolute, traversal, repeated-separator and cross-platform ambiguous forms.
    - The optional limit uses UTF-16 code units to match the shared JavaScript contract.

    Execution flow:
    1. Verify the path type, length and canonical characters.
    2. Require every slash-delimited segment to name a real repository path component.

    Failure cases:
    - Noncanonical input returns false without resolving or accessing a filesystem.

    Side effects:
    - Pure validation; does not read, write or authorize source content.
    """
    if not isinstance(value, str) or not value or value != value.strip(_SOURCE_PATH_EDGE_WHITESPACE):
        return False
    if maximum_length is not None and len(value.encode("utf-16-le", errors="surrogatepass")) // 2 > maximum_length:
        return False
    if re.search(r"[\x00-\x1f\x7f\\\\:%]", value):
        return False
    return all(segment not in {"", ".", ".."} for segment in value.split("/"))


def validate_source_path_prefix(value: object) -> str | None:
    """Business purpose: Bind the runtime to the API's immutable source selection.

    Business rules:
    - Null selects the full repository for existing assessments.
    - A scoped selection is an exact canonical repository path of at most 1,024 UTF-16 code units.

    Execution flow:
    1. Retain null or validate the supplied source prefix without transforming it.
    2. Return the exact prefix used by hydration, evidence and checkpoint guards.

    Failure cases:
    - Invalid types or ambiguous paths raise before source materialization or evidence access.

    Side effects:
    - Pure validation; does not change snapshot identity or customer approval.
    """
    if value is None:
        return None
    if not _canonical_source_path(value, maximum_length=1024):
        raise ValueError("sourcePathPrefix must be a canonical repository-relative path")
    return value


def source_path_in_scope(path: str, source_path_prefix: str | None) -> bool:
    """Business purpose: Keep source observations within the immutable assessment selection.

    Business rules:
    - A prefix matches itself or descendants at a slash boundary, never similarly named siblings.
    - Whole-repository scope is represented by a dot only for a null prefix.

    Execution flow:
    1. Reject noncanonical source paths except the explicitly allowed full-repository dot.
    2. Compare the path to the exact selected prefix and its descendants.

    Failure cases:
    - Malformed or out-of-scope paths return false before a caller reads or accepts source.

    Side effects:
    - Pure comparison; neither fetches source nor records evidence.
    """
    if path == ".":
        return source_path_prefix is None
    if not _canonical_source_path(path):
        return False
    return source_path_prefix is None or path == source_path_prefix or path.startswith(source_path_prefix + "/")


@dataclass(frozen=True)
class RepositoryLayout:
    """Where the agent filesystem root lives in the sandbox and where agent scratch state is allowed."""

    root: str
    agent_state: str
    multi: bool


def _single_layout() -> RepositoryLayout:
    """Business purpose: Describe the original single-repository filesystem layout.

    Business rules:
    - One pinned repository keeps the original root and agent-state directory, so running assessments and their checkpoints are unaffected.
    - The layout is read from the module constants at call time, so a relocated root is honoured.

    Execution flow:
    1. Read the repository root and agent-state constants.
    2. Return them as the single-repository layout.

    Failure cases:
    - No failure path.

    Side effects:
    - Pure computation: it reads no sandbox state and writes nothing.
    """
    return RepositoryLayout(REPOSITORY_ROOT, REPOSITORY_AGENT_STATE, False)


SINGLE_REPOSITORY_LAYOUT = _single_layout()
MULTI_REPOSITORY_LAYOUT = RepositoryLayout(REPOSITORIES_ROOT, REPOSITORIES_AGENT_STATE, True)


@dataclass(frozen=True)
class RepositoryPin:
    """One immutable repository snapshot pinned to the assessment (mirrors the API's repository pin)."""

    key: str
    ordinal: int
    snapshot_id: str
    scan_job_id: str
    commit_sha: str
    source_path_prefix: str | None
    repository_id: str = ""
    full_name: str = ""

    @property
    def root(self) -> str:
        """Business purpose: Locate a pinned repository directory in the multi-repository layout.

        Business rules:
        - The directory is named by the validated repository key, so a pin can never choose another path.

        Execution flow:
        1. Join the shared repositories root with the key.

        Failure cases:
        - No failure path: keys are validated when the pin is created.

        Side effects:
        - Pure computation: it reads no sandbox state and writes nothing.
        """
        return f"{REPOSITORIES_ROOT}/{self.key}"

    @property
    def marker_path(self) -> str:
        """Business purpose: Locate the runtime marker that proves what is hydrated in a pinned repository directory.

        Business rules:
        - The marker sits inside the repository directory in the runtime-owned metadata folder.

        Execution flow:
        1. Join the repository directory with the marker location.

        Failure cases:
        - No failure path.

        Side effects:
        - Pure computation: it reads no sandbox state and writes nothing.
        """
        return f"{self.root}/.lcsp/repository.json"


def repository_pins_from_context(context: Mapping[str, Any]) -> list[RepositoryPin]:
    """Business purpose: Read the repositories the API pinned to this assessment, in pin order.

    Business rules:
    - The API's ``repositories`` list is authoritative; a context without it describes one repository through
      the legacy scalar fields and is read as a set of one.
    - Keys must be valid, unique repository slugs and every commit a full hash, so a malformed context can never
      choose a sandbox directory or an unpinned commit.
    - The primary pin (ordinal 0) must agree with the legacy scalar fields.

    Execution flow:
    1. Use the repository list when present, otherwise wrap the scalar pin.
    2. Validate each pin and reject duplicates.

    Failure cases:
    - Malformed, duplicated or inconsistent pins raise ValueError before any sandbox access.

    Side effects:
    - Pure validation; creates no sandbox state.
    """
    listed = context.get("repositories")
    if not isinstance(listed, list) or not listed:
        pin = RepositoryPin(
            key="",
            ordinal=0,
            snapshot_id=str(context["repositorySnapshotId"]),
            scan_job_id=str(context["repositoryScanJobId"]),
            commit_sha=str(context["repositoryCommit"]),
            source_path_prefix=validate_source_path_prefix(context.get("sourcePathPrefix")),
            repository_id=str(context.get("repositoryId") or ""),
            full_name=str(context.get("repositoryFullName") or ""),
        )
        return [pin]
    pins: list[RepositoryPin] = []
    seen: set[str] = set()
    for index, item in enumerate(listed):
        if not isinstance(item, Mapping):
            raise ValueError("repository pin must be an object")
        key = item.get("repositoryKey")
        commit = item.get("repositoryCommit")
        if not isinstance(key, str) or not _REPOSITORY_KEY_PATTERN.fullmatch(key):
            raise ValueError("repository pin has an invalid repositoryKey")
        if key in seen:
            raise ValueError("repository pins must have unique repository keys")
        if not isinstance(commit, str) or not _COMMIT_PATTERN.fullmatch(commit):
            raise ValueError("repository pin has an invalid repositoryCommit")
        seen.add(key)
        pins.append(
            RepositoryPin(
                key=key,
                ordinal=int(item.get("ordinal", index)),
                snapshot_id=str(item["repositorySnapshotId"]),
                scan_job_id=str(item["repositoryScanJobId"]),
                commit_sha=commit.lower(),
                source_path_prefix=validate_source_path_prefix(item.get("sourcePathPrefix")),
                repository_id=str(item.get("repositoryId") or ""),
                full_name=str(item.get("repositoryFullName") or ""),
            )
        )
    pins.sort(key=lambda pin: pin.ordinal)
    if [pin.ordinal for pin in pins] != list(range(len(pins))):
        raise ValueError("repository pin ordinals must be consecutive from zero")
    if pins[0].snapshot_id != str(context.get("repositorySnapshotId", pins[0].snapshot_id)):
        raise ValueError("primary repository pin does not match the context repository snapshot")
    return pins


def repository_set_digest(pins: list[RepositoryPin]) -> str:
    """Business purpose: Prove the whole pinned repository set is unchanged, byte for byte like the API.

    Business rules:
    - The canonical form is the compact JSON of ``[key, snapshotId, lower-cased commit, prefix]`` per pin in
      ordinal order, shared with the TypeScript contract through common test vectors.

    Execution flow:
    1. Order the pins and serialise each tuple without whitespace or ASCII escaping.
    2. Return the prefixed SHA-256 of the UTF-8 text.

    Failure cases:
    - An empty set raises ValueError; an assessment without repositories has no digest.

    Side effects:
    - Pure calculation.
    """
    if not pins:
        raise ValueError("repository set digest requires at least one pin")
    canonical = json.dumps(
        [
            [pin.key, pin.snapshot_id, pin.commit_sha.lower(), pin.source_path_prefix]
            for pin in sorted(pins, key=lambda item: item.ordinal)
        ],
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def repository_layout_for(pins: list[RepositoryPin]) -> RepositoryLayout:
    """Business purpose: Choose the sandbox layout for the pinned repositories of an assessment.

    Business rules:
    - One repository keeps the original layout; several are mounted side by side, one directory per repository key.

    Execution flow:
    1. Count the pins.
    2. Return the matching layout.

    Failure cases:
    - No failure path; an empty set is rejected earlier by pin validation.

    Side effects:
    - Pure computation: it reads no sandbox state and writes nothing.
    """
    return MULTI_REPOSITORY_LAYOUT if len(pins) > 1 else _single_layout()


class AssessmentRepositoryBackend(SandboxBackendProtocol):
    """Expose the assessment repository itself as the Deep Agent filesystem root.

    The physical directory is /workspace/repository in the LCSP-owned sandbox.
    Agent-facing / means the repository root, and shell commands execute with
    the repository as their working directory, matching a coding CLI checkout.
    """

    def __init__(
        self, backend: object, layout: RepositoryLayout | None = None
    ) -> None:
        self._backend = backend
        self.layout = layout or _single_layout()

    @property
    def id(self) -> str:
        backend_id = getattr(self._backend, "id", "repository-sandbox")
        return f"{backend_id}:assessment-repository"

    def _real(self, path: str) -> str:
        """Business purpose: Translate an agent path into its sandbox path under the active layout.

        Business rules:
        - The agent addresses files through one filesystem root; every path is translated into the sandbox using the active repository layout.
        - A path can never escape the layout root, and results are translated back so the agent never sees sandbox-internal paths.

        Execution flow:
        1. Resolve the path against the layout root.

        Failure cases:
        - Paths that escape the root raise ValueError before reaching the sandbox.

        Side effects:
        - Pure computation: it reads no sandbox state and writes nothing.
        """
        return _real_path(path, self.layout.root)

    def _virtual(self, path: str) -> str:
        """Business purpose: Translate a sandbox path back into the agent-facing path.

        Business rules:
        - The agent addresses files through one filesystem root; every path is translated into the sandbox using the active repository layout.
        - A path can never escape the layout root, and results are translated back so the agent never sees sandbox-internal paths.

        Execution flow:
        1. Strip the layout root from the sandbox path.

        Failure cases:
        - A path outside the layout root raises RuntimeError rather than leaking a sandbox-internal path.

        Side effects:
        - Pure computation: it reads no sandbox state and writes nothing.
        """
        return _virtual_path(path, self.layout.root)

    def _virtual_info(self, item: Mapping[str, Any]) -> dict[str, Any]:
        """Business purpose: Translate the path inside one file listing entry back into the agent-facing path.

        Business rules:
        - The agent addresses files through one filesystem root; every path is translated into the sandbox using the active repository layout.
        - A path can never escape the layout root, and results are translated back so the agent never sees sandbox-internal paths.

        Execution flow:
        1. Copy the entry.
        2. Replace its path with the agent-facing path.

        Failure cases:
        - A path outside the layout root raises RuntimeError.

        Side effects:
        - Pure computation: it reads no sandbox state and writes nothing.
        """
        return _virtual_file_info(item, self.layout.root)

    def ls(self, path: str) -> LsResult:
        """Business purpose: List a directory of the assessment repositories for the agent.

        Business rules:
        - The agent addresses files through one filesystem root; every path is translated into the sandbox using the active repository layout.
        - A path can never escape the layout root, and results are translated back so the agent never sees sandbox-internal paths.

        Execution flow:
        1. Translate the path.
        2. List it in the sandbox.
        3. Translate every entry back.

        Failure cases:
        - Sandbox errors are returned in the result and never raised.

        Side effects:
        - Read-only sandbox access.
        """
        result = self._backend.ls(self._real(path))
        if result.entries is None:
            return LsResult(error=result.error)
        return LsResult(
            error=result.error,
            entries=[self._virtual_info(item) for item in result.entries],
        )

    def read(self, file_path: str, offset: int = 0, limit: int = 2000):
        """Business purpose: Read a file of the assessment repositories for the agent.

        Business rules:
        - The agent addresses files through one filesystem root; every path is translated into the sandbox using the active repository layout.
        - A path can never escape the layout root, and results are translated back so the agent never sees sandbox-internal paths.

        Execution flow:
        1. Translate the path.
        2. Read the requested line window from the sandbox.

        Failure cases:
        - A missing or unreadable file is reported by the sandbox result.

        Side effects:
        - Read-only sandbox access.
        """
        return self._backend.read(self._real(file_path), offset=offset, limit=limit)

    def grep(
        self,
        pattern: str,
        path: str | None = None,
        glob: str | None = None,
        *,
        max_count: int | None = None,
    ) -> GrepResult:
        """Business purpose: Search file contents across the assessment repositories for the agent.

        Business rules:
        - The agent addresses files through one filesystem root; every path is translated into the sandbox using the active repository layout.
        - A path can never escape the layout root, and results are translated back so the agent never sees sandbox-internal paths.

        Execution flow:
        1. Translate the search root.
        2. Search in the sandbox, honouring an optional match limit.
        3. Translate every match path back.

        Failure cases:
        - Sandbox errors and truncation are returned in the result.

        Side effects:
        - Read-only sandbox access.
        """
        real_path = self._real(path or "/")
        kwargs = {"max_count": max_count} if max_count is not None else {}
        try:
            result = self._backend.grep(pattern, real_path, glob, **kwargs)
        except TypeError:
            result = self._backend.grep(pattern, real_path, glob)
        if result.matches is None:
            return GrepResult(error=result.error, truncated=result.truncated)
        matches = []
        for item in result.matches:
            copy = dict(item)
            copy["path"] = self._virtual(str(item["path"]))
            matches.append(copy)
        return GrepResult(
            error=result.error,
            matches=matches,
            truncated=result.truncated,
        )

    def glob(self, pattern: str, path: str | None = None) -> GlobResult:
        """Business purpose: Find files by pattern across the assessment repositories for the agent.

        Business rules:
        - The agent addresses files through one filesystem root; every path is translated into the sandbox using the active repository layout.
        - A path can never escape the layout root, and results are translated back so the agent never sees sandbox-internal paths.

        Execution flow:
        1. Translate the search root.
        2. Match in the sandbox.
        3. Translate every match back.

        Failure cases:
        - Sandbox errors and truncation are returned in the result.

        Side effects:
        - Read-only sandbox access.
        """
        result = self._backend.glob(pattern, self._real(path or "/"))
        if result.matches is None:
            return GlobResult(
                error=result.error,
                truncated=result.truncated,
                truncation_reason=result.truncation_reason,
            )
        return GlobResult(
            error=result.error,
            matches=[self._virtual_info(item) for item in result.matches],
            truncated=result.truncated,
            truncation_reason=result.truncation_reason,
        )

    def write(self, file_path: str, content: str) -> WriteResult:
        """Business purpose: Write a file on behalf of the agent.

        Business rules:
        - The agent addresses files through one filesystem root; every path is translated into the sandbox using the active repository layout.
        - A path can never escape the layout root, and results are translated back so the agent never sees sandbox-internal paths.
        - Whether the write is allowed is decided by the runtime backend permissions, not here.

        Execution flow:
        1. Translate the path.
        2. Write through the sandbox.
        3. Translate the resulting path back.

        Failure cases:
        - Sandbox errors are returned in the result.

        Side effects:
        - Writes one file in the sandbox.
        """
        result = self._backend.write(self._real(file_path), content)
        return WriteResult(
            error=result.error,
            path=self._virtual(result.path) if result.path else None,
        )

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ) -> EditResult:
        """Business purpose: Edit a file on behalf of the agent.

        Business rules:
        - The agent addresses files through one filesystem root; every path is translated into the sandbox using the active repository layout.
        - A path can never escape the layout root, and results are translated back so the agent never sees sandbox-internal paths.
        - Whether the edit is allowed is decided by the runtime backend permissions, not here.

        Execution flow:
        1. Translate the path.
        2. Apply the replacement in the sandbox.
        3. Translate the resulting path back.

        Failure cases:
        - Sandbox errors are returned in the result.

        Side effects:
        - Modifies one file in the sandbox.
        """
        result = self._backend.edit(
            self._real(file_path),
            old_string,
            new_string,
            replace_all=replace_all,
        )
        return EditResult(
            error=result.error,
            path=self._virtual(result.path) if result.path else None,
            occurrences=result.occurrences,
        )

    def delete(self, file_path: str) -> DeleteResult:
        """Business purpose: Delete a file on behalf of the agent.

        Business rules:
        - The agent addresses files through one filesystem root; every path is translated into the sandbox using the active repository layout.
        - A path can never escape the layout root, and results are translated back so the agent never sees sandbox-internal paths.
        - Whether the deletion is allowed is decided by the runtime backend permissions, not here.

        Execution flow:
        1. Translate the path.
        2. Delete in the sandbox.
        3. Translate the resulting path back.

        Failure cases:
        - Sandbox errors are returned in the result.

        Side effects:
        - Removes one file in the sandbox.
        """
        result = self._backend.delete(self._real(file_path))
        return DeleteResult(
            error=result.error,
            path=self._virtual(result.path) if result.path else None,
        )

    def upload_files(
        self,
        files: list[tuple[str, bytes]],
    ) -> list[FileUploadResponse]:
        """Business purpose: Upload files on behalf of the agent.

        Business rules:
        - The agent addresses files through one filesystem root; every path is translated into the sandbox using the active repository layout.
        - A path can never escape the layout root, and results are translated back so the agent never sees sandbox-internal paths.
        - Results keep the order and the agent-facing paths of the request.

        Execution flow:
        1. Translate every destination path.
        2. Upload through the sandbox.
        3. Pair each result with its requested path.

        Failure cases:
        - A rejected file reports its own error without affecting the others.

        Side effects:
        - Writes the uploaded files in the sandbox.
        """
        requested = [path for path, _ in files]
        translated = [(self._real(path), content) for path, content in files]
        results = self._backend.upload_files(translated)
        return [
            FileUploadResponse(path=requested[index], error=result.error)
            for index, result in enumerate(results)
        ]

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        """Business purpose: Download files for the agent or for runtime evidence checks.

        Business rules:
        - The agent addresses files through one filesystem root; every path is translated into the sandbox using the active repository layout.
        - A path can never escape the layout root, and results are translated back so the agent never sees sandbox-internal paths.
        - Results keep the order and the agent-facing paths of the request.

        Execution flow:
        1. Translate every path.
        2. Download from the sandbox.
        3. Pair each result with its requested path.

        Failure cases:
        - A missing file reports its own error without affecting the others.

        Side effects:
        - Read-only sandbox access.
        """
        results = self._backend.download_files([self._real(path) for path in paths])
        return [
            FileDownloadResponse(
                path=paths[index],
                content=result.content,
                error=result.error,
            )
            for index, result in enumerate(results)
        ]

    def execute(self, command: str, *, timeout: int | None = None):
        """Business purpose: Run a shell command with the shared repository root as its working directory.

        Business rules:
        - Commands start at the layout root: inside the repository for one repository, at the shared root for several.
        - The command text itself is never rewritten.

        Execution flow:
        1. Prefix the command with a change of directory to the layout root.
        2. Run it in the sandbox with the optional timeout.

        Failure cases:
        - A backend that does not accept a timeout is retried without one; command failures are returned in the result.

        Side effects:
        - Executes a command in the sandbox.
        """
        scoped = f"cd {shlex.quote(self.layout.root)} && {command}"
        if timeout is not None:
            try:
                return self._backend.execute(scoped, timeout=timeout)
            except TypeError:
                return self._backend.execute(scoped)
        return self._backend.execute(scoped)


def resolve_repository_thread_backend(config: object | None) -> object:
    """Resolve the LCSP Docker sandbox backend for the current durable thread."""
    return _DOCKER_SANDBOX_MANAGER.resolve(config)


class RuntimeRepositoryFilesystemBackend(BackendProtocol):
    """Late-bind permission-governed file tools without exposing shell execution."""

    def __init__(self, *, read_only_repository: bool = False) -> None:
        """Business purpose: Configure the runtime file backend's repository mutation boundary.

        Business rules:
        - Existing callers remain writable by default for compatibility.
        - Read-only callers may mutate only canonical paths inside agent state.

        Execution flow:
        1. Store whether this backend enforces the pinned-source write boundary.

        Failure cases:
        - This configuration step performs no path access and cannot authorize a path by itself.

        Side effects:
        - Stores one in-memory policy flag; it does not access the repository or change files.
        """
        self._read_only_repository = read_only_repository

    @property
    def id(self) -> str:
        return "lcsp-runtime-repository"

    def _backend(self) -> AssessmentRepositoryBackend:
        active = current_repository_backend()
        if active is not None:
            return repository_database_backend(active)
        backend = resolve_repository_thread_backend(get_config())
        return repository_database_backend(backend)

    def ls(self, path: str) -> LsResult:
        return self._backend().ls(path)

    def read(self, file_path: str, offset: int = 0, limit: int = 2000):
        return self._backend().read(file_path, offset=offset, limit=limit)

    def grep(
        self,
        pattern: str,
        path: str | None = None,
        glob: str | None = None,
        *,
        max_count: int | None = None,
    ) -> GrepResult:
        return self._backend().grep(pattern, path, glob, max_count=max_count)

    def glob(self, pattern: str, path: str | None = None) -> GlobResult:
        return self._backend().glob(pattern, path)

    def _write_path_error(self, path: str) -> str | None:
        """Business purpose: Enforce the opt-in repository mutation boundary for filesystem
        operations.

        Business rules:
        - Legacy backends accept their existing paths.
        - Read-only backends allow only canonical paths under `REPOSITORY_AGENT_STATE`.
        - Path traversal and malformed values are rejected without reaching the sandbox backend.

        Execution flow:
        1. Return immediately when the caller retains legacy writable behavior.
        2. Canonicalize the requested path through `_real_path` and compare it with the agent-state
           root.
        3. Return a typed-result error message for malformed or out-of-scope paths.

        Failure cases:
        - Invalid, traversing, or repository-source paths return a stable error string instead of
          raising or mutating data.

        Side effects:
        - Pure path authorization check; it does not resolve the backend or perform filesystem I/O.
        """
        if not self._read_only_repository:
            return None
        if not isinstance(path, str):
            return "Invalid repository path; use a path inside the agent-state directory."
        active = current_repository_backend()
        layout = (
            active.layout
            if isinstance(active, AssessmentRepositoryBackend)
            else _single_layout()
        )
        try:
            real_path = _real_path(path, layout.root)
        except (AttributeError, TypeError, ValueError):
            return "Invalid repository path; use a path inside the agent-state directory."
        if real_path == layout.agent_state or real_path.startswith(
            layout.agent_state + "/"
        ):
            return None
        return "Pinned repository is read-only; only agent-state paths may be changed."

    def write(self, file_path: str, content: str) -> WriteResult:
        """Business purpose: Write an agent file while protecting a pinned repository snapshot.

        Business rules:
        - Read-only mode permits writes only inside the canonical agent-state subtree.
        - The default mode preserves legacy callers.

        Execution flow:
        1. Validate the path when the read-only boundary is enabled.
        2. Return an error result for invalid or protected paths, otherwise delegate the write.

        Failure cases:
        - Rejected paths return `WriteResult.error`; sandbox failures retain the backend's error.

        Side effects:
        - Persists content only at an authorized path in read-only mode.
        """
        error = self._write_path_error(file_path)
        if error:
            return WriteResult(error=error)
        return self._backend().write(file_path, content)

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ) -> EditResult:
        """Business purpose: Edit an agent file while protecting a pinned repository snapshot.

        Business rules:
        - Read-only mode permits edits only inside the canonical agent-state subtree.
        - The default mode preserves legacy callers.

        Execution flow:
        1. Validate the path when the read-only boundary is enabled.
        2. Return an error result for invalid or protected paths, otherwise delegate the edit.

        Failure cases:
        - Rejected paths return `EditResult.error`; sandbox failures retain the backend's error.

        Side effects:
        - Changes content only at an authorized path in read-only mode.
        """
        error = self._write_path_error(file_path)
        if error:
            return EditResult(error=error)
        return self._backend().edit(file_path, old_string, new_string, replace_all)

    def delete(self, file_path: str) -> DeleteResult:
        """Business purpose: Delete an agent file without allowing removal from a pinned repository.

        Business rules:
        - Read-only mode permits deletion only inside the canonical agent-state subtree.
        - The default mode preserves legacy callers.

        Execution flow:
        1. Validate the path when the read-only boundary is enabled.
        2. Return an error result for invalid or protected paths, otherwise delegate deletion.

        Failure cases:
        - Rejected paths return `DeleteResult.error`; sandbox failures retain the backend's error.

        Side effects:
        - Removes a file only at an authorized path in read-only mode.
        """
        error = self._write_path_error(file_path)
        if error:
            return DeleteResult(error=error)
        return self._backend().delete(file_path)

    def upload_files(
        self,
        files: list[tuple[str, bytes]],
    ) -> list[FileUploadResponse]:
        """Business purpose: Upload files without allowing customer-source mutation in read-only
        mode.

        Business rules:
        - Read-only mode allows each upload only inside the canonical agent-state subtree.
        - The default mode preserves legacy callers.
        - Rejected entries receive individual errors while authorized entries retain normal handling.

        Execution flow:
        1. Validate every requested path before uploading any authorized entries.
        2. Return per-file errors for invalid or protected paths and delegate authorized files together.
        3. Restore the backend results to their original request order.

        Failure cases:
        - Rejected paths return `FileUploadResponse.error`; backend failures stay with their results.

        Side effects:
        - Persists uploaded bytes only at authorized paths in read-only mode.
        """
        if self._read_only_repository:
            results: list[FileUploadResponse | None] = [None] * len(files)
            allowed: list[tuple[int, str, bytes]] = []
            for index, (path, content) in enumerate(files):
                error = self._write_path_error(path)
                if error:
                    results[index] = FileUploadResponse(path=path, error=error)
                else:
                    allowed.append((index, path, content))
            if allowed:
                uploaded = self._backend().upload_files(
                    [(path, content) for _, path, content in allowed]
                )
                for (index, _, _), result in zip(allowed, uploaded):
                    results[index] = result
            return [result for result in results if result is not None]
        return self._backend().upload_files(files)

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        return self._backend().download_files(paths)


class RuntimeRepositoryBackend(RuntimeRepositoryFilesystemBackend, SandboxBackendProtocol):
    """Add shell execution for runtime callers that require it."""

    def execute(self, command: str, *, timeout: int | None = None):
        return self._backend().execute(command, timeout=timeout)


def repository_database_backend(
    backend: object, layout: RepositoryLayout | None = None
) -> AssessmentRepositoryBackend:
    """Business purpose: Give agents the repository view of a sandbox backend for the assessment layout.

    Business rules:
    - An already wrapped backend keeps its own layout; a raw backend is wrapped with the requested layout (the original one by default).

    Execution flow:
    1. Return the backend when it is already a repository view.
    2. Otherwise wrap it with the layout.

    Failure cases:
    - No failure path.

    Side effects:
    - Creates a lightweight wrapper object only.
    """
    if isinstance(backend, AssessmentRepositoryBackend):
        return backend
    return AssessmentRepositoryBackend(backend, layout)


def current_repository_backend() -> object | None:
    """Current repository-rooted backend shared by nested Deep Agents."""
    return _ACTIVE_BACKEND.get()


@contextmanager
def activate_repository_backend(
    backend: object, layout: RepositoryLayout | None = None
) -> Iterator[object]:
    """Business purpose: Expose one repository backend, with its layout, to nested agents for the duration of a run.

    Business rules:
    - The active backend is dispatch-local and always restored when the run ends, even on failure.

    Execution flow:
    1. Wrap the backend with the layout.
    2. Set it as active.
    3. Yield it and restore the previous value.

    Failure cases:
    - Exceptions propagate after the previous backend is restored.

    Side effects:
    - Sets and resets a dispatch-local context variable.
    """
    repository_backend = repository_database_backend(backend, layout)
    token = _ACTIVE_BACKEND.set(repository_backend)
    try:
        yield repository_backend
    finally:
        _ACTIVE_BACKEND.reset(token)


def hydrate_repository(
    backend: object,
    *,
    snapshot_id: str,
    scan_job_id: str,
    commit_sha: str = "",
    assessment_id: str = "",
    source_path_prefix: str | None = None,
    correlation_id: str | None = None,
    lifecycle: RepositoryHydrationLifecycle | None = None,
) -> None:
    """Business purpose:
    Mount the customer's pinned snapshot with an explicit account of source excluded by runtime guards.

    Business rules:
    - Reusing the same snapshot/job requires matching assessment, commit and source-scope pins.
    - Archive safety limits remain effective; omitted in-scope source is reported as limited coverage.
    - Intentional source-scope exclusions are reported separately and never widen a resumed workspace.
    - An existing matching workspace keeps its repository and agent state when metadata is upgraded.

    Execution flow:
    1. Validate cached pins and reuse a workspace whose coverage metadata is already present.
    2. Download and sanitize the owned snapshot, retaining omission provenance.
    3. Extract a new workspace or update only the metadata of an existing matching workspace.

    Failure cases:
    - Conflicting cached pins, archive guards or failed sandbox operations reject hydration.
    - A failed metadata upgrade never clears an existing repository or agent state.

    Side effects:
    - Downloads the snapshot and writes sandbox metadata; initial hydration creates its source and Git baseline.
    """
    _hydrate_one_repository(
        backend,
        snapshot_id=snapshot_id,
        scan_job_id=scan_job_id,
        commit_sha=commit_sha,
        assessment_id=assessment_id,
        source_path_prefix=source_path_prefix,
        correlation_id=correlation_id,
        lifecycle=lifecycle,
        repository_root=REPOSITORY_ROOT,
        marker_path=REPOSITORY_META,
        archive_path=_ARCHIVE_PATH,
        agent_state=REPOSITORY_AGENT_STATE,
        marker_extra={"agentFilesystemRoot": "/"},
    )


def hydrate_repository_set(
    backend: object,
    pins: list[RepositoryPin],
    *,
    assessment_id: str,
    correlation_id: str | None = None,
    lifecycle: RepositoryHydrationLifecycle | None = None,
) -> RepositoryLayout:
    """Business purpose:
    Mount every repository pinned to the assessment side by side so one Root can reason across them.

    Business rules:
    - One repository keeps the original single-repository layout; several use one directory per repository key.
    - Each repository is hydrated, guarded and scope-filtered exactly like a single repository, from its own
      immutable snapshot, hydration ticket, commit and source prefix.
    - Hydrating one repository only ever touches that repository's directory; the others and the agent state survive.
    - The set manifest records the set digest so a resumed sandbox can prove it holds the same set.

    Execution flow:
    1. Validate the pins and pick the layout.
    2. Hydrate each repository in pin order (reusing an already matching one).
    3. Write the set manifest and the shared agent-state directory.

    Failure cases:
    - A cached repository or manifest that conflicts with the requested pins rejects hydration before any model work.
    - Any failed download, guard or sandbox operation stops the whole set; no partial set is reported as ready.

    Side effects:
    - Downloads each snapshot and writes per-repository directories, markers, the set manifest and agent-state directory.
    """
    if not pins:
        raise ValueError("at least one repository pin is required")
    layout = repository_layout_for(pins)
    if not layout.multi:
        only = pins[0]
        hydrate_repository(
            backend,
            snapshot_id=only.snapshot_id,
            scan_job_id=only.scan_job_id,
            commit_sha=only.commit_sha,
            assessment_id=assessment_id,
            source_path_prefix=only.source_path_prefix,
            correlation_id=correlation_id,
            lifecycle=lifecycle,
        )
        return layout
    digest = repository_set_digest(pins)
    manifest = _read_json(backend, REPOSITORY_SET_META)
    if manifest and manifest.get("repositorySetDigest") not in (None, digest):
        raise RuntimeError("cached repository set does not match the requested repository set")
    for pin in pins:
        started = time.monotonic()
        previous = _read_marker(backend, pin.marker_path)
        try:
            _hydrate_one_repository(
                backend,
                snapshot_id=pin.snapshot_id,
                scan_job_id=pin.scan_job_id,
                commit_sha=pin.commit_sha,
                assessment_id=assessment_id,
                source_path_prefix=pin.source_path_prefix,
                correlation_id=correlation_id,
                lifecycle=lifecycle,
                repository_root=pin.root,
                marker_path=pin.marker_path,
                archive_path=f"/tmp/lcsp-assessment-repository-{pin.key}.tar.gz",
                agent_state=None,
                marker_extra={
                    "repositoryKey": pin.key,
                    "agentFilesystemRoot": "/",
                    "agentRepositoryPath": f"/{pin.key}",
                },
            )
        except Exception as error:
            _LOGGER.warning(
                "ASSESSMENT_REPOSITORY_HYDRATION_FAILED",
                assessment_id=assessment_id,
                repository_key=pin.key,
                ordinal=pin.ordinal,
                duration_ms=int((time.monotonic() - started) * 1000),
                error_type=type(error).__name__,
            )
            raise
        _log_repository_hydrated(backend, pin, assessment_id=assessment_id, previous=previous, started=started)
    manifest_payload = json.dumps(
        {
            "assessmentId": assessment_id,
            "repositorySetDigest": digest,
            "repositoriesRoot": REPOSITORIES_ROOT,
            "role": "assessment_repository_set",
            "repositories": [
                {
                    "repositoryKey": pin.key,
                    "ordinal": pin.ordinal,
                    "repositorySnapshotId": pin.snapshot_id,
                    "repositoryCommit": pin.commit_sha,
                    "sourcePathPrefix": pin.source_path_prefix,
                }
                for pin in pins
            ],
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    execute = getattr(backend, "execute", None)
    write = getattr(backend, "write", None)
    if not callable(execute) or not callable(write):
        raise RuntimeError("repository sandbox backend does not support filesystem operations")
    prepared = execute(f"mkdir -p {shlex.quote(REPOSITORIES_AGENT_STATE)}", timeout=60)
    if getattr(prepared, "exit_code", 1) != 0:
        raise RuntimeError("failed to prepare the repository agent-state directory")
    written = write(REPOSITORY_SET_META, manifest_payload)
    if getattr(written, "error", None):
        raise RuntimeError("failed to persist the repository set manifest")
    return layout


def _log_repository_hydrated(
    backend: object,
    pin: RepositoryPin,
    *,
    assessment_id: str,
    previous: Mapping[str, Any],
    started: float,
) -> None:
    """Business purpose:
    Let operators see how long each repository of a set took to hydrate and how much of it was kept, so a slow or
    oversized repository is identified by its key instead of being hidden inside one set-wide duration.

    Business rules:
    - One record per repository, keyed by repositoryKey; it names coverage counts only, never paths or contents.
    - A repository whose pinned snapshot was already present is reported as reused, not as a fresh download.

    Execution flow:
    1. Read the repository marker the hydration just wrote.
    2. Compare it with the marker found before hydration to tell reuse from a fresh hydration.
    3. Emit one structured log record with duration, reuse flag and source coverage counts.

    Failure cases:
    - An unreadable marker is logged without coverage counts; observability never fails hydration.

    Side effects:
    - Reads one marker file and writes one log record; changes no sandbox or API state.
    """
    marker = _read_marker(backend, pin.marker_path)
    coverage = marker.get("sourceCoverage") if isinstance(marker, dict) else None
    coverage = coverage if isinstance(coverage, dict) else {}
    _LOGGER.info(
        "ASSESSMENT_REPOSITORY_HYDRATED",
        assessment_id=assessment_id,
        repository_key=pin.key,
        ordinal=pin.ordinal,
        duration_ms=int((time.monotonic() - started) * 1000),
        reused=previous.get("snapshotId") == pin.snapshot_id and previous.get("scanJobId") == pin.scan_job_id,
        included_files=coverage.get("includedFiles"),
        coverage_limited=coverage.get("coverageLimited"),
    )


def _hydrate_one_repository(
    backend: object,
    *,
    snapshot_id: str,
    scan_job_id: str,
    commit_sha: str,
    assessment_id: str,
    source_path_prefix: str | None,
    correlation_id: str | None,
    lifecycle: RepositoryHydrationLifecycle | None,
    repository_root: str,
    marker_path: str,
    archive_path: str,
    agent_state: str | None,
    marker_extra: Mapping[str, Any],
) -> None:
    """Business purpose:
    Hydrate one pinned repository into its own sandbox directory, reusing it only when every pin still matches.

    Business rules:
    - The same rules as single-repository hydration apply to every repository of a set.
    - Only the target directory is ever cleared, never a sibling repository or shared agent state.

    Execution flow:
    1. Compare the cached marker with the requested pins and reuse a matching, covered workspace.
    2. Otherwise download and sanitize the snapshot, extract it into the target directory and write its marker.

    Failure cases:
    - Conflicting cached pins, archive guards or sandbox failures reject hydration.

    Side effects:
    - Downloads the snapshot and writes the target directory, its Git baseline and its marker.
    """
    source_path_prefix = validate_source_path_prefix(source_path_prefix)
    marker = _read_marker(backend, marker_path)
    reused = marker.get("snapshotId") == snapshot_id and marker.get("scanJobId") == scan_job_id
    if reused:
        if marker.get("commitSha") != commit_sha or marker.get("assessmentId") != assessment_id:
            raise RuntimeError("cached repository view pins do not match the requested snapshot")
        if validate_source_path_prefix(marker.get("sourcePathPrefix")) != source_path_prefix:
            raise RuntimeError("cached repository source scope does not match the requested snapshot")
        coverage = marker.get("sourceCoverage")
        if isinstance(coverage, dict):
            if validate_source_path_prefix(coverage.get("sourcePathPrefix")) != source_path_prefix:
                raise RuntimeError("cached repository coverage scope does not match the requested snapshot")
            if source_path_prefix is not None and (
                not isinstance(coverage.get("includedFiles"), int) or isinstance(coverage.get("includedFiles"), bool)
                or coverage["includedFiles"] < 1
            ):
                raise RuntimeError("cached scoped repository has no retained source")
            _emit_lifecycle(lifecycle, "repository_sandbox_reused")
            return
        if source_path_prefix is not None:
            raise RuntimeError("cached scoped repository lacks source coverage metadata")

    config = load_config()
    _emit_lifecycle(lifecycle, "repository_archive_downloading")
    archive_download = RepositorySnapshotClient(
        config.nestjs_api_base_url,
        config.worker_api_key,
    ).download_archive_with_metadata(
        RepositoryArchiveRequest(
            snapshot_id=snapshot_id,
            scan_job_id=scan_job_id,
            correlation_id=correlation_id or scan_job_id,
        )
    )
    _emit_lifecycle(lifecycle, "repository_archive_downloaded")
    sanitized_archive, source_coverage = _sanitize_archive(
        archive_download.content,
        snapshot_id=snapshot_id,
        source_path_prefix=source_path_prefix,
        archive_root=archive_download.archive_root,
        tree_manifest=getattr(archive_download, "tree_manifest", None),
    )

    upload_files = getattr(backend, "upload_files", None)
    execute = getattr(backend, "execute", None)
    write = getattr(backend, "write", None)
    if not callable(upload_files) or not callable(execute) or not callable(write):
        raise RuntimeError(
            "repository sandbox backend does not support filesystem operations"
        )

    if not reused:
        _emit_lifecycle(lifecycle, "repository_sandbox_hydrating")
        uploads = upload_files([(archive_path, sanitized_archive)])
        if not uploads or getattr(uploads[0], "error", None):
            raise RuntimeError("failed to upload assessment repository into sandbox")

        baseline_label = (
            commit_sha.lower()
            if re.fullmatch(r"[0-9a-fA-F]{7,64}", commit_sha or "")
            else "unknown"
        )
        bootstrap = _repository_hydration_bootstrap(
            baseline_label,
            repository_root=repository_root,
            archive_path=archive_path,
            agent_state=agent_state,
        )
        extraction = execute(bootstrap, timeout=300)
        if getattr(extraction, "exit_code", 1) != 0:
            output = str(getattr(extraction, "output", "") or "").strip()
            detail = f": {output}" if output else ""
            raise RuntimeError(f"failed to materialize assessment repository database{detail}")

    marker_payload = json.dumps(
        {
            "assessmentId": assessment_id,
            "snapshotId": snapshot_id,
            "scanJobId": scan_job_id,
            "commitSha": commit_sha,
            "sourcePathPrefix": source_path_prefix,
            "repositoryRoot": repository_root,
            "role": "assessment_repository_database",
            "sourceCoverage": source_coverage,
            **marker_extra,
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    write_result = write(marker_path, marker_payload)
    if getattr(write_result, "error", None):
        raise RuntimeError("failed to persist repository database metadata")
    _emit_lifecycle(lifecycle, "repository_sandbox_hydrated")


def _repository_hydration_bootstrap(
    baseline_label: str,
    *,
    repository_root: str = REPOSITORY_ROOT,
    archive_path: str = _ARCHIVE_PATH,
    agent_state: str | None = REPOSITORY_AGENT_STATE,
) -> str:
    """Business purpose: Build the sandbox command that materialises one repository from its archive with a Git baseline.

    Business rules:
    - Only the target repository directory is emptied, never its parent or a sibling repository.
    - The shared agent-state directory is created only when the caller asks for it.
    - The Git baseline records the pinned commit and excludes runtime metadata.

    Execution flow:
    1. Quote the directory and archive paths.
    2. Compose clear, extract, optional agent-state and Git baseline steps.

    Failure cases:
    - The command fails (non-zero exit) if any step fails and the caller rejects hydration.

    Side effects:
    - Pure computation: it reads no sandbox state and writes nothing.
    """
    repository = shlex.quote(repository_root)
    archive_path = shlex.quote(archive_path)
    git = f"git --git-dir={repository}/.git --work-tree={repository}"
    agent_state_step = (
        f"&& mkdir -p {shlex.quote(agent_state)} " if agent_state is not None else ""
    )
    return (
        f"mkdir -p {repository} "
        f"&& find {repository} -mindepth 1 -maxdepth 1 -exec rm -rf -- {{}} + "
        f"&& tar -xzf {archive_path} -C {repository} "
        f"{agent_state_step}"
        "&& if command -v git >/dev/null 2>&1; then "
        f"git -C {repository} init -q "
        f"&& {git} config user.email lcsp-agent-runtime@local "
        f"&& {git} config user.name 'LCSP Agent Runtime' "
        f"&& {git} add -A "
        f"&& {git} commit -q --allow-empty "
        f"-m {shlex.quote('LCSP baseline ' + baseline_label)} "
        f"&& printf '\\n.lcsp/\\n' >> {repository}/.git/info/exclude; "
        "fi"
    )




def _emit_lifecycle(
    lifecycle: RepositoryHydrationLifecycle | None,
    event: str,
) -> None:
    if lifecycle is not None:
        lifecycle(event)


def _read_marker(backend: object, path: str = REPOSITORY_META) -> dict[str, Any]:
    """Business purpose: Read the runtime marker that records what is hydrated in a repository directory.

    Business rules:
    - A missing or malformed marker means nothing is hydrated; it never authorises reuse.

    Execution flow:
    1. Read and parse the marker file.

    Failure cases:
    - Unreadable or invalid content returns an empty marker.

    Side effects:
    - Read-only sandbox access.
    """
    return _read_json(backend, path)


def _read_json(backend: object, path: str) -> dict[str, Any]:
    """Business purpose: Read a runtime JSON document (a repository marker or the repository-set manifest) from the sandbox.

    Business rules:
    - Only a well-formed JSON object counts; anything else is treated as absent.

    Execution flow:
    1. Read the file window.
    2. Parse it as JSON.
    3. Return the object or an empty one.

    Failure cases:
    - Read errors and invalid JSON return an empty document.

    Side effects:
    - Read-only sandbox access.
    """
    read = getattr(backend, "read", None)
    if not callable(read):
        return {}
    result = read(path, offset=0, limit=16384)
    if getattr(result, "error", None):
        return {}
    file_data = getattr(result, "file_data", None)
    content = file_data.get("content") if isinstance(file_data, Mapping) else None
    if not isinstance(content, str):
        return {}
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _sanitize_archive(
    archive: bytes, *, snapshot_id: str, source_path_prefix: str | None = None,
    archive_root: str | None = None,
    tree_manifest: RepositoryTreePathManifest | None = None,
) -> tuple[bytes, dict[str, Any]]:
    """Business purpose:
    Build the runtime source view for the immutable customer selection with truthful coverage.

    Business rules:
    - Workspace safety guards apply before filtering; links and runtime-owned .git/.lcsp never become source.
    - A provider wrapper is removed only when transport metadata names it or a complete pinned-tree manifest uniquely proves it.
    - A selected subtree retains original repository-relative paths and excludes similarly named siblings.
    - Intentional scope exclusions do not limit in-scope coverage; guarded omissions inside it do.
    - Scope-exclusion samples are bounded; their exact count remains available without exposing sibling content.
    - A scoped view must retain at least one real source file and cannot silently fall back to the full archive.

    Execution flow:
    1. Validate the exact source prefix and materialize the archive through the existing bounded extractor and path verifier.
    2. Classify guarded omissions and retained files against the selected scope.
    3. Return only allowed source with separate safety and scope-exclusion provenance.

    Failure cases:
    - Unsafe archives, missing scope or a scope with no retained source fail before changing the sandbox.

    Side effects:
    - Uses and removes a temporary workspace; neither alters the immutable archive nor reroots evidence paths.
    """
    source_path_prefix = validate_source_path_prefix(source_path_prefix)
    with tempfile.TemporaryDirectory(prefix="lcsp-repository-sandbox-") as root:
        workspace = RepositoryWorkspace(Path(root))
        result = workspace.materialize(
            "snapshot",
            archive,
            snapshot_id=snapshot_id,
            archive_root=archive_root,
            tree_manifest=tree_manifest,
        )
        effective_archive_root = (
            result.verified_archive_root
            if tree_manifest is not None
            else archive_root
        )
        source_root = _repository_root(
            result.workspace_path,
            archive_root=effective_archive_root,
        )
        archive_prefix = source_root.relative_to(result.workspace_path)
        skipped = []
        excluded = []
        for entry in result.skipped_entries:
            relative = Path(entry.path).relative_to(archive_prefix).as_posix()
            record = {"path": relative, "reason": entry.reason, "sizeBytes": entry.size_bytes,
                      "limitBytes": entry.limit_bytes, "sha256": entry.sha256}
            if source_path_prefix is not None and not source_path_in_scope(relative, source_path_prefix):
                excluded.append({**record, "reason": "SOURCE_SCOPE_EXCLUDED", "guardReason": entry.reason})
            else:
                skipped.append(record)
        included = 0
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w:gz") as sanitized:
            for path in sorted(source_root.rglob("*")):
                if not path.is_file():
                    continue
                relative = path.relative_to(source_root)
                relative_path = relative.as_posix()
                if source_path_prefix is not None and not source_path_in_scope(relative_path, source_path_prefix):
                    excluded.append({"path": relative_path, "reason": "SOURCE_SCOPE_EXCLUDED",
                                     "sizeBytes": path.stat().st_size})
                    continue
                if relative.parts and relative.parts[0] in _RESERVED_REPOSITORY_DIRS:
                    with path.open("rb") as source:
                        digest = hashlib.file_digest(source, "sha256").hexdigest()
                    skipped.append({"path": relative_path, "reason": "RESERVED_RUNTIME_PATH",
                                    "sizeBytes": path.stat().st_size, "limitBytes": None, "sha256": digest})
                    continue
                sanitized.add(path, arcname=relative_path, recursive=False)
                included += 1
        if source_path_prefix is not None and included == 0:
            raise RuntimeError("selected repository source scope has no retained source files")
        return output.getvalue(), {
            "sourcePathPrefix": source_path_prefix,
            "coverageLimited": bool(skipped),
            "includedFiles": included,
            "skippedEntries": skipped,
            "sourceScopeExcludedEntryCount": len(excluded),
            "sourceScopeExcludedEntries": excluded[:_MAX_SOURCE_SCOPE_EXCLUSION_SAMPLES],
            "sourceScopeExclusionsTruncated": len(excluded) > _MAX_SOURCE_SCOPE_EXCLUSION_SAMPLES,
        }


def _repository_root(workspace_path: Path, *, archive_root: str | None = None) -> Path:
    """Business purpose:
    Keep archive wrapper directories out of repository-relative paths only when their identity is explicit.

    Business rules:
    - A top-level directory is preserved by default; its shape alone does not prove it is a provider wrapper.
    - An explicitly supplied wrapper must be the archive's sole top-level directory.

    Execution flow:
    1. Return the complete workspace when no exact wrapper name is supplied.
    2. Validate the supplied wrapper name and confirm it owns the complete extracted archive.

    Failure cases:
    - Invalid or missing wrapper metadata fails closed before source filtering or sandbox upload.

    Side effects:
    - Read-only path selection; does not rename or modify repository source files.
    """
    if archive_root is None:
        return workspace_path
    parts = archive_root.split("/")
    if len(parts) != 1 or not archive_root or any(
        part in {"", ".", ".."} or "\\" in part or ":" in part for part in parts
    ):
        raise RuntimeError("archive root metadata is invalid")
    source_root = workspace_path.joinpath(*parts)
    if not source_root.is_dir():
        raise RuntimeError("declared archive root is missing")
    expected_top_level = workspace_path / parts[0]
    if list(workspace_path.iterdir()) != [expected_top_level]:
        raise RuntimeError("declared archive root does not contain the complete archive")
    return source_root


def _real_path(path: str, root: str = REPOSITORY_ROOT) -> str:
    """Business purpose: Translate an agent path into a sandbox path under a layout root.

    Business rules:
    - Paths are confined to the root; traversal and home-directory components are refused.
    - A path already under the root is kept; any other path is resolved beneath it.

    Execution flow:
    1. Reject escaping components.
    2. Normalise and return the path under the root.

    Failure cases:
    - An escaping path raises ValueError before any sandbox access.

    Side effects:
    - Pure computation: it reads no sandbox state and writes nothing.
    """
    value = path.strip() or "/"
    pure = PurePosixPath(value)
    parts = pure.parts[1:] if pure.is_absolute() else pure.parts
    if any(part in {"..", "~"} for part in parts):
        raise ValueError("repository database paths cannot escape the repository root")
    if pure.is_absolute():
        normalized = str(
            PurePosixPath(
                "/" + "/".join(part for part in parts if part not in {"", "."})
            )
        )
        if normalized == root or normalized.startswith(root + "/"):
            return normalized
    suffix = "/".join(part for part in parts if part not in {"", "."})
    return root if not suffix else f"{root}/{suffix}"


def _virtual_path(path: str, root: str = REPOSITORY_ROOT) -> str:
    """Business purpose: Translate a sandbox path under a layout root back into an agent path.

    Business rules:
    - The root itself is the agent filesystem root; every other path loses the root prefix.

    Execution flow:
    1. Normalise the sandbox path.
    2. Strip the root.

    Failure cases:
    - A path outside the root raises RuntimeError rather than leaking sandbox internals.

    Side effects:
    - Pure computation: it reads no sandbox state and writes nothing.
    """
    normalized = str(PurePosixPath(path))
    if normalized == root:
        return "/"
    prefix = root + "/"
    if not normalized.startswith(prefix):
        raise RuntimeError(
            "repository backend returned a path outside repository database"
        )
    return "/" + normalized[len(prefix) :]


def _virtual_file_info(item: Mapping[str, Any], root: str = REPOSITORY_ROOT) -> dict[str, Any]:
    """Business purpose: Translate the path of one listing entry from sandbox form to agent form.

    Business rules:
    - Only the path changes; every other field is preserved.

    Execution flow:
    1. Copy the entry.
    2. Translate its path.

    Failure cases:
    - A path outside the root raises RuntimeError.

    Side effects:
    - Pure computation: it reads no sandbox state and writes nothing.
    """
    copy = dict(item)
    copy["path"] = _virtual_path(str(item["path"]), root)
    return copy


def _event_text(value: Mapping[str, Any], *keys: str) -> str | None:
    for key in keys:
        candidate = value.get(key)
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return None


__all__ = [
    "AssessmentRepositoryBackend",
    "MULTI_REPOSITORY_LAYOUT",
    "REPOSITORIES_AGENT_STATE",
    "REPOSITORIES_ROOT",
    "REPOSITORY_AGENT_STATE",
    "REPOSITORY_META",
    "REPOSITORY_ROOT",
    "REPOSITORY_SET_META",
    "RepositoryLayout",
    "RepositoryPin",
    "SINGLE_REPOSITORY_LAYOUT",
    "RuntimeRepositoryBackend",
    "activate_repository_backend",
    "current_repository_backend",
    "ensure_runtime_skills",
    "hydrate_repository",
    "hydrate_repository_set",
    "repository_database_backend",
    "repository_layout_for",
    "repository_pins_from_context",
    "repository_set_digest",
    "resolve_repository_thread_backend",
]
