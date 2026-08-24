"""Local Docker sandbox backend for LCSP Deep Agents.

The worker owns Docker orchestration. Deep Agents receive a sandbox backend, but
the model never receives host shell access or the Docker socket.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from deepagents.backends.protocol import (
    ExecuteResponse,
    FileDownloadResponse,
    FileUploadResponse,
)
from deepagents.backends.sandbox import BaseSandbox


_SAFE_SCOPE_PATTERN = re.compile(r"[^a-zA-Z0-9_.-]+")


@dataclass(frozen=True)
class DockerSandboxConfig:
    image: str
    network: str
    cpus: str
    memory: str
    timeout_seconds: int
    output_root: Path
    workspace_root: Path | None
    openwiki_root: Path | None
    scope: str
    per_workflow: bool


class DockerSandboxBackend(BaseSandbox):
    """Deep Agents sandbox backend backed only by local Docker containers."""

    enable_capture_offload = True

    def __init__(self, config: DockerSandboxConfig) -> None:
        self.config = config
        self.output_dir.mkdir(parents=True, exist_ok=True)

    @property
    def id(self) -> str:
        lifetime = "workflow" if self.config.per_workflow else "run"
        return f"lcsp-docker-{lifetime}-{self.config.scope}"

    @property
    def output_dir(self) -> Path:
        return self.config.output_root / self.config.scope

    def execute(
        self,
        command: str,
        *,
        timeout: int | None = None,
    ) -> ExecuteResponse:
        docker = shutil.which("docker")
        if docker is None:
            return ExecuteResponse(
                output="Docker sandbox is required but docker was not found in PATH.",
                exit_code=127,
            )
        effective_timeout = timeout or self.config.timeout_seconds
        args = [
            docker,
            "run",
            "--rm",
            "--network",
            self.config.network,
            "--cpus",
            self.config.cpus,
            "--memory",
            self.config.memory,
            "--pids-limit",
            "256",
            "--security-opt",
            "no-new-privileges",
            "--cap-drop",
            "ALL",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,size=512m",
            "--workdir",
            "/sandbox",
            "-v",
            f"{self.output_dir}:/sandbox:rw",
        ]
        if self.config.workspace_root is not None:
            args.extend(["-v", f"{self.config.workspace_root}:/workspace:ro"])
        if self.config.openwiki_root is not None:
            args.extend(["-v", f"{self.config.openwiki_root}:/openwiki:ro"])
        args.extend([self.config.image, "/bin/sh", "-lc", command])
        try:
            completed = subprocess.run(
                args,
                cwd=str(self.output_dir),
                text=True,
                capture_output=True,
                timeout=effective_timeout,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            output = (exc.stdout or "") + (exc.stderr or "")
            return ExecuteResponse(
                output=f"{output}\nDocker sandbox command timed out.",
                exit_code=124,
                truncated=False,
            )
        output = (completed.stdout or "") + (completed.stderr or "")
        truncated = False
        max_bytes = _max_output_bytes()
        if len(output.encode("utf-8", errors="ignore")) > max_bytes:
            output = output.encode("utf-8", errors="ignore")[:max_bytes].decode(
                "utf-8",
                errors="ignore",
            )
            truncated = True
        return ExecuteResponse(
            output=output,
            exit_code=completed.returncode,
            truncated=truncated,
        )

    def upload_files(
        self,
        files: list[tuple[str, bytes]],
    ) -> list[FileUploadResponse]:
        responses: list[FileUploadResponse] = []
        for file_path, content in files:
            target = self._sandbox_path(file_path)
            if target is None:
                responses.append(
                    FileUploadResponse(path=file_path, error="invalid_path")
                )
                continue
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
            except OSError as exc:
                responses.append(FileUploadResponse(path=file_path, error=str(exc)))
                continue
            responses.append(FileUploadResponse(path=file_path))
        return responses

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        responses: list[FileDownloadResponse] = []
        for path in paths:
            target = self._sandbox_path(path)
            if target is None:
                responses.append(
                    FileDownloadResponse(path=path, error="invalid_path")
                )
                continue
            if not target.exists():
                responses.append(
                    FileDownloadResponse(path=path, error="file_not_found")
                )
                continue
            if target.is_dir():
                responses.append(
                    FileDownloadResponse(path=path, error="is_directory")
                )
                continue
            try:
                responses.append(
                    FileDownloadResponse(path=path, content=target.read_bytes())
                )
            except OSError as exc:
                responses.append(FileDownloadResponse(path=path, error=str(exc)))
        return responses

    def _sandbox_path(self, path: str) -> Path | None:
        if not path.startswith("/"):
            return None
        relative = Path(path.lstrip("/"))
        if any(part == ".." for part in relative.parts):
            return None
        target = (self.output_dir / relative).resolve()
        try:
            target.relative_to(self.output_dir.resolve())
        except ValueError:
            return None
        return target


def docker_sandbox_config(
    *,
    workflow_run_id: str,
    node_name: str,
    workspace_root: Path | None,
    openwiki_root: Path | None,
) -> DockerSandboxConfig:
    per_workflow = _per_workflow_sandbox_node(node_name)
    scope_seed = workflow_run_id if per_workflow else f"{workflow_run_id}:{node_name}"
    return DockerSandboxConfig(
        image=os.environ.get(
            "LCSP_DEEP_AGENT_DOCKER_IMAGE",
            "python:3.14-alpine",
        ),
        network=os.environ.get("LCSP_DEEP_AGENT_DOCKER_NETWORK", "none"),
        cpus=os.environ.get("LCSP_DEEP_AGENT_DOCKER_CPUS", "2"),
        memory=os.environ.get("LCSP_DEEP_AGENT_DOCKER_MEMORY", "4g"),
        timeout_seconds=_env_int("LCSP_DEEP_AGENT_DOCKER_TIMEOUT_SECONDS", 300),
        output_root=Path(
            os.environ.get(
                "LCSP_DEEP_AGENT_DOCKER_OUTPUT_ROOT",
                "/tmp/lcsp-deep-agent-sandboxes",
            )
        ),
        workspace_root=workspace_root,
        openwiki_root=openwiki_root,
        scope=_safe_scope(scope_seed),
        per_workflow=per_workflow,
    )


def _per_workflow_sandbox_node(node_name: str) -> bool:
    lowered = node_name.lower()
    return any(
        marker in lowered
        for marker in (
            "investigate_engineering_rule",
            "plan_engineering_rules",
            "build_evidence_graph",
        )
    )


def _safe_scope(value: str) -> str:
    return _SAFE_SCOPE_PATTERN.sub("-", value).strip("-")[:160] or "default"


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(1, value)


def _max_output_bytes() -> int:
    return _env_int("LCSP_DEEP_AGENT_DOCKER_MAX_OUTPUT_BYTES", 100_000)
