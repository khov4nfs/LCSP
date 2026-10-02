from __future__ import annotations

import importlib
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from collections.abc import Mapping
from pathlib import Path
from uuid import uuid4

import pytest
from langgraph_sdk import get_sync_client

from tools.common.capabilities.agent_runtime.agent_server_client import (
    agent_thread_id,
    dispatch_agent_runtime_event,
)
from tools.common.capabilities.platform.docker_sandbox import (
    DockerSandboxBackend,
    DockerSandboxSpec,
)
from tools.common.capabilities.platform.repository_sandbox import (
    activate_repository_backend,
    current_repository_backend,
    repository_database_backend,
)
from tests.integration.test_docker_sandbox_e2e import _fixture_archive


PROJECT_ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.integration
@pytest.mark.e2e
def test_local_deep_agent_runtime_uses_docker_repository_sandbox(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Prove the migrated local runtime path without LangSmith-managed services.

    The test avoids provider calls; evidence-generation quality is covered by
    model/provider E2E suites. Here we prove the native Deep Agents graph imports,
    the Docker repository backend is the active filesystem/shell surface, and
    Codebase Memory is available inside that sandbox.
    """

    if os.environ.get("LCSP_DOCKER_SANDBOX_E2E") != "1":
        pytest.skip("LCSP_DOCKER_SANDBOX_E2E=1 is required for Docker E2E")

    for key in (
        "LANGSMITH_API_KEY",
        "LANGCHAIN_API_KEY",
        "LANGSMITH_CONTROL_PLANE_API_KEY",
        "LANGGRAPH_CLOUD_LICENSE_KEY",
        "LANGGRAPH_ENTERPRISE_LICENSE_KEY",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    monkeypatch.setenv("LANGCHAIN_TRACING_V2", "false")
    monkeypatch.setenv("OPENAI_API_KEY", "lcsp-local-import-test")

    root = importlib.import_module("agent")
    assert root.agent is not None
    assert "Compiled" in type(root.agent).__name__

    image = os.environ.get("LCSP_REPOSITORY_SANDBOX_IMAGE", "lcsp-agent-runtime:dev")
    backend = DockerSandboxBackend(
        DockerSandboxSpec(f"agent-runtime-e2e-{uuid4()}", image=image)
    )
    try:
        backend.ensure_running()
        repository = repository_database_backend(backend)
        with activate_repository_backend(backend) as active:
            assert current_repository_backend() is active
            repository.write("app.py", "print('agent runtime sandbox')\n")
            repository.write(
                ".lcsp/repository.json",
                '{"snapshotId":"snapshot-e2e","scanJobId":"scan-e2e"}',
            )

            metadata = repository.read(".lcsp/repository.json")
            assert metadata.error is None
            assert "snapshot-e2e" in metadata.file_data["content"]

            executed = repository.execute("python app.py", timeout=20)
            assert executed.exit_code == 0
            assert "agent runtime sandbox" in executed.output

            cbm = repository.execute("codebase-memory-graph --version", timeout=20)
            assert cbm.exit_code == 0
            assert "codebase-memory-mcp 0.11.0" in cbm.output
    finally:
        backend.cleanup()


@pytest.mark.integration
@pytest.mark.e2e
@pytest.mark.parametrize("server_kind", ["langgraph-dev", "lcsp-local"])
def test_agent_server_dispatch_hydrates_docker_repository_sandbox(
    monkeypatch: pytest.MonkeyPatch,
    server_kind: str,
) -> None:
    """Exercise Agent Server -> middleware -> Docker hydrate -> boundary dispatch."""

    if os.environ.get("LCSP_DOCKER_SANDBOX_E2E") != "1":
        pytest.skip("LCSP_DOCKER_SANDBOX_E2E=1 is required for Docker E2E")

    image = os.environ.get("LCSP_REPOSITORY_SANDBOX_IMAGE", "lcsp-agent-runtime:dev")
    inspect = subprocess.run(
        ["docker", "image", "inspect", image],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=30,
    )
    if inspect.returncode != 0:
        pytest.fail(f"Docker sandbox image is missing: {image}")

    api = _FakeRepositorySnapshotApi(_fixture_archive())
    api.start()
    graph_port = _free_port()
    graph_url = f"http://127.0.0.1:{graph_port}"
    event = {
        "scanJobId": f"scan-server-e2e-{uuid4()}",
        "snapshotId": "snapshot-server-e2e",
        "commitSha": "abcdef1",
        "expectedPath": "src/app.py",
    }
    correlation_id = f"corr-server-e2e-{uuid4()}"
    thread_id = agent_thread_id(
        "agent_runtime_health_requested",
        event,
        correlation_id,
    )
    backend = DockerSandboxBackend(DockerSandboxSpec(thread_id, image=image))
    process: subprocess.Popen[bytes] | None = None
    try:
        env = {
            **os.environ,
            "PYTHONPATH": ".",
            "OPENAI_API_KEY": "lcsp-local-agent-server-e2e",
            "NESTJS_API_BASE_URL": api.url,
            "WORKER_API_KEY": "test-worker-key",
            "LCSP_AGENT_SERVER_URL": graph_url,
            "LCSP_REPOSITORY_SANDBOX_IMAGE": image,
            "LCSP_ENABLE_REMOTE_MCP": "false",
            "LANGSMITH_TRACING": "false",
            "LANGCHAIN_TRACING_V2": "false",
            "UV_CACHE_DIR": os.environ.get("UV_CACHE_DIR", "/tmp/uv-cache"),
        }
        for key in (
            "LANGSMITH_API_KEY",
            "LANGCHAIN_API_KEY",
            "LANGSMITH_CONTROL_PLANE_API_KEY",
            "LANGGRAPH_CLOUD_LICENSE_KEY",
            "LANGGRAPH_ENTERPRISE_LICENSE_KEY",
        ):
            env.pop(key, None)
            monkeypatch.delenv(key, raising=False)
        monkeypatch.setenv("LCSP_AGENT_SERVER_URL", graph_url)

        process = _start_agent_server(server_kind, graph_port, env)
        health_path = "/docs" if server_kind == "langgraph-dev" else "/ok"
        _wait_for_http(graph_url, path=health_path)

        dispatch_agent_runtime_event(
            "agent_runtime_health_requested",
            event,
            correlation_id,
        )
        state = get_sync_client(url=graph_url).threads.get_state(thread_id)
        values = _thread_state_values(state)
        skills_metadata = values.get("skills_metadata")
        assert isinstance(skills_metadata, list)
        assert any(
            _skill_value(skill, "name") == "lcsp" for skill in skills_metadata
        )
        skill_errors = (
            values.get("skills_load_errors") or values.get("skills_errors") or []
        )
        assert all("file_not_found" not in str(error) for error in skill_errors)

        assert api.archive_requests == 1

        app = backend.read("/workspace/repository/src/app.py")
        assert app.error is None
        assert app.file_data["content"] == "print('hydrated')\n"

        health = backend.read("/workspace/repository/.lcsp/agent/runtime-health.json")
        assert health.error is None
        assert "AgentRuntimeHealthBoundary" in health.file_data["content"]
        assert event["expectedPath"] in health.file_data["content"]
    finally:
        backend.cleanup()
        if process is not None:
            _stop_process(process)
        api.stop()


class _FakeRepositorySnapshotApi:
    def __init__(self, archive: bytes) -> None:
        self.archive = archive
        self.archive_requests = 0
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self._thread = threading.Thread(
            target=self._server.serve_forever,
            name="lcsp-fake-snapshot-api",
            daemon=True,
        )

    @property
    def url(self) -> str:
        host, port = self._server.server_address
        return f"http://{host}:{port}"

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)

    def _handler(self):
        api = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                if self.path.startswith(
                    "/internal/repository-snapshots/snapshot-server-e2e/archive"
                ):
                    api.archive_requests += 1
                    self.send_response(200)
                    self.send_header("Content-Type", "application/gzip")
                    self.end_headers()
                    self.wfile.write(api.archive)
                    return
                self.send_response(404)
                self.end_headers()

            def log_message(self, _format: str, *_args: object) -> None:
                return

        return Handler


def _start_agent_server(
    server_kind: str,
    port: int,
    env: dict[str, str],
) -> subprocess.Popen[bytes]:
    if server_kind == "lcsp-local":
        return _start_lcsp_local_agent_server(port, env)
    if server_kind == "langgraph-dev":
        return _start_langgraph_server(port, env)
    raise AssertionError(f"unknown agent server kind: {server_kind}")


def _start_langgraph_server(
    port: int,
    env: dict[str, str],
) -> subprocess.Popen[bytes]:
    executable = Path(sys.executable).with_name("langgraph")
    command = [
        str(executable if executable.exists() else "langgraph"),
        "dev",
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
        "--no-browser",
        "--no-reload",
        "--allow-blocking",
    ]
    return subprocess.Popen(
        command,
        cwd=PROJECT_ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )


def _start_lcsp_local_agent_server(
    port: int,
    env: dict[str, str],
) -> subprocess.Popen[bytes]:
    command = [
        sys.executable,
        "-m",
        "tools.common.capabilities.agent_runtime.local_server",
    ]
    return subprocess.Popen(
        command,
        cwd=PROJECT_ROOT,
        env={**env, "PORT": str(port), "LCSP_AGENT_RUNTIME_MODE": "development"},
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )


def _wait_for_http(url: str, *, path: str) -> None:
    deadline = time.monotonic() + 90
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{url}{path}", timeout=2) as response:
                if response.status < 500:
                    return
        except (OSError, urllib.error.URLError) as error:
            last_error = error
        time.sleep(0.5)
    raise AssertionError(f"LangGraph server did not start: {last_error!r}")


def _stop_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


def _free_port() -> int:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _thread_state_values(state: object) -> Mapping[str, object]:
    if isinstance(state, Mapping):
        values = state.get("values")
        return values if isinstance(values, Mapping) else {}
    values = getattr(state, "values", None)
    return values if isinstance(values, Mapping) else {}


def _skill_value(skill: object, key: str) -> object:
    if isinstance(skill, Mapping):
        return skill.get(key)
    return getattr(skill, key, None)
