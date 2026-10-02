"""Assessment repository as the persistent working database for Deep Agents."""

from __future__ import annotations

import io
import json
import re
import shlex
import tarfile
import tempfile
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Iterator, Mapping

from deepagents.backends.protocol import (
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
from tools.common.capabilities.platform.repository_snapshot_client import (
    RepositoryArchiveRequest,
    RepositorySnapshotClient,
)
from tools.common.capabilities.platform.repository_workspace import RepositoryWorkspace


REPOSITORY_ROOT = "/workspace/repository"
REPOSITORY_META = f"{REPOSITORY_ROOT}/.lcsp/repository.json"
REPOSITORY_AGENT_STATE = f"{REPOSITORY_ROOT}/.lcsp/agent"
REPOSITORY_SKILLS = f"{REPOSITORY_AGENT_STATE}/skills"
_ARCHIVE_PATH = "/tmp/lcsp-assessment-repository.tar.gz"
_RESERVED_REPOSITORY_DIRS = {".git", ".lcsp"}
_CHECKED_IN_SKILLS_ROOT = Path(__file__).resolve().parents[4] / "skills"
_ACTIVE_BACKEND: ContextVar[object | None] = ContextVar(
    "lcsp_repository_thread_backend",
    default=None,
)
_DOCKER_SANDBOX_MANAGER = DockerSandboxManager()
RepositoryHydrationLifecycle = Callable[[str], None]

class AssessmentRepositoryBackend(SandboxBackendProtocol):
    """Expose the assessment repository itself as the Deep Agent filesystem root.

    The physical directory is /workspace/repository in the LCSP-owned sandbox.
    Agent-facing / means the repository root, and shell commands execute with
    the repository as their working directory, matching a coding CLI checkout.
    """

    def __init__(self, backend: object) -> None:
        self._backend = backend

    @property
    def id(self) -> str:
        backend_id = getattr(self._backend, "id", "repository-sandbox")
        return f"{backend_id}:assessment-repository"

    def ls(self, path: str) -> LsResult:
        result = self._backend.ls(_real_path(path))
        if result.entries is None:
            return LsResult(error=result.error)
        return LsResult(
            error=result.error,
            entries=[_virtual_file_info(item) for item in result.entries],
        )

    def read(self, file_path: str, offset: int = 0, limit: int = 2000):
        return self._backend.read(_real_path(file_path), offset=offset, limit=limit)

    def grep(
        self,
        pattern: str,
        path: str | None = None,
        glob: str | None = None,
        *,
        max_count: int | None = None,
    ) -> GrepResult:
        real_path = _real_path(path or "/")
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
            copy["path"] = _virtual_path(str(item["path"]))
            matches.append(copy)
        return GrepResult(
            error=result.error,
            matches=matches,
            truncated=result.truncated,
        )

    def glob(self, pattern: str, path: str | None = None) -> GlobResult:
        result = self._backend.glob(pattern, _real_path(path or "/"))
        if result.matches is None:
            return GlobResult(
                error=result.error,
                truncated=result.truncated,
                truncation_reason=result.truncation_reason,
            )
        return GlobResult(
            error=result.error,
            matches=[_virtual_file_info(item) for item in result.matches],
            truncated=result.truncated,
            truncation_reason=result.truncation_reason,
        )

    def write(self, file_path: str, content: str) -> WriteResult:
        result = self._backend.write(_real_path(file_path), content)
        return WriteResult(
            error=result.error,
            path=_virtual_path(result.path) if result.path else None,
        )

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ) -> EditResult:
        result = self._backend.edit(
            _real_path(file_path),
            old_string,
            new_string,
            replace_all=replace_all,
        )
        return EditResult(
            error=result.error,
            path=_virtual_path(result.path) if result.path else None,
            occurrences=result.occurrences,
        )

    def delete(self, file_path: str) -> DeleteResult:
        result = self._backend.delete(_real_path(file_path))
        return DeleteResult(
            error=result.error,
            path=_virtual_path(result.path) if result.path else None,
        )

    def upload_files(
        self,
        files: list[tuple[str, bytes]],
    ) -> list[FileUploadResponse]:
        requested = [path for path, _ in files]
        translated = [(_real_path(path), content) for path, content in files]
        results = self._backend.upload_files(translated)
        return [
            FileUploadResponse(path=requested[index], error=result.error)
            for index, result in enumerate(results)
        ]

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        results = self._backend.download_files([_real_path(path) for path in paths])
        return [
            FileDownloadResponse(
                path=paths[index],
                content=result.content,
                error=result.error,
            )
            for index, result in enumerate(results)
        ]

    def execute(self, command: str, *, timeout: int | None = None):
        """Run shell commands with the assessment repository as the CWD."""
        scoped = f"cd {shlex.quote(REPOSITORY_ROOT)} && {command}"
        if timeout is not None:
            try:
                return self._backend.execute(scoped, timeout=timeout)
            except TypeError:
                return self._backend.execute(scoped)
        return self._backend.execute(scoped)


