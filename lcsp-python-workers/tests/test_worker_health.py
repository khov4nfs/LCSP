from __future__ import annotations

import json
from urllib import error, request

import pytest

from lcsp_workers.platform.config import WorkerConfig
from lcsp_workers.platform.health import (
    DEFAULT_HEALTH_PORT,
    REQUEST_TARGETED_REANALYSIS_ENDPOINT,
    RESUME_WAITING_RUNS_ENDPOINT,
    HealthServer,
    RuntimeCommandResponse,
)
from lcsp_workers.platform.queue_consumer import ConsumerBase


class DummyConsumer(ConsumerBase):
    queue_name = "health.test"
    routing_key = "health.test"

    def handle(self, message: dict, correlationId: str) -> None:
        del message
        del correlationId


@pytest.fixture
def config() -> WorkerConfig:
    return WorkerConfig(
        rabbitmq_url="amqp://guest:guest@localhost/",
        rabbitmq_exchange="test.events",
        nestjs_api_base_url="http://localhost:3000",
        worker_api_key="test-key",
        log_level="INFO",
        max_retries=3,
    )


def _get_json(port: int) -> tuple[int, dict]:
    url = f"http://127.0.0.1:{port}/health"
    try:
        with request.urlopen(url, timeout=2) as response:
            return int(response.status), json.loads(response.read().decode("utf-8"))
    except error.HTTPError as http_error:
        return int(http_error.code), json.loads(http_error.read().decode("utf-8"))


def _post_json(port: int, path: str, payload: dict, api_key: str | None = None) -> tuple[int, dict]:
    req = request.Request(
        url=f"http://127.0.0.1:{port}{path}",
        method="POST",
        headers={
            "Content-Type": "application/json",
            **({ "X-Worker-Api-Key": api_key } if api_key else {}),
        },
        data=json.dumps(payload).encode("utf-8"),
    )
    try:
        with request.urlopen(req, timeout=2) as response:
            return int(response.status), json.loads(response.read().decode("utf-8"))
    except error.HTTPError as http_error:
        return int(http_error.code), json.loads(http_error.read().decode("utf-8"))


@pytest.mark.p1
def test_t01_health_connected_returns_200() -> None:
    server = HealthServer(
        worker_name="ScannerWorker",
        rabbitmq_connected_provider=lambda: True,
        port=0,
        command_handlers={},
    )
    server.start()
    try:
        status_code, payload = _get_json(server.port)
        assert status_code == 200
        assert payload["status"] == "ok"
        assert payload["rabbitmq"] == "connected"
        assert payload["worker"] == "ScannerWorker"
        assert payload["runtime_http"] == "ready"
        assert payload["version"] == "dev"
        assert payload["build_ref"] == "local"
        assert payload["capabilities"] == []
    finally:
        server.stop()


@pytest.mark.p1
def test_t02_health_disconnected_returns_503() -> None:
    server = HealthServer(
        worker_name="ScannerWorker",
        rabbitmq_connected_provider=lambda: False,
        port=0,
        command_handlers={},
    )
    server.start()
    try:
        status_code, payload = _get_json(server.port)
        assert status_code == 503
        assert payload["status"] == "degraded"
        assert payload["rabbitmq"] == "disconnected"
        assert payload["worker"] == "ScannerWorker"
    finally:
        server.stop()


@pytest.mark.p1
def test_t03_health_response_has_no_secrets() -> None:
    server = HealthServer(
        worker_name="ScannerWorker",
        rabbitmq_connected_provider=lambda: True,
        port=0,
        command_handlers={},
    )
    server.start()
    try:
        _, payload = _get_json(server.port)
        rendered = json.dumps(payload)

        assert set(payload.keys()) == {
            "status",
            "rabbitmq",
            "worker",
            "runtime_http",
            "version",
            "build_ref",
            "capabilities",
        }
        assert "rabbitmq_url" not in rendered
        assert "worker_api_key" not in rendered
        assert "queue_name" not in rendered
    finally:
        server.stop()


@pytest.mark.p1
def test_t04_runtime_command_requires_worker_api_key() -> None:
    server = HealthServer(
        worker_name="ScannerWorker",
        rabbitmq_connected_provider=lambda: True,
        port=0,
        api_key="test-key",
        command_handlers={
            REQUEST_TARGETED_REANALYSIS_ENDPOINT: lambda payload, _cid: RuntimeCommandResponse(
                status_code=202,
                payload={"ok": True, "request": payload},
            )
        },
    )
    server.start()
    try:
        status_code, payload = _post_json(
            server.port,
            REQUEST_TARGETED_REANALYSIS_ENDPOINT,
            {"assessmentId": "assessment-1"},
        )
        assert status_code == 401
        assert payload["error"] == "WORKER_API_KEY_INVALID"
    finally:
        server.stop()


@pytest.mark.p1
def test_t05_runtime_command_accepts_json_and_returns_handler_payload() -> None:
    server = HealthServer(
        worker_name="ScannerWorker",
        rabbitmq_connected_provider=lambda: True,
        port=0,
        api_key="test-key",
        command_handlers={
            RESUME_WAITING_RUNS_ENDPOINT: lambda payload, cid: RuntimeCommandResponse(
                status_code=202,
                payload={
                    "ok": True,
                    "correlationId": cid,
                    "corpusVersionId": payload["corpusVersionId"],
                },
            )
        },
    )
    server.start()
    try:
        status_code, payload = _post_json(
            server.port,
            RESUME_WAITING_RUNS_ENDPOINT,
            {"corpusVersionId": "corpus-1"},
            api_key="test-key",
        )
        assert status_code == 202
        assert payload["ok"] is True
        assert payload["corpusVersionId"] == "corpus-1"
    finally:
        server.stop()


@pytest.mark.p1
def test_t06_health_can_surface_version_and_build_metadata() -> None:
    server = HealthServer(
        worker_name="ScannerWorker",
        rabbitmq_connected_provider=lambda: True,
        port=0,
        capabilities=("request_targeted_reanalysis", "resume_waiting_runs"),
        version="2026.08.13",
        build_ref="git:abc123",
        command_handlers={},
    )
    server.start()
    try:
        status_code, payload = _get_json(server.port)
        assert status_code == 200
        assert payload["version"] == "2026.08.13"
        assert payload["build_ref"] == "git:abc123"
        assert payload["capabilities"] == [
            "request_targeted_reanalysis",
            "resume_waiting_runs",
        ]
    finally:
        server.stop()


@pytest.mark.p1
def test_t07_health_port_uses_env(monkeypatch: pytest.MonkeyPatch, config: WorkerConfig) -> None:
    monkeypatch.setenv("HEALTH_PORT", "18080")
    consumer = DummyConsumer(config, pbac_client=None)

    assert consumer._read_health_port() == 18080


@pytest.mark.p1
def test_t08_health_port_falls_back_to_default_on_invalid_env(
    monkeypatch: pytest.MonkeyPatch,
    config: WorkerConfig,
) -> None:
    monkeypatch.setenv("HEALTH_PORT", "invalid")
    consumer = DummyConsumer(config, pbac_client=None)

    assert consumer._read_health_port() == DEFAULT_HEALTH_PORT
