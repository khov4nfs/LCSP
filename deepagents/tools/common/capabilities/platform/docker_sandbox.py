"""Docker-backed sandbox for LCSP repository agent execution."""

from __future__ import annotations

import base64
from datetime import datetime, timezone
import hashlib
import json
import os
import posixpath
import shlex
import subprocess
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any, Callable, Mapping, Sequence

from deepagents.backends.protocol import (
    DeleteResult,
    EditResult,
    ExecuteResponse,
    FileDownloadResponse,
    FileUploadResponse,
    GlobResult,
    GrepResult,
    LsResult,
    SandboxBackendProtocol,
    WriteResult,
)


REPOSITORY_ROOT = "/workspace/repository"
REPOSITORIES_ROOT = "/workspace/repositories"
RUNTIME_ROOT = "/workspace/runtime"
SANDBOX_LABEL = "lcsp.repository-sandbox"
THREAD_LABEL = "lcsp.thread-id"
IMAGE_LABEL = "lcsp.sandbox-image"
DEFAULT_IMAGE = "lcsp-agent-runtime:dev"
DEFAULT_NETWORK = "none"
DEFAULT_CPUS = "2"
DEFAULT_MEMORY = "2g"
DEFAULT_PIDS_LIMIT = "512"
DEFAULT_EXEC_TIMEOUT = 300
FORBIDDEN_ENV_PREFIXES = (
    "AWS_",
    "AZURE_",
    "BITBUCKET_",
    "DATABASE_",
    "DOCKER_",
    "GITHUB_",
    "GITLAB_",
    "GOOGLE_",
    "LANGSMITH_",
    "LCSP_API_KEY",
    "NESTJS_API",
    "OPENAI_",
    "PG",
    "POSTGRES_",
)

Runner = Callable[[Sequence[str], bytes | None, int | None], subprocess.CompletedProcess[bytes]]


@dataclass(frozen=True)
class DockerSandboxSpec:
    thread_id: str
    snapshot_key: str = ""
    image: str = DEFAULT_IMAGE
    network: str = DEFAULT_NETWORK
    cpus: str = DEFAULT_CPUS
    memory: str = DEFAULT_MEMORY
    pids_limit: str = DEFAULT_PIDS_LIMIT

    @property
    def safe_thread_hash(self) -> str:
        return hashlib.sha256(self.thread_id.encode("utf-8")).hexdigest()

    @property
    def container_name(self) -> str:
        return f"lcsp-repository-sandbox-{self.safe_thread_hash[:24]}"