def resolve_repository_thread_backend(config: object | None) -> object:
    """Resolve the LCSP Docker sandbox backend for the current durable thread."""
    return _DOCKER_SANDBOX_MANAGER.resolve(config)


class RuntimeRepositoryBackend(SandboxBackendProtocol):
    """Late-bind Deep Agents file tools to the current thread sandbox."""

    @property
    def id(self) -> str:
        return "lcsp-runtime-repository"

    def _backend(self) -> AssessmentRepositoryBackend:
        active = current_repository_backend()
        if active is not None:
            return repository_database_backend(active)
        backend = resolve_repository_thread_backend(get_config())
        ensure_runtime_skills(backend)
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

    def write(self, file_path: str, content: str) -> WriteResult:
        return self._backend().write(file_path, content)

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ) -> EditResult:
        return self._backend().edit(file_path, old_string, new_string, replace_all)

    def delete(self, file_path: str) -> DeleteResult:
        return self._backend().delete(file_path)

    def upload_files(
        self,
        files: list[tuple[str, bytes]],
    ) -> list[FileUploadResponse]:
        return self._backend().upload_files(files)

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        return self._backend().download_files(paths)

    def execute(self, command: str, *, timeout: int | None = None):
        return self._backend().execute(command, timeout=timeout)


def repository_database_backend(backend: object) -> AssessmentRepositoryBackend:
    """Return the repository-rooted database view used by every assessment agent."""
    if isinstance(backend, AssessmentRepositoryBackend):
        return backend
    return AssessmentRepositoryBackend(backend)


def current_repository_backend() -> object | None:
    """Current repository-rooted backend shared by nested Deep Agents."""
    return _ACTIVE_BACKEND.get()


