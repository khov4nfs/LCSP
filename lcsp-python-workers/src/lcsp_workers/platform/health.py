from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Mapping

from package.contract.api_client_contracts import (
    correlationId_HEADER,
    WORKER_API_KEY_HEADER,
)
from lcsp_workers.platform.logging import get_logger
from lcsp_workers.platform.orchestration_logging import (
    ORCHESTRATION_LOG_EVENTS,
    orchestration_debug_enabled,
    sanitize_orchestration_payload,
)


HEALTH_ENDPOINT = "/health"
REQUEST_TARGETED_REANALYSIS_ENDPOINT = (
    "/runtime/commands/request-targeted-reanalysis"
)
RESUME_WAITING_RUNS_ENDPOINT = (
    "/runtime/commands/legal-corpus/resume-waiting-runs"
)
RECOVER_LEGAL_CORPUS_ENDPOINT = "/runtime/commands/legal-corpus/recover"
DEFAULT_HEALTH_PORT = 8080
logger = get_logger(__name__)


@dataclass(frozen=True)
class RuntimeCommandResponse:
    status_code: int
    payload: Mapping[str, object]


RuntimeCommandHandler = Callable[[dict[str, object], str | None], RuntimeCommandResponse]


class _RuntimeHTTPServer(ThreadingHTTPServer):
    def __init__(
        self,
        server_address: tuple[str, int],
        handler,
        *,
        worker_name: str,
        rabbitmq_connected_provider: Callable[[], bool],
        api_key: str | None,
        command_handlers: Mapping[str, RuntimeCommandHandler],
        capabilities: tuple[str, ...],
        version: str,
        build_ref: str,
    ) -> None:
        super().__init__(server_address, handler)
        self.worker_name = worker_name
        self.rabbitmq_connected_provider = rabbitmq_connected_provider
        self.api_key = api_key
        self.command_handlers = dict(command_handlers)
        self.capabilities = capabilities
        self.version = version
        self.build_ref = build_ref


class _RuntimeHandler(BaseHTTPRequestHandler):
    server: _RuntimeHTTPServer

    def do_GET(self) -> None:  # noqa: N802
        if self.path != HEALTH_ENDPOINT:
            self.send_error(404)
            return

        connected = self.server.rabbitmq_connected_provider()
        payload = {
            "status": "ok" if connected else "degraded",
            "rabbitmq": "connected" if connected else "disconnected",
            "worker": self.server.worker_name,
            "runtime_http": "ready",
            "version": self.server.version,
            "build_ref": self.server.build_ref,
            "capabilities": list(self.server.capabilities),
        }
        if orchestration_debug_enabled():
            logger.debug(
                ORCHESTRATION_LOG_EVENTS["healthCheck"],
                worker=self.server.worker_name,
                rabbitmq=payload["rabbitmq"],
                version=self.server.version,
                build_ref=self.server.build_ref,
                capabilities=payload["capabilities"],
            )
        self._write_json(HTTPStatus.OK if connected else HTTPStatus.SERVICE_UNAVAILABLE, payload)

    def do_POST(self) -> None:  # noqa: N802
        handler = self.server.command_handlers.get(self.path)
        if handler is None:
            self.send_error(404)
            return
        if not self._is_authorized():
            self._write_json(
                HTTPStatus.UNAUTHORIZED,
                {"ok": False, "error": "WORKER_API_KEY_INVALID"},
            )
            return

        payload = self._read_json_body()
        if payload is None:
            self._write_json(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                {"ok": False, "error": "INVALID_JSON_OBJECT"},
            )
            return

        correlationId = self.headers.get(correlationId_HEADER)
        if orchestration_debug_enabled():
            logger.info(
                ORCHESTRATION_LOG_EVENTS["commandReceived"],
                worker=self.server.worker_name,
                path=self.path,
                correlationId=correlationId,
                payload=sanitize_orchestration_payload(payload),
            )
        response = handler(payload, correlationId)
        if orchestration_debug_enabled():
            logger.info(
                ORCHESTRATION_LOG_EVENTS["commandCompleted"],
                worker=self.server.worker_name,
                path=self.path,
                correlationId=correlationId,
                status_code=response.status_code,
                payload=sanitize_orchestration_payload(dict(response.payload)),
            )
        self._write_json(response.status_code, dict(response.payload))

    def _read_json_body(self) -> dict[str, object] | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None
        return parsed if isinstance(parsed, dict) else None

    def _is_authorized(self) -> bool:
        expected = self.server.api_key
        if not expected:
            return True
        presented = self.headers.get(WORKER_API_KEY_HEADER)
        return isinstance(presented, str) and presented == expected

    def _write_json(self, status: int, payload: Mapping[str, object]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return


class HealthServer:
    def __init__(
        self,
        *,
        worker_name: str,
        rabbitmq_connected_provider: Callable[[], bool],
        port: int = DEFAULT_HEALTH_PORT,
        api_key: str | None = None,
        command_handlers: Mapping[str, RuntimeCommandHandler] | None = None,
        capabilities: tuple[str, ...] = (),
        version: str = "dev",
        build_ref: str = "local",
    ) -> None:
        self._worker_name = worker_name
        self._rabbitmq_connected_provider = rabbitmq_connected_provider
        self._requested_port = port
        self._api_key = api_key
        self._command_handlers = dict(command_handlers or {})
        self._capabilities = capabilities
        self._version = version
        self._build_ref = build_ref
        self._server: _RuntimeHTTPServer | None = None
        self._thread: threading.Thread | None = None
        self.port = port

    def start(self) -> None:
        if self._server is not None:
            return

        server = _RuntimeHTTPServer(
            ("", self._requested_port),
            _RuntimeHandler,
            worker_name=self._worker_name,
            rabbitmq_connected_provider=self._rabbitmq_connected_provider,
            api_key=self._api_key,
            command_handlers=self._command_handlers,
            capabilities=self._capabilities,
            version=self._version,
            build_ref=self._build_ref,
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        self._server = server
        self._thread = thread
        self.port = int(server.server_address[1])

    def stop(self) -> None:
        if self._server is None:
            return

        self._server.shutdown()
        self._server.server_close()

        if self._thread is not None:
            self._thread.join(timeout=2)

        self._server = None
        self._thread = None
