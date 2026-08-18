"""Provide the shared RabbitMQ consumer lifecycle, retry policy, PBAC gate, and runtime command bridge."""

import json
import os
import signal
from http import HTTPStatus
from threading import Event, Lock, Thread, current_thread

import pika

from lcsp_workers.platform.api_client import WorkerApiClient
from lcsp_workers.platform.correlation import extract_from_amqp_headers, set_correlationId, set_user_id, set_assessment_id
from lcsp_workers.platform.health import (
    DEFAULT_HEALTH_PORT,
    RECOVER_LEGAL_CORPUS_ENDPOINT,
    REQUEST_TARGETED_REANALYSIS_ENDPOINT,
    RESUME_WAITING_RUNS_ENDPOINT,
    HealthServer,
    RuntimeCommandResponse,
)
from lcsp_workers.platform.logging import get_logger
from lcsp_workers.platform.orchestration_logging import (
    ORCHESTRATION_LOG_EVENTS,
    orchestration_debug_enabled,
    sanitize_orchestration_payload,
)

logger = get_logger(__name__)

_RETRY_HEADER = "x-lcsp-retry-count"
_THREADSAFE_CHANNEL_OPERATION_TIMEOUT_SECONDS = 30.0


class NonRetryableWorkerError(RuntimeError):
    """Signals a terminal, already-recorded failure that must enter the broker DLQ."""


class _ThreadsafeChannelProxy:
    """Marshal channel mutations back onto the BlockingConnection I/O thread.

    Long-running LLM/scanner handlers execute in a worker thread so the main Pika
    thread can continue servicing AMQP heartbeats. Pika only permits
    ``add_callback_threadsafe`` from another thread, therefore ack/nack/publish are
    synchronously marshalled back to the connection thread through this proxy.
    """

    def __init__(self, connection, channel) -> None:
        self._connection = connection
        self._channel = channel

    @property
    def is_open(self) -> bool:
        return bool(
            getattr(self._connection, "is_open", False)
            and getattr(self._channel, "is_open", False)
        )

    def basic_ack(self, **kwargs):
        return self._invoke(lambda: self._channel.basic_ack(**kwargs))

    def basic_nack(self, **kwargs):
        return self._invoke(lambda: self._channel.basic_nack(**kwargs))

    def basic_publish(self, **kwargs):
        return self._invoke(lambda: self._channel.basic_publish(**kwargs))

    def _invoke(self, operation):
        if not getattr(self._connection, "is_open", False):
            raise pika.exceptions.StreamLostError(
                "RabbitMQ connection closed before broker operation"
            )

        done = Event()
        result: list[object] = []
        failures: list[BaseException] = []

        def invoke_on_connection_thread() -> None:
            try:
                result.append(operation())
            except BaseException as error:  # preserve Pika exception identity
                failures.append(error)
            finally:
                done.set()

        self._connection.add_callback_threadsafe(invoke_on_connection_thread)
        if not done.wait(_THREADSAFE_CHANNEL_OPERATION_TIMEOUT_SECONDS):
            raise TimeoutError("Timed out waiting for RabbitMQ channel operation")
        if failures:
            raise failures[0]
        return result[0] if result else None


