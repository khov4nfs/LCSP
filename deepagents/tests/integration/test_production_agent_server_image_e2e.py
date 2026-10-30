from __future__ import annotations

import os
import json
import subprocess
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import uuid4

import pytest
from langgraph_sdk import get_sync_client

from tests.integration.test_docker_sandbox_e2e import _fixture_archive
from tests.integration.test_local_agent_runtime_e2e import (
    _free_port,
    _thread_state_values,
)
from tools.common.capabilities.agent_runtime.agent_server_client import (
    agent_thread_id,
    dispatch_agent_runtime_event,
)
from tools.common.capabilities.platform.docker_sandbox import (
    DockerSandboxBackend,
    DockerSandboxSpec,
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]
LICENSE_ENV_KEYS = (
    "LANGSMITH_API_KEY",
    "LANGCHAIN_API_KEY",
    "LANGSMITH_CONTROL_PLANE_API_KEY",
    "LANGGRAPH_CLOUD_LICENSE_KEY",
    "LANGGRAPH_ENTERPRISE_LICENSE_KEY",
)


@pytest.mark.integration
@pytest.mark.e2e
def test_production_agent_server_image_runs_without_license_and_persists_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Exercise the actual production image with durable Postgres checkpointing."""

    if os.environ.get("LCSP_PRODUCTION_AGENT_SERVER_IMAGE_E2E") != "1":
        pytest.skip(
            "LCSP_PRODUCTION_AGENT_SERVER_IMAGE_E2E=1 is required for "
            "production Agent Server image E2E"
        )

    server_image = os.environ.get(
        "LCSP_PRODUCTION_AGENT_SERVER_IMAGE",
        "lcsp-agent-runtime-server:ci",
    )
    sandbox_image = os.environ.get(
        "LCSP_REPOSITORY_SANDBOX_IMAGE",
        "lcsp-agent-runtime:dev",
    )
    _require_image(server_image)
    _require_image(sandbox_image)

    unique = uuid4().hex[:12]
    network_name = f"lcsp-agent-server-e2e-{unique}"
    postgres_name = f"{network_name}-postgres"
    server_name = f"{network_name}-server"
    api = _SnapshotApi(_fixture_archive())
    api.start()
    graph_port = _free_port()
    graph_url = f"http://127.0.0.1:{graph_port}"
    checkpoint_url = (
        f"postgresql://postgres:postgres@{postgres_name}:5432/lcsp_langgraph"
    )
    event = {
        "scanJobId": f"scan-production-image-e2e-{unique}",
        "snapshotId": "snapshot-production-image-e2e",
        "commitSha": "abcdef1",
        "expectedPath": "src/app.py",
    }
    correlation_id = f"corr-production-image-e2e-{unique}"
    thread_id = agent_thread_id(
        "agent_runtime_health_requested",
        event,
        correlation_id,
    )
    sandbox = DockerSandboxBackend(DockerSandboxSpec(thread_id, image=sandbox_image))

    try:
        _docker(["network", "create", network_name], timeout=30)
        _docker(
            [
                "run",
                "-d",
                "--name",
                postgres_name,
                "--network",
                network_name,
                "-e",
                "POSTGRES_USER=postgres",
                "-e",
                "POSTGRES_PASSWORD=postgres",
                "-e",
                "POSTGRES_DB=lcsp_langgraph",
                "postgres:16",
            ],
            timeout=60,
        )
        _wait_for_postgres(postgres_name)

        _start_server_container(
            server_name=server_name,
            server_image=server_image,
            sandbox_image=sandbox_image,
            network_name=network_name,
            graph_port=graph_port,
            api_url=api.container_url,
            checkpoint_url=checkpoint_url,
        )
        _wait_for_http(graph_url, "/health")

        for key in LICENSE_ENV_KEYS:
            monkeypatch.delenv(key, raising=False)
        monkeypatch.setenv("LCSP_AGENT_SERVER_URL", graph_url)
        monkeypatch.setenv("LANGSMITH_TRACING", "false")
        monkeypatch.setenv("LANGCHAIN_TRACING_V2", "false")

        dispatch_agent_runtime_event(
            "agent_runtime_health_requested",
            event,
            correlation_id,
        )
        state = get_sync_client(url=graph_url).threads.get_state(thread_id)
        values = _thread_state_values(state)
        checkpoint = state["checkpoint"]
        assert checkpoint["thread_id"] == thread_id
        assert checkpoint["checkpoint_id"]
        assert not values.get("skills_metadata")
        assert api.archive_requests == 1
        assert api.root_reservation_requests == 0
        health = sandbox.read("/workspace/repository/.lcsp/agent/runtime-health.json")
        assert health.error is None
        assert "AgentRuntimeHealthBoundary" in health.file_data["content"]
        assert event["expectedPath"] in health.file_data["content"]

        _docker(["rm", "-f", server_name], check=False, timeout=30)
        _start_server_container(
            server_name=server_name,
            server_image=server_image,
            sandbox_image=sandbox_image,
            network_name=network_name,
            graph_port=graph_port,
            api_url=api.container_url,
            checkpoint_url=checkpoint_url,
        )
        _wait_for_http(graph_url, "/health")

        restarted_state = get_sync_client(url=graph_url).threads.get_state(thread_id)
        restarted_values = _thread_state_values(restarted_state)
        assert restarted_state["checkpoint"] == checkpoint
        assert restarted_values == values
        assert not restarted_values.get("skills_metadata")
        assert api.registration_requests == 2
        assert api.root_reservation_requests == 0
    finally:
        sandbox.cleanup()
        _docker(["rm", "-f", server_name], check=False, timeout=30)
        _docker(["rm", "-f", postgres_name], check=False, timeout=30)
        _docker(["network", "rm", network_name], check=False, timeout=30)
        api.stop()


class _SnapshotApi:
    def __init__(self, archive: bytes) -> None:
        self.archive = archive
        self.archive_requests = 0
        # This fixture exercises an unrelated boundary, not Assessment authority.
        # Real Root admission/limits are tested with the API/PostgreSQL load stack.
        self.registration_requests = 0
        self.root_reservation_requests = 0
        self._capacity_version = 0
        self._capacity_owner = None
        self._capacity_lock = threading.Lock()
        self._server = ThreadingHTTPServer(("0.0.0.0", 0), self._handler())
        self._thread = threading.Thread(
            target=self._server.serve_forever,
            name="lcsp-production-image-fake-snapshot-api",
            daemon=True,
        )

    @property
    def container_url(self) -> str:
        _host, port = self._server.server_address[:2]
        return f"http://host.docker.internal:{port}"

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)

    def _handler(self):
        api = self

        class Handler(BaseHTTPRequestHandler):
            def _reply(self, status: int, data: dict) -> None:
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(data).encode())

            def _authorized(self) -> bool:
                if self.headers.get("x-worker-api-key") != "test-worker-key":
                    self._reply(403, {"ok": False})
                    return False
                return True

            def do_GET(self) -> None:
                if self.path == "/internal/assessment-root-capacity/registration":
                    if self._authorized():
                        with api._capacity_lock:
                            self._reply(200, {"ok": True, "data": {"version": api._capacity_version}})
                    return
                if self.path.startswith("/internal/repository-snapshots/") and (
                    self.path.endswith("/archive")
                    or "/archive?" in self.path
                ):
                    api.archive_requests += 1
                    self.send_response(200)
                    self.send_header("Content-Type", "application/gzip")
                    self.end_headers()
                    self.wfile.write(api.archive)
                    return
                self.send_response(404)
                self.end_headers()

            def do_POST(self) -> None:
                if not self.path.startswith("/internal/assessment-root-capacity/"):
                    self._reply(404, {"ok": False}); return
                if not self._authorized(): return
                payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
                with api._capacity_lock:
                    if self.path.endswith("/reserve"):
                        api.root_reservation_requests += 1
                        self._reply(200, {"ok": True, "data": {"admitted": False}}); return
                    if payload.get("expectedVersion") != api._capacity_version:
                        self._reply(409, {"ok": False}); return
                    owner = (payload.get("hostId"), payload.get("incarnationId"))
                    if self.path.endswith("/register"):
                        assert payload["liveRunIds"] == []
                        api._capacity_owner = owner
                        api.registration_requests += 1
                    elif self.path.endswith("/report"):
                        if owner != api._capacity_owner:
                            self._reply(409, {"ok": False}); return
                        assert payload["liveRunIds"] == []
                        assert payload["metrics"]["reservedRootRuns"] == 0
                        assert payload["metrics"]["activeNativeRoots"] == 0
                    else:
                        self._reply(404, {"ok": False}); return
                    api._capacity_version += 1
                    self._reply(200, {"ok": True, "data": {"version": api._capacity_version,
                        "desired": 0, "effective": 0, "evaluationSeconds": 15}})

            def log_message(self, _format: str, *_args: object) -> None:
                return

        return Handler


def _start_server_container(
    *,
    server_name: str,
    server_image: str,
    sandbox_image: str,
    network_name: str,
    graph_port: int,
    api_url: str,
    checkpoint_url: str,
) -> None:
    _docker(
        [
            "run",
            "-d",
            "--name",
            server_name,
            "--network",
            network_name,
            "--add-host",
            "host.docker.internal:host-gateway",
            "-p",
            f"127.0.0.1:{graph_port}:8000",
            "-v",
            "/var/run/docker.sock:/var/run/docker.sock",
            # Explicit identity fixture for a production-mode image; never invent
            # a host identity when the slim image has no machine-id file.
            "--mount",
            "type=bind,src=/etc/machine-id,dst=/etc/machine-id,readonly",
            "-e",
            "LCSP_AGENT_RUNTIME_MODE=production",
            "-e",
            f"LANGGRAPH_CHECKPOINT_DATABASE_URL={checkpoint_url}",
            "-e",
            f"LCSP_API_BASE_URL={api_url}",
            "-e",
            f"NESTJS_API_BASE_URL={api_url}",
            "-e",
            "WORKER_API_KEY=test-worker-key",
            "-e",
            f"LCSP_REPOSITORY_SANDBOX_IMAGE={sandbox_image}",
            "-e",
            "LCSP_ENABLE_REMOTE_MCP=false",
            "-e",
            "LANGSMITH_TRACING=false",
            "-e",
            "LANGCHAIN_TRACING_V2=false",
            "-e",
            "OPENAI_API_KEY=lcsp-production-image-smoke",
            "-e",
            "MIRAI_API_KEY=lcsp-production-image-smoke",
            server_image,
        ],
        timeout=60,
    )


def _require_image(image: str) -> None:
    result = _docker(["image", "inspect", image], check=False, timeout=30)
    if result.returncode != 0:
        pytest.fail(f"Docker image is missing: {image}")


def _wait_for_postgres(container_name: str) -> None:
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        result = _docker(
            [
                "exec",
                container_name,
                "pg_isready",
                "-U",
                "postgres",
                "-d",
                "lcsp_langgraph",
            ],
            check=False,
            timeout=10,
        )
        if result.returncode == 0:
            return
        time.sleep(1)
    logs = _docker(["logs", container_name], check=False, timeout=10)
    raise AssertionError(
        "Postgres container did not become ready:\n"
        f"{logs.stdout.decode(errors='replace')}"
        f"{logs.stderr.decode(errors='replace')}"
    )


def _wait_for_http(url: str, path: str) -> None:
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
    raise AssertionError(f"Agent Server image did not become healthy: {last_error!r}")


def _docker(
    args: list[str],
    *,
    check: bool = True,
    timeout: int,
) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        ["docker", *args],
        cwd=PROJECT_ROOT.parent,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=check,
        timeout=timeout,
    )