class DockerSandboxBackend(SandboxBackendProtocol):
    """Deep Agents sandbox backend backed by one long-lived Docker container."""

    def __init__(
        self,
        spec: DockerSandboxSpec,
        *,
        runner: Runner | None = None,
    ) -> None:
        self.spec = spec
        self._runner = runner or _run_docker

    @property
    def id(self) -> str:
        return self.spec.container_name

    def ensure_running(self) -> None:
        existing = self._inspect()
        if existing:
            if not _container_matches_spec(existing, self.spec):
                self.cleanup()
                self._docker(_create_container_args(self.spec))
                return
            if not existing.get("State", {}).get("Running", False):
                self._docker(["start", self.spec.container_name])
            return
        self._docker(_create_container_args(self.spec))

    def stop(self) -> None:
        self._docker(["stop", "--time", "5", self.spec.container_name], check=False)

    def delete(self, file_path: str) -> DeleteResult:
        path = _sandbox_path(file_path)
        result = self._exec(f"rm -rf -- {shlex.quote(path)}")
        return DeleteResult(
            error=None if result.exit_code == 0 else result.output,
            path=file_path if result.exit_code == 0 else None,
        )

    def cleanup(self) -> None:
        self._docker(["rm", "-f", self.spec.container_name], check=False)

    def ls(self, path: str) -> LsResult:
        target = _sandbox_path(path)
        script = (
            "python - <<'PY'\n"
            "import json, os, sys\n"
            f"path={target!r}\n"
            "if not os.path.exists(path):\n"
            "    print(json.dumps({'error':'file_not_found'})); sys.exit(0)\n"
            "if os.path.isfile(path):\n"
            "    entries=[{'path':path,'is_dir':False}]\n"
            "else:\n"
            "    entries=[{'path':os.path.join(path,name),'is_dir':os.path.isdir(os.path.join(path,name))} for name in sorted(os.listdir(path))]\n"
            "print(json.dumps({'entries': entries}))\n"
            "PY"
        )
        result = self._exec(script)
        payload = _json_payload(result.output)
        if result.exit_code != 0:
            return LsResult(error=result.output)
        if payload.get("error"):
            return LsResult(error=str(payload["error"]))
        return LsResult(entries=payload.get("entries") or [])

    def read(self, file_path: str, offset: int = 0, limit: int = 2000):
        path = _sandbox_path(file_path)
        script = (
            "python - <<'PY'\n"
            "import base64, json, os\n"
            f"path={path!r}; offset={offset!r}; limit={limit!r}\n"
            "if not os.path.exists(path):\n"
            "    print(json.dumps({'error':'file_not_found'})); raise SystemExit\n"
            "if os.path.isdir(path):\n"
            "    print(json.dumps({'error':'is_directory'})); raise SystemExit\n"
            "data=open(path,'rb').read()\n"
            "chunk=data[max(offset,0):max(offset,0)+max(limit,0)]\n"
            "try:\n"
            "    content=chunk.decode('utf-8'); encoding='utf-8'\n"
            "except UnicodeDecodeError:\n"
            "    content=base64.b64encode(chunk).decode('ascii'); encoding='base64'\n"
            "print(json.dumps({'file_data': {'content': content, 'encoding': encoding}}))\n"
            "PY"
        )
        result = self._exec(script)
        from deepagents.backends.protocol import ReadResult

        payload = _json_payload(result.output)
        if result.exit_code != 0:
            return ReadResult(error=result.output)
        if payload.get("error"):
            return ReadResult(error=str(payload["error"]))
        return ReadResult(file_data=payload.get("file_data"))

    def write(self, file_path: str, content: str) -> WriteResult:
        path = _sandbox_path(file_path)
        encoded = base64.b64encode(content.encode("utf-8"))
        script = (
            "python - <<'PY'\n"
            "import base64, os\n"
            f"path={path!r}; data={encoded!r}\n"
            "os.makedirs(os.path.dirname(path), exist_ok=True)\n"
            "open(path,'wb').write(base64.b64decode(data))\n"
            "PY"
        )
        result = self._exec(script)
        return WriteResult(
            error=None if result.exit_code == 0 else result.output,
            path=file_path if result.exit_code == 0 else None,
        )

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ) -> EditResult:
        path = _sandbox_path(file_path)
        script = (
            "python - <<'PY'\n"
            "import json, pathlib\n"
            f"path=pathlib.Path({path!r}); old={old_string!r}; new={new_string!r}; replace_all={replace_all!r}\n"
            "text=path.read_text(encoding='utf-8')\n"
            "count=text.count(old)\n"
            "if count == 0:\n"
            "    print(json.dumps({'occurrences': 0, 'error': 'old_string_not_found'})); raise SystemExit\n"
            "updated=text.replace(old, new) if replace_all else text.replace(old, new, 1)\n"
            "path.write_text(updated, encoding='utf-8')\n"
            "print(json.dumps({'occurrences': count if replace_all else 1}))\n"
            "PY"
        )
        result = self._exec(script)
        payload = _json_payload(result.output)
        if result.exit_code != 0 and not payload:
            return EditResult(error=result.output)
        if payload.get("error"):
            return EditResult(error=str(payload["error"]), occurrences=payload.get("occurrences"))
        return EditResult(path=file_path, occurrences=payload.get("occurrences"))

    def grep(
        self,
        pattern: str,
        path: str | None = None,
        glob: str | None = None,
        *,
        max_count: int | None = None,
    ) -> GrepResult:
        target = _sandbox_path(path or "/")
        script = (
            "python - <<'PY'\n"
            "import fnmatch, json, os\n"
            f"needle={pattern!r}; root={target!r}; glob_pat={glob!r}; max_count={max_count!r}\n"
            "matches=[]\n"
            "for current, dirs, files in os.walk(root):\n"
            "    dirs[:] = [d for d in dirs if d not in {'.git'}]\n"
            "    for name in files:\n"
            "        path=os.path.join(current,name)\n"
            "        rel=os.path.relpath(path, root)\n"
            "        if glob_pat and not fnmatch.fnmatch(rel, glob_pat):\n"
            "            continue\n"
            "        try:\n"
            "            lines=open(path, encoding='utf-8', errors='ignore').read().splitlines()\n"
            "        except OSError:\n"
            "            continue\n"
            "        for idx,line in enumerate(lines, 1):\n"
            "            if needle in line:\n"
            "                matches.append({'path': path, 'line': idx, 'text': line})\n"
            "                if max_count and len(matches) >= max_count:\n"
            "                    print(json.dumps({'matches': matches, 'truncated': True})); raise SystemExit\n"
            "print(json.dumps({'matches': matches, 'truncated': False}))\n"
            "PY"
        )
        result = self._exec(script)
        payload = _json_payload(result.output)
        if result.exit_code != 0:
            return GrepResult(error=result.output, truncated=False)
        return GrepResult(
            matches=payload.get("matches") or [],
            truncated=bool(payload.get("truncated", False)),
        )

    def glob(self, pattern: str, path: str | None = None) -> GlobResult:
        target = _sandbox_path(path or "/")
        script = (
            "python - <<'PY'\n"
            "import glob, json, os\n"
            f"root={target!r}; pattern={pattern!r}\n"
            "matches=[]\n"
            "for path in sorted(glob.glob(os.path.join(root, pattern), recursive=True))[:10000]:\n"
            "    matches.append({'path': path, 'is_dir': os.path.isdir(path)})\n"
            "print(json.dumps({'matches': matches}))\n"
            "PY"
        )
        result = self._exec(script)
        payload = _json_payload(result.output)
        if result.exit_code != 0:
            return GlobResult(error=result.output)
        return GlobResult(matches=payload.get("matches") or [])

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        responses: list[FileUploadResponse] = []
        for path, content in files:
            target = _sandbox_path(path)
            script = (
                "import os, sys\n"
                "path=sys.argv[1]\n"
                "os.makedirs(os.path.dirname(path), exist_ok=True)\n"
                "open(path,'wb').write(sys.stdin.buffer.read())\n"
            )
            self.ensure_running()
            result = self._docker(
                [
                    "exec",
                    "-i",
                    "--workdir",
                    REPOSITORY_ROOT,
                    self.spec.container_name,
                    "python",
                    "-c",
                    script,
                    target,
                ],
                check=False,
                timeout=DEFAULT_EXEC_TIMEOUT,
                input_bytes=content,
            )
            output = (result.stdout + result.stderr).decode(
                "utf-8",
                errors="replace",
            )
            responses.append(
                FileUploadResponse(
                    path=path,
                    error=None if result.returncode == 0 else output,
                )
            )
        return responses

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        responses: list[FileDownloadResponse] = []
        for path in paths:
            target = _sandbox_path(path)
            script = f"base64 -w0 -- {shlex.quote(target)}"
            result = self._exec(script)
            if result.exit_code != 0:
                responses.append(FileDownloadResponse(path=path, error=result.output))
                continue
            responses.append(
                FileDownloadResponse(path=path, content=base64.b64decode(result.output))
            )
        return responses

    def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
        return self._exec(command, timeout=timeout)

    def _exec(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
        self.ensure_running()
        args = [
            "exec",
            "--workdir",
            REPOSITORY_ROOT,
            self.spec.container_name,
            "bash",
            "-lc",
            command,
        ]
        result = self._docker(args, check=False, timeout=timeout or DEFAULT_EXEC_TIMEOUT)
        output = (result.stdout + result.stderr).decode("utf-8", errors="replace")
        return ExecuteResponse(output=output, exit_code=result.returncode)

    def _inspect(self) -> dict[str, Any] | None:
        result = self._docker(
            ["inspect", self.spec.container_name],
            check=False,
            timeout=10,
        )
        if result.returncode != 0:
            return None
        payload = json.loads(result.stdout.decode("utf-8"))
        return payload[0] if payload else None

    def _docker(
        self,
        args: Sequence[str],
        *,
        check: bool = True,
        timeout: int | None = None,
        input_bytes: bytes | None = None,
    ) -> subprocess.CompletedProcess[bytes]:
        result = self._runner(["docker", *args], input_bytes, timeout)
        if check and result.returncode != 0:
            output = (result.stdout + result.stderr).decode("utf-8", errors="replace")
            raise RuntimeError(output or f"docker {' '.join(args)} failed")
        return result


class DockerSandboxManager:
    """Resolve, reuse, stop and delete deterministic per-thread containers."""

    def __init__(self, *, runner: Runner | None = None) -> None:
        self._runner = runner

    def resolve(self, config: object | None) -> DockerSandboxBackend:
        spec = sandbox_spec_from_config(config)
        backend = DockerSandboxBackend(spec, runner=self._runner)
        backend.ensure_running()
        return backend

    def stop(self, thread_id: str) -> None:
        DockerSandboxBackend(DockerSandboxSpec(thread_id), runner=self._runner).stop()

    def delete(self, thread_id: str) -> None:
        DockerSandboxBackend(DockerSandboxSpec(thread_id), runner=self._runner).cleanup()

    def cleanup_stale(self, *, max_age_seconds: int) -> list[str]:
        if max_age_seconds < 0:
            raise ValueError("max_age_seconds must be non-negative")
        result = (self._runner or _run_docker)(
            [
                "docker",
                "ps",
                "-aq",
                "--filter",
                f"label={SANDBOX_LABEL}=true",
            ],
            None,
            30,
        )
        if result.returncode != 0:
            output = (result.stdout + result.stderr).decode("utf-8", errors="replace")
            raise RuntimeError(output or "failed to list LCSP repository sandboxes")
        deleted: list[str] = []
        now = datetime.now(timezone.utc)
        for container_id in result.stdout.decode("utf-8").splitlines():
            container_id = container_id.strip()
            if not container_id:
                continue
            inspect = (self._runner or _run_docker)(
                ["docker", "inspect", container_id],
                None,
                10,
            )
            if inspect.returncode != 0:
                continue
            payload = json.loads(inspect.stdout.decode("utf-8"))
            container = payload[0] if payload else {}
            created = _parse_docker_timestamp(str(container.get("Created") or ""))
            if created is None:
                continue
            if (now - created).total_seconds() >= max_age_seconds:
                name = str(container.get("Name") or container_id).lstrip("/")
                (self._runner or _run_docker)(
                    ["docker", "rm", "-f", container_id],
                    None,
                    30,
                )
                deleted.append(name)
        return deleted


def sandbox_spec_from_config(config: object | None) -> DockerSandboxSpec:
    configurable = _configurable(config)
    thread_id = str(configurable.get("thread_id") or "").strip()
    if not thread_id:
        raise RuntimeError("LCSP repository sandbox requires configurable.thread_id")
    snapshot_key = _snapshot_key(configurable)
    return DockerSandboxSpec(
        thread_id=thread_id,
        snapshot_key=snapshot_key,
        image=os.getenv("LCSP_REPOSITORY_SANDBOX_IMAGE", DEFAULT_IMAGE),
        network=os.getenv("LCSP_REPOSITORY_SANDBOX_NETWORK", DEFAULT_NETWORK),
        cpus=os.getenv("LCSP_REPOSITORY_SANDBOX_CPUS", DEFAULT_CPUS),
        memory=os.getenv("LCSP_REPOSITORY_SANDBOX_MEMORY", DEFAULT_MEMORY),
        pids_limit=os.getenv("LCSP_REPOSITORY_SANDBOX_PIDS_LIMIT", DEFAULT_PIDS_LIMIT),
    )


def _create_container_args(spec: DockerSandboxSpec) -> list[str]:
    command = (
        f"mkdir -p {shlex.quote(REPOSITORY_ROOT)} {shlex.quote(REPOSITORIES_ROOT)} {shlex.quote(RUNTIME_ROOT)} "
        f"{shlex.quote(RUNTIME_ROOT + '/home')} "
        f"{shlex.quote(RUNTIME_ROOT + '/cache')} "
        f"{shlex.quote(RUNTIME_ROOT + '/codebase-memory')} /tmp "
        "&& exec sleep infinity"
    )
    return [
        "run",
        "-d",
        "--name",
        spec.container_name,
        # PID 1 is `sleep`, which never reaps. Codebase Memory's CLI leaves a detached
        # child behind on every invocation; orphans reparent to PID 1 and stay zombies,
        # each holding a slot of --pids-limit until the sandbox can no longer fork.
        # A reaping init (docker-init) keeps the pid budget flat.
        "--init",
        "--label",
        f"{SANDBOX_LABEL}=true",
        "--label",
        f"{THREAD_LABEL}={spec.safe_thread_hash}",
        "--label",
        f"{IMAGE_LABEL}={spec.image}",
        "--network",
        spec.network,
        "--cpus",
        spec.cpus,
        "--memory",
        spec.memory,
        "--pids-limit",
        spec.pids_limit,
        "--security-opt",
        "no-new-privileges",
        "--cap-drop",
        "ALL",
        "--user",
        "1000:1000",
        "--env",
        f"HOME={RUNTIME_ROOT}/home",
        "--env",
        f"XDG_CACHE_HOME={RUNTIME_ROOT}/cache",
        "--env",
        f"CBM_CACHE_DIR={RUNTIME_ROOT}/codebase-memory",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,noexec,mode=1777,size=256m",
        "--tmpfs",
        "/workspace/runtime:rw,nosuid,nodev,mode=1777,size=512m",
        "--tmpfs",
        "/workspace/repository:rw,nosuid,nodev,mode=1777,size=2048m",
        "--entrypoint",
        "bash",
        spec.image,
        "-lc",
        command,
    ]


def _container_matches_spec(container: Mapping[str, Any], spec: DockerSandboxSpec) -> bool:
    config = container.get("Config") if isinstance(container.get("Config"), Mapping) else {}
    host_config = (
        container.get("HostConfig")
        if isinstance(container.get("HostConfig"), Mapping)
        else {}
    )
    labels = config.get("Labels") if isinstance(config.get("Labels"), Mapping) else {}
    if labels.get(IMAGE_LABEL) != spec.image:
        return False
    if labels.get(SANDBOX_LABEL) != "true":
        return False
    if labels.get(THREAD_LABEL) != spec.safe_thread_hash:
        return False
    if host_config.get("Privileged"):
        return False
    if host_config.get("NetworkMode") != spec.network:
        return False
    if str(host_config.get("PidsLimit")) != spec.pids_limit:
        return False
    if str(host_config.get("Memory")) != str(_memory_bytes(spec.memory)):
        return False
    expected_nano_cpus = _nano_cpus(spec.cpus)
    if expected_nano_cpus is not None and host_config.get("NanoCpus") != expected_nano_cpus:
        return False
    security_opts = set(host_config.get("SecurityOpt") or [])
    cap_drop = set(host_config.get("CapDrop") or [])
    binds = host_config.get("Binds") or []
    return (
        any(str(opt).startswith("no-new-privileges") for opt in security_opts)
        and "ALL" in cap_drop
        and not binds
    )


def _nano_cpus(cpus: str) -> int | None:
    try:
        return int(float(cpus) * 1_000_000_000)
    except ValueError:
        return None


def _memory_bytes(memory: str) -> int | None:
    value = memory.strip().lower()
    units = {"k": 1024, "m": 1024**2, "g": 1024**3}
    try:
        if value[-1] in units:
            return int(float(value[:-1]) * units[value[-1]])
        return int(value)
    except (ValueError, IndexError):
        return None


def _parse_docker_timestamp(value: str) -> datetime | None:
    if not value:
        return None
    normalized = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _sandbox_path(path: str) -> str:
    value = path.strip() or "/"
    pure = PurePosixPath(value)
    parts = pure.parts[1:] if pure.is_absolute() else pure.parts
    if any(part in {"..", "~"} for part in parts):
        raise ValueError("sandbox paths cannot escape the container workspace")
    normalized = posixpath.normpath(
        "/" + "/".join(part for part in parts if part not in {"", "."})
    )
    if normalized == "/":
        return REPOSITORY_ROOT
    if normalized == "/tmp" or normalized.startswith("/tmp/"):
        return normalized
    for allowed_root in (REPOSITORY_ROOT, REPOSITORIES_ROOT, RUNTIME_ROOT):
        if normalized == allowed_root or normalized.startswith(f"{allowed_root}/"):
            return normalized
    return posixpath.normpath(posixpath.join(REPOSITORY_ROOT, normalized.lstrip("/")))


def _configurable(config: object | None) -> Mapping[str, Any]:
    if isinstance(config, Mapping):
        value = config.get("configurable")
        return value if isinstance(value, Mapping) else config
    return {}


def _snapshot_key(configurable: Mapping[str, Any]) -> str:
    pieces = [
        str(configurable.get("assessment_id") or ""),
        str(configurable.get("snapshot_id") or ""),
        str(configurable.get("scan_job_id") or ""),
        str(configurable.get("commit_sha") or ""),
    ]
    return hashlib.sha256("\0".join(pieces).encode("utf-8")).hexdigest()


def _json_payload(output: str) -> dict[str, Any]:
    try:
        payload = json.loads(output.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _run_docker(
    args: Sequence[str],
    input_bytes: bytes | None,
    timeout: int | None,
) -> subprocess.CompletedProcess[bytes]:
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(FORBIDDEN_ENV_PREFIXES)
    }
    return subprocess.run(
        list(args),
        input=input_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=False,
        env=env,
    )


__all__ = [
    "DEFAULT_IMAGE",
    "DockerSandboxBackend",
    "DockerSandboxManager",
    "DockerSandboxSpec",
    "REPOSITORY_ROOT",
    "RUNTIME_ROOT",
    "sandbox_spec_from_config",
]