class ConsumerBase:
    """Base class for one-at-a-time RabbitMQ workers with fail-closed authorization.

    Subclasses provide queue/routing identifiers and implement ``handle``. The
    base owns process shutdown, health/runtime HTTP, PBAC preflight, ack/nack,
    delayed retries, and runtime bridges used by orchestration commands.
    """

    queue_name: str  # Override in subclass
    routing_key: str  # Override in subclass
    requires_pbac: bool = True  # Override to False for system-only workers
    retry_delays_seconds: tuple[int, ...] = ()

    def __init__(self, config, pbac_client=None):
        """Create a consumer with runtime configuration and optional PBAC client."""
        self._config = config
        self._pbac = pbac_client
        self._shutdown = False
        self._channel = None
        self._health_server: HealthServer | None = None
        self._message_threads: set[Thread] = set()
        self._message_threads_lock = Lock()

    def handle(self, message: dict, correlationId: str) -> None:
        """Process one decoded message; subclasses must implement domain behavior."""
        raise NotImplementedError

    def run(self) -> None:
        """Start health/runtime HTTP, connect RabbitMQ, consume, and shut down cleanly.

        Broker deliveries are processed off the Pika I/O thread. The connection
        thread therefore keeps pumping heartbeats even when one EngineeringRule
        assessment spends many minutes in provider/tool calls. ``prefetch_count=1``
        still guarantees at most one unacknowledged delivery per consumer channel.
        """
        signal.signal(signal.SIGTERM, self._handle_sigterm)
        signal.signal(signal.SIGINT, self._handle_sigterm)
        conn = None
        self._health_server = HealthServer(
            worker_name=self.__class__.__name__,
            rabbitmq_connected_provider=self._is_rabbitmq_connected,
            port=self._read_health_port(),
            api_key=self._config.worker_api_key,
            command_handlers=self._build_runtime_command_handlers(),
            capabilities=(
                "request_targeted_reanalysis",
                "recover_legal_corpus",
                "resume_waiting_runs",
            ),
            version=os.getenv("WORKER_RUNTIME_VERSION", "dev"),
            build_ref=os.getenv("WORKER_RUNTIME_BUILD_REF", "local"),
        )

        try:
            self._health_server.start()

            conn = pika.BlockingConnection(pika.URLParameters(self._config.rabbitmq_url))
            channel = conn.channel()
            self._channel = channel
            channel.exchange_declare(
                exchange=self._config.rabbitmq_exchange,
                exchange_type="topic",
                durable=True,
            )
            channel.queue_declare(queue=self.queue_name, durable=True)
            self._declare_retry_queues(channel)
            channel.queue_bind(
                exchange=self._config.rabbitmq_exchange,
                queue=self.queue_name,
                routing_key=self.routing_key,
            )
            channel.basic_qos(prefetch_count=1)
            channel.basic_consume(
                self.queue_name,
                lambda ch, method, properties, body: self._start_message_thread(
                    conn,
                    ch,
                    method,
                    properties,
                    body,
                ),
            )

            while not self._shutdown or self._has_active_message_threads():
                try:
                    conn.process_data_events(time_limit=1)
                except KeyboardInterrupt:
                    self._handle_sigterm(signal.SIGINT, None)
        finally:
            self._join_message_threads()
            self._channel = None
            if conn is not None:
                try:
                    if getattr(conn, "is_open", True):
                        conn.close()
                except KeyboardInterrupt:
                    logger.info(
                        "SHUTDOWN_INTERRUPTED",
                        msg="RabbitMQ close interrupted",
                    )
            if self._health_server is not None:
                self._health_server.stop()
                self._health_server = None

    def _start_message_thread(self, conn, ch, method, properties, body) -> None:
        """Start one delivery handler while leaving the Pika I/O loop responsive."""
        proxy = _ThreadsafeChannelProxy(conn, ch)
        thread = Thread(
            target=self._run_message_thread,
            args=(proxy, method, properties, body),
            name=f"{self.__class__.__name__}-delivery-{getattr(method, 'delivery_tag', 'unknown')}",
            daemon=False,
        )
        with self._message_threads_lock:
            self._message_threads.add(thread)
        thread.start()

    def _run_message_thread(self, ch, method, properties, body) -> None:
        """Process one delivery and unregister the worker thread afterwards."""
        try:
            self._on_message(ch, method, properties, body)
        finally:
            with self._message_threads_lock:
                self._message_threads.discard(current_thread())

    def _has_active_message_threads(self) -> bool:
        with self._message_threads_lock:
            return any(thread.is_alive() for thread in self._message_threads)

    def _join_message_threads(self) -> None:
        """Wait briefly for already-finishing handlers before closing the broker."""
        with self._message_threads_lock:
            threads = list(self._message_threads)
        for thread in threads:
            if thread is current_thread():
                continue
            thread.join(timeout=_THREADSAFE_CHANNEL_OPERATION_TIMEOUT_SECONDS)

    def _on_message(self, ch, method, properties, body) -> None:
        """Apply correlation/PBAC gates, decode a message, and choose ack/retry/DLQ."""
        headers = properties.headers or {}
        cid = extract_from_amqp_headers(headers)
        set_correlationId(cid)
        attempts = self._get_attempt_count(headers)

        user_id = headers.get("user_id") or ""
        assessment_id = headers.get("assessment_id") or headers.get("assessmentId") or ""
        try:
            message_body = json.loads(body)
            if isinstance(message_body, dict):
                if not user_id:
                    user_id = message_body.get("user_id") or message_body.get("userId") or ""
                    if not user_id and isinstance(message_body.get("actor"), dict):
                        user_id = message_body["actor"].get("id") or ""
                if not assessment_id:
                    assessment_id = message_body.get("assessment_id") or message_body.get("assessmentId") or ""
        except Exception:
            pass

        set_user_id(str(user_id) if user_id else "unknown_user")
        set_assessment_id(str(assessment_id) if assessment_id else "unknown_assessment")

        if self.requires_pbac:
            try:
                decision = self._pbac.check(
                    user_id=headers.get("user_id", ""),
                    organization_id=headers.get("organization_id", ""),
                    action=headers.get("action", ""),
                    correlationId=cid,
                )
            except ConnectionError:
                logger.warning(
                    "PBAC_PREFLIGHT_UNREACHABLE",
                    reason="preflight_retry",
                    attempts=attempts,
                )
                self._retry_or_dead_letter(
                    ch, method, properties, body, attempts=attempts
                )
                return

            if decision == "deny":
                logger.warning("WORKER_TASK_DENIED", decision=decision)
                if ch.is_open:
                    try:
                        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
                    except Exception:
                        pass
                return

        try:
            message = json.loads(body)
            if not isinstance(message, dict):
                raise ValueError("worker message must be a JSON object")
            message.setdefault("_delivery_attempt", attempts)
            self.handle(message, cid)
            if ch.is_open:
                try:
                    ch.basic_ack(delivery_tag=method.delivery_tag)
                except Exception:
                    pass
        except NonRetryableWorkerError as exc:
            logger.error("HANDLER_TERMINAL_ERROR", error=str(exc), attempts=attempts)
            if ch.is_open:
                try:
                    ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
                except Exception:
                    pass
        except Exception as exc:
            logger.error("HANDLER_ERROR", error=str(exc), attempts=attempts)
            self._retry_or_dead_letter(
                ch, method, properties, body, attempts=attempts
            )

    def _retry_or_dead_letter(
        self,
        ch,
        method,
        properties,
        body,
        *,
        attempts: int,
    ) -> None:
        """Republish a failed delivery with retry metadata or dead-letter at the cap."""
        if attempts >= self._config.max_retries:
            logger.error(
                "HANDLER_RETRY_EXHAUSTED",
                attempts=attempts,
                max_retries=self._config.max_retries,
            )
            if ch.is_open:
                try:
                    ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
                except Exception:
                    pass
            return

        retry_headers = dict(properties.headers or {})
        retry_headers[_RETRY_HEADER] = attempts + 1
        retry_properties = pika.BasicProperties(
            content_type=self._string_property(properties, "content_type"),
            content_encoding=self._string_property(properties, "content_encoding"),
            headers=retry_headers,
            delivery_mode=2,
            correlation_id=self._string_property(properties, "correlationId"),
            message_id=self._string_property(properties, "message_id"),
            type=self._string_property(properties, "type"),
        )

        try:
            ch.basic_publish(
                exchange="",
                routing_key=self._retry_queue_name(attempts),
                body=body,
                properties=retry_properties,
            )
            if ch.is_open:
                try:
                    ch.basic_ack(delivery_tag=method.delivery_tag)
                except Exception:
                    pass
            logger.warning(
                "HANDLER_RETRY_SCHEDULED",
                attempt=attempts + 1,
                max_retries=self._config.max_retries,
            )
        except Exception as exc:
            logger.error(
                "HANDLER_RETRY_PUBLISH_FAILED",
                error=type(exc).__name__,
            )
            if ch.is_open:
                try:
                    ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)
                except Exception:
                    pass

    def _declare_retry_queues(self, channel) -> None:
        """Declare optional TTL queues that dead-letter deliveries back to the main queue."""
        for delay_seconds in self.retry_delays_seconds:
            channel.queue_declare(
                queue=f"{self.queue_name}.retry.{delay_seconds}s",
                durable=True,
                arguments={
                    "x-message-ttl": delay_seconds * 1000,
                    "x-dead-letter-exchange": "",
                    "x-dead-letter-routing-key": self.queue_name,
                },
            )

    def _retry_queue_name(self, attempts: int) -> str:
        """Select the configured delayed retry queue or fall back to the main queue."""
        if attempts < len(self.retry_delays_seconds):
            return f"{self.queue_name}.retry.{self.retry_delays_seconds[attempts]}s"
        return self.queue_name

    def _handle_sigterm(self, signum, frame) -> None:
        """Request graceful shutdown after the current broker event completes."""
        logger.info("SIGTERM_RECEIVED", msg="Finishing current message then stopping")
        self._shutdown = True

    def _get_attempt_count(self, headers: dict) -> int:
        """Normalize retry attempts from LCSP or RabbitMQ dead-letter headers."""
        explicit = headers.get(_RETRY_HEADER)
        if explicit is not None:
            try:
                return max(0, int(explicit))
            except (TypeError, ValueError):
                return 0
        x_death = headers.get("x-death", [])
        if x_death:
            try:
                return max(0, int(x_death[0].get("count", 1)))
            except (TypeError, ValueError, IndexError, AttributeError):
                return 0
        return 0

    @staticmethod
    def _string_property(properties, name: str) -> str | None:
        """Return a pika message property only when it is a string."""
        value = getattr(properties, name, None)
        return value if isinstance(value, str) else None

    def _is_rabbitmq_connected(self) -> bool:
        """Report channel connectivity to the runtime health endpoint."""
        channel = self._channel
        if channel is None:
            return False
        return bool(getattr(channel, "is_open", False))

    def _read_health_port(self) -> int:
        """Parse HEALTH_PORT and fall back when absent, invalid, or out of range."""
        raw = os.getenv("HEALTH_PORT")
        if raw is None:
            return DEFAULT_HEALTH_PORT

        try:
            port = int(raw)
        except (TypeError, ValueError):
            return DEFAULT_HEALTH_PORT

        if port <= 0 or port > 65535:
            return DEFAULT_HEALTH_PORT

        return port

    def _build_runtime_command_handlers(self):
        """Bind runtime HTTP command paths to trusted internal API bridges."""
        api_client = WorkerApiClient(
            self._config.nestjs_api_base_url,
            self._config.worker_api_key,
        )
        return {
            REQUEST_TARGETED_REANALYSIS_ENDPOINT: (
                lambda payload, correlationId: self._request_targeted_reanalysis_runtime(
                    api_client,
                    payload,
                    correlationId,
                )
            ),
            RESUME_WAITING_RUNS_ENDPOINT: (
                lambda payload, correlationId: self._resume_waiting_runs_runtime(
                    api_client,
                    payload,
                    correlationId,
                )
            ),
            RECOVER_LEGAL_CORPUS_ENDPOINT: (
                lambda payload, correlationId: self._recover_legal_corpus_runtime(
                    api_client,
                    payload,
                    correlationId,
                )
            ),
        }

    def _request_targeted_reanalysis_runtime(
        self,
        api_client: WorkerApiClient,
        payload: dict[str, object],
        correlationId: str | None,
    ) -> RuntimeCommandResponse:
        """Bridge a runtime targeted-reanalysis command to the NestJS lifecycle API."""
        request_payload = dict(payload)
        if correlationId and "correlationId" not in request_payload:
            request_payload["correlationId"] = correlationId
        if orchestration_debug_enabled():
            logger.info(
                ORCHESTRATION_LOG_EVENTS["bridgeTargetedReanalysis"],
                correlationId=correlationId,
                payload=sanitize_orchestration_payload(request_payload),
            )
        response = api_client.create_targeted_reanalysis_request(request_payload)
        if orchestration_debug_enabled():
            logger.info(
                ORCHESTRATION_LOG_EVENTS["bridgeTargetedReanalysisResult"],
                correlationId=correlationId,
                response=sanitize_orchestration_payload(response),
            )
        return RuntimeCommandResponse(
            status_code=HTTPStatus.ACCEPTED,
            payload=response,
        )

    def _recover_legal_corpus_runtime(
        self,
        api_client: WorkerApiClient,
        payload: dict[str, object],
        correlationId: str | None,
    ) -> RuntimeCommandResponse:
        """Validate idempotency then invoke the legal-corpus recovery driver."""
        idempotency_key = payload.get("idempotencyKey")
        if not isinstance(idempotency_key, str) or not idempotency_key.strip():
            return RuntimeCommandResponse(
                status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
                payload={"ok": False, "error": "IDEMPOTENCY_KEY_REQUIRED"},
            )
        request_payload = dict(payload)
        if correlationId and "correlationId" not in request_payload:
            request_payload["correlationId"] = correlationId
        if orchestration_debug_enabled():
            logger.info(
                "LEGAL_CORPUS_RECOVERY_RUNTIME_REQUESTED",
                correlationId=correlationId,
                payload=sanitize_orchestration_payload(request_payload),
            )
        from lcsp_workers.legal.legal_corpus_recovery_driver import (
            LegalCorpusRecoveryDriver,
        )

        response = LegalCorpusRecoveryDriver(api_client=api_client).run(
            request_payload,
            correlationId or str(request_payload.get("correlationId") or ""),
        )
        return RuntimeCommandResponse(
            status_code=HTTPStatus.ACCEPTED,
            payload=response,
        )

    def _resume_waiting_runs_runtime(
        self,
        api_client: WorkerApiClient,
        payload: dict[str, object],
        correlationId: str | None,
    ) -> RuntimeCommandResponse:
        """Validate corpus version and bridge resume-waiting-runs to the API."""
        corpus_version_id = payload.get("corpusVersionId")
        if not isinstance(corpus_version_id, str) or not corpus_version_id.strip():
            return RuntimeCommandResponse(
                status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
                payload={"ok": False, "error": "CORPUS_VERSION_ID_REQUIRED"},
            )
        request_payload = dict(payload)
        request_payload.pop("corpusVersionId", None)
        if correlationId and "correlationId" not in request_payload:
            request_payload["correlationId"] = correlationId
        if orchestration_debug_enabled():
            logger.info(
                ORCHESTRATION_LOG_EVENTS["bridgeResumeWaitingRuns"],
                correlationId=correlationId,
                corpus_version_id=corpus_version_id.strip(),
                payload=sanitize_orchestration_payload(request_payload),
            )
        response = api_client.resume_waiting_runs(
            corpus_version_id.strip(),
            request_payload,
        )
        if orchestration_debug_enabled():
            logger.info(
                ORCHESTRATION_LOG_EVENTS["bridgeResumeWaitingRunsResult"],
                correlationId=correlationId,
                corpus_version_id=corpus_version_id.strip(),
                response=sanitize_orchestration_payload(response),
            )
        return RuntimeCommandResponse(
            status_code=HTTPStatus.ACCEPTED,
            payload=response,
        )