@contextmanager
def activate_repository_backend(backend: object) -> Iterator[object]:
    """Expose one repository database backend to nested Deep Agent construction."""
    repository_backend = repository_database_backend(backend)
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
    correlation_id: str | None = None,
    lifecycle: RepositoryHydrationLifecycle | None = None,
) -> None:
    """Create/reuse the live repository database from an immutable baseline snapshot."""
    marker = _read_marker(backend)
    if marker.get("snapshotId") == snapshot_id and marker.get("scanJobId") == scan_job_id:
        _emit_lifecycle(lifecycle, "repository_sandbox_reused")
        return

    config = load_config()
    _emit_lifecycle(lifecycle, "repository_archive_downloading")
    archive = RepositorySnapshotClient(
        config.nestjs_api_base_url,
        config.worker_api_key,
    ).download_archive(
        RepositoryArchiveRequest(
            snapshot_id=snapshot_id,
            scan_job_id=scan_job_id,
            correlation_id=correlation_id or scan_job_id,
        )
    )
    _emit_lifecycle(lifecycle, "repository_archive_downloaded")
    sanitized_archive = _sanitize_archive(archive, snapshot_id=snapshot_id)

    upload_files = getattr(backend, "upload_files", None)
    execute = getattr(backend, "execute", None)
    write = getattr(backend, "write", None)
    if not callable(upload_files) or not callable(execute) or not callable(write):
        raise RuntimeError(
            "repository sandbox backend does not support filesystem operations"
        )

    _emit_lifecycle(lifecycle, "repository_sandbox_hydrating")
    uploads = upload_files([(_ARCHIVE_PATH, sanitized_archive)])
    if not uploads or getattr(uploads[0], "error", None):
        raise RuntimeError("failed to upload assessment repository into sandbox")

    baseline_label = (
        commit_sha.lower()
        if re.fullmatch(r"[0-9a-fA-F]{7,64}", commit_sha or "")
        else "unknown"
    )
    bootstrap = _repository_hydration_bootstrap(baseline_label)
    extraction = execute(bootstrap, timeout=120)
    if getattr(extraction, "exit_code", 1) != 0:
        output = str(getattr(extraction, "output", "") or "").strip()
        detail = f": {output}" if output else ""
        raise RuntimeError(f"failed to materialize assessment repository database{detail}")

    _mirror_checked_in_skills(write)

    marker_payload = json.dumps(
        {
            "assessmentId": assessment_id,
            "snapshotId": snapshot_id,
            "scanJobId": scan_job_id,
            "commitSha": commit_sha,
            "repositoryRoot": REPOSITORY_ROOT,
            "agentFilesystemRoot": "/",
            "role": "assessment_repository_database",
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    write_result = write(REPOSITORY_META, marker_payload)
    if getattr(write_result, "error", None):
        raise RuntimeError("failed to persist repository database metadata")
    _emit_lifecycle(lifecycle, "repository_sandbox_hydrated")


def ensure_runtime_skills(backend: object) -> None:
    """Ensure native Deep Agents skills exist before SkillsMiddleware reads them."""
    write = getattr(backend, "write", None)
    if not callable(write):
        raise RuntimeError("repository sandbox backend does not support skill mirroring")
    _mirror_checked_in_skills(write)


def _mirror_checked_in_skills(write) -> None:
    """Mirror canonical checked-in skills into the hydrated sandbox runtime area."""
    if not _CHECKED_IN_SKILLS_ROOT.is_dir():
        return
    for skill_root in sorted(_CHECKED_IN_SKILLS_ROOT.iterdir()):
        if not skill_root.is_dir():
            continue
        skill_file = skill_root / "SKILL.md"
        if not skill_file.is_file():
            continue
        _write_skill_file(write, skill_file, f"{REPOSITORY_SKILLS}/{skill_root.name}/SKILL.md")
        references_root = skill_root / "references"
        if references_root.is_dir():
            for reference in sorted(references_root.glob("*.md")):
                _write_skill_file(
                    write,
                    reference,
                    f"{REPOSITORY_SKILLS}/{skill_root.name}/references/{reference.name}",
                )


def _write_skill_file(write, source: Path, target: str) -> None:
    result = write(target, source.read_text(encoding="utf-8"))
    if getattr(result, "error", None):
        raise RuntimeError(f"failed to mirror LCSP skill into repository sandbox: {source.name}")


def _repository_hydration_bootstrap(baseline_label: str) -> str:
    repository = shlex.quote(REPOSITORY_ROOT)
    archive_path = shlex.quote(_ARCHIVE_PATH)
    git = f"git --git-dir={repository}/.git --work-tree={repository}"
    return (
        f"mkdir -p {repository} "
        f"&& find {repository} -mindepth 1 -maxdepth 1 -exec rm -rf -- {{}} + "
        f"&& tar -xzf {archive_path} -C {repository} "
        f"&& mkdir -p {shlex.quote(REPOSITORY_AGENT_STATE)} "
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


def ensure_repository_for_event(
    backend: object,
    boundary_name: str,
    event: Mapping[str, Any],
    lifecycle: RepositoryHydrationLifecycle | None = None,
) -> None:
    """Recover the repository database for later stages after sandbox recreation."""
    _ = boundary_name
    snapshot_id = _event_text(event, "snapshotId", "snapshot_id")
    scan_job_id = _event_text(event, "scanJobId", "scan_job_id")
    assessment_id = _event_text(event, "assessmentId", "assessment_id") or ""
    correlation_id = _event_text(event, "correlationId", "correlation_id")

    if snapshot_id and scan_job_id:
        hydrate_repository(
            backend,
            snapshot_id=snapshot_id,
            scan_job_id=scan_job_id,
            commit_sha=_event_text(event, "commitSha", "commit_sha") or "",
            assessment_id=assessment_id,
            correlation_id=correlation_id,
            lifecycle=lifecycle,
        )
        return

    evidence_report_id = _event_text(event, "evidenceReportId", "evidence_report_id")
    if not evidence_report_id:
        return

    from tools.common.capabilities.platform.api_client import WorkerApiClient

    config = load_config()
    report = WorkerApiClient(
        config.nestjs_api_base_url,
        config.worker_api_key,
    ).get_accepted_technical_evidence_report(evidence_report_id)
    snapshot_id = _event_text(report, "snapshotId", "snapshot_id")
    scan_job_id = _event_text(report, "scanJobId", "scan_job_id")
    if not snapshot_id or not scan_job_id:
        return
    hydrate_repository(
        backend,
        snapshot_id=snapshot_id,
        scan_job_id=scan_job_id,
        commit_sha=_event_text(report, "commitSha", "commit_sha") or "",
        assessment_id=_event_text(report, "assessmentId", "assessment_id") or assessment_id,
        correlation_id=correlation_id,
        lifecycle=lifecycle,
    )


def _emit_lifecycle(
    lifecycle: RepositoryHydrationLifecycle | None,
    event: str,
) -> None:
    if lifecycle is not None:
        lifecycle(event)


def _read_marker(backend: object) -> dict[str, Any]:
    read = getattr(backend, "read", None)
    if not callable(read):
        return {}
    result = read(REPOSITORY_META, offset=0, limit=4096)
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


def _sanitize_archive(archive: bytes, *, snapshot_id: str) -> bytes:
    """Apply archive guards and reserve .git/.lcsp for the agent database."""
    with tempfile.TemporaryDirectory(prefix="lcsp-repository-sandbox-") as root:
        workspace = RepositoryWorkspace(Path(root))
        result = workspace.materialize("snapshot", archive, snapshot_id=snapshot_id)
        source_root = _repository_root(result.workspace_path)
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w:gz") as sanitized:
            for path in sorted(source_root.rglob("*")):
                if not path.is_file():
                    continue
                relative = path.relative_to(source_root)
                if relative.parts and relative.parts[0] in _RESERVED_REPOSITORY_DIRS:
                    continue
                sanitized.add(
                    path,
                    arcname=relative.as_posix(),
                    recursive=False,
                )
        return output.getvalue()


def _repository_root(workspace_path: Path) -> Path:
    entries = list(workspace_path.iterdir())
    if len(entries) == 1 and entries[0].is_dir():
        return entries[0]
    return workspace_path


def _real_path(path: str) -> str:
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
        if normalized == REPOSITORY_ROOT or normalized.startswith(
            REPOSITORY_ROOT + "/"
        ):
            return normalized
    suffix = "/".join(part for part in parts if part not in {"", "."})
    return REPOSITORY_ROOT if not suffix else f"{REPOSITORY_ROOT}/{suffix}"


def _virtual_path(path: str) -> str:
    normalized = str(PurePosixPath(path))
    if normalized == REPOSITORY_ROOT:
        return "/"
    prefix = REPOSITORY_ROOT + "/"
    if not normalized.startswith(prefix):
        raise RuntimeError(
            "repository backend returned a path outside repository database"
        )
    return "/" + normalized[len(prefix) :]


def _virtual_file_info(item: Mapping[str, Any]) -> dict[str, Any]:
    copy = dict(item)
    copy["path"] = _virtual_path(str(item["path"]))
    return copy


def _event_text(value: Mapping[str, Any], *keys: str) -> str | None:
    for key in keys:
        candidate = value.get(key)
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return None


__all__ = [
    "AssessmentRepositoryBackend",
    "REPOSITORY_AGENT_STATE",
    "REPOSITORY_META",
    "REPOSITORY_ROOT",
    "REPOSITORY_SKILLS",
    "RuntimeRepositoryBackend",
    "activate_repository_backend",
    "current_repository_backend",
    "ensure_runtime_skills",
    "ensure_repository_for_event",
    "hydrate_repository",
    "repository_database_backend",
    "resolve_repository_thread_backend",
]
