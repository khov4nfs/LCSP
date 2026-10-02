"""RabbitMQ ingress for Deep Agent invocation boundaries."""

from __future__ import annotations

import json
import logging
import math
import os
import re
import signal
from concurrent.futures import CancelledError, Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from functools import partial
from threading import Event, Lock, Timer
from time import monotonic
from typing import Any, Callable

import httpx
import pika

from middleware.failure_policy import is_terminal_boundary_error
from orchestration.agent_stream import install_agent_stream_log_handler

from tools.common.capabilities.platform.env import load_runtime_env
from tools.common.capabilities.platform.logging import suppress_langgraph_heartbeat_logs
from tools.common.capabilities.agent_runtime.boundary import NonRetryableAgentBoundaryError
from tools.common.capabilities.agent_runtime.invocation import (
    invocation_boundary_manifest,
    load_boundary,
    report_external_boundary_timeout,
)
from tools.common.capabilities.agent_runtime.agent_server_client import (
    DEFAULT_AGENT_SERVER_URL,
    dispatch_agent_runtime_event,
    reconcile_stale_agent_runs,
)
from tools.common.capabilities.platform.api_client import (
    WorkerApiClient,
    WorkerCallbackError,
)
from tools.common.capabilities.platform.config import (
    load_config,
    resolve_usage_recovery_store_path,
)
from middleware.usage_recovery import start_background_worker

LOGGER = logging.getLogger("lcsp.agent_runtime.rabbitmq_consumer")
DEFAULT_EXCHANGE = "lcsp.events"
DEFAULT_QUEUE_PREFIX = "lcsp.agent_runtime.boundary"
DEFAULT_RECONNECT_DELAY_SECONDS = 2.0
DEFAULT_REQUEUE_DELAY_SECONDS = 2.0
DEFAULT_FALLBACK_MAX_REDELIVERIES = 3
AGENT_RUNTIME_ATTEMPT_HEADER = "x-lcsp-agent-runtime-attempt"
DEFAULT_API_READY_TIMEOUT_SECONDS = 60.0
DEFAULT_API_READY_POLL_SECONDS = 0.5
DEFAULT_BOUNDARY_WORKERS = 4
DEFAULT_BROKER_ACK_TIMEOUT_SECONDS = 1800.0
DEFAULT_SETTLEMENT_MARGIN_SECONDS = 120.0
SCAN_FAILURE_AGENT_RUNTIME_BOUNDARY_TIMEOUT = "AGENT_RUNTIME_BOUNDARY_TIMEOUT"
SCAN_FAILURE_PROVIDER_TIMEOUT = "PROVIDER_TIMEOUT"
SCAN_FAILURE_REPOSITORY_SANDBOX_FAILURE = "REPOSITORY_SANDBOX_FAILURE"
SCAN_FAILURE_REPOSITORY_ANALYSIS_FAILED = "REPOSITORY_ANALYSIS_FAILED"
LEGACY_MDA_QUEUE_PREFIX = "lcsp.mda.boundary"
LEGACY_RETRY_DELAY_SECONDS = (2.0, 10.0, 30.0, 60.0, 120.0, 300.0, 600.0)


class BoundaryExecutionTimeout(NonRetryableAgentBoundaryError):
    """Raised when a broker delivery exceeds its configured boundary deadline."""

    def __init__(self, timeout_seconds: float):
        super().__init__(
            f"Agent Runtime boundary exceeded {timeout_seconds:.1f}s deadline"
        )
        self.timeout_seconds = timeout_seconds


class StaleScanDelivery(NonRetryableAgentBoundaryError):
    """A broker delivery references a scan job that no longer exists.

    This is expected after local resets, assessment deletion, or queue backlog replay.
    The delivery must be acknowledged and dropped instead of retried or terminalizing
    a different/current scan.
    """

    def __init__(self, scan_job_id: str):
        self.scan_job_id = scan_job_id
        super().__init__(f"stale scan delivery for missing job {scan_job_id}")


class TerminalScanDelivery(NonRetryableAgentBoundaryError):
    """Redelivery of already-terminal work; acknowledge without failing it again."""

    def __init__(self, scan_job_id: str):
        self.scan_job_id = scan_job_id
        super().__init__(f"scan job {scan_job_id} is already terminal")


@dataclass(frozen=True)
class BoundaryBinding:
    """One RabbitMQ queue binding for one Agent Runtime boundary."""

    boundary_name: str
    source_event: str
    queue_name: str
    retry_delays_seconds: tuple[float, ...] = ()


@dataclass
class DeliverySettlementState:
    """Single-settlement guard for one RabbitMQ delivery."""

    settled: bool = False
    deadline: float | None = None
    timer: Timer | None = None
    lock: Lock = field(default_factory=Lock)


def boundary_bindings(
    queue_prefix: str = DEFAULT_QUEUE_PREFIX,
) -> tuple[BoundaryBinding, ...]:
    """Return queue bindings derived from the Agent Runtime boundary manifest."""
    bindings: list[BoundaryBinding] = []
    seen_queues: set[str] = set()

    for entry in invocation_boundary_manifest():
        boundary_name = _required_manifest_text(entry, "name")
        source_event = _required_manifest_text(entry, "source_event")
        queue_name = f"{queue_prefix}.{boundary_name}"
        if queue_name in seen_queues:
            raise RuntimeError(f"duplicate Agent Runtime queue: {queue_name}")
        seen_queues.add(queue_name)
        bindings.append(
            BoundaryBinding(
                boundary_name=boundary_name,
                source_event=source_event,
                queue_name=queue_name,
                retry_delays_seconds=_optional_retry_delays(entry),
            )
        )

    return tuple(bindings)


def run_consumer() -> None:
    """Run the RabbitMQ event bridge until interrupted."""
    load_runtime_env()
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    install_agent_stream_log_handler()
    suppress_langgraph_heartbeat_logs()

    # Undelivered usage telemetry is retried independently of model traffic.
    usage_client = _worker_client_or_none()
    if usage_client is not None:
        start_background_worker(resolve_usage_recovery_store_path(), usage_client)

    rabbitmq_url = os.getenv("RABBITMQ_URL")
    if not rabbitmq_url:
        raise RuntimeError("Missing required env var: RABBITMQ_URL")

    exchange = os.getenv("RABBITMQ_EXCHANGE", DEFAULT_EXCHANGE)
    queue_prefix = os.getenv("LCSP_AGENT_RUNTIME_RABBITMQ_QUEUE_PREFIX", DEFAULT_QUEUE_PREFIX)
    prefetch_count = int(os.getenv("LCSP_AGENT_RUNTIME_RABBITMQ_PREFETCH", "1"))
    worker_count = _executor_worker_count(prefetch_count)
    requeue_on_error = _read_bool("LCSP_AGENT_RUNTIME_RABBITMQ_REQUEUE_ON_ERROR", True)
    reconnect_delay_seconds = float(
        os.getenv(
            "LCSP_AGENT_RUNTIME_RABBITMQ_RECONNECT_DELAY_SECONDS",
            str(DEFAULT_RECONNECT_DELAY_SECONDS),
        )
    )
    requeue_delay_seconds = float(
        os.getenv(
            "LCSP_AGENT_RUNTIME_RABBITMQ_REQUEUE_DELAY_SECONDS",
            str(DEFAULT_REQUEUE_DELAY_SECONDS),
        )
    )
    fallback_max_redeliveries = int(
        os.getenv(
            "LCSP_AGENT_RUNTIME_RABBITMQ_FALLBACK_MAX_REDELIVERIES",
            str(DEFAULT_FALLBACK_MAX_REDELIVERIES),
        )
    )
    api_base_url = os.getenv("NESTJS_API_BASE_URL")
    api_ready_timeout_seconds = float(
        os.getenv(
            "LCSP_AGENT_RUNTIME_API_READY_TIMEOUT_SECONDS",
            str(DEFAULT_API_READY_TIMEOUT_SECONDS),
        )
    )
    bindings = boundary_bindings(queue_prefix)

    stopping = Event()
    active_connection: pika.BlockingConnection | None = None
    active_channel: Any | None = None

    def stop(_signum: int, _frame: object) -> None:
        if stopping.is_set():
            return
        stopping.set()
        LOGGER.info("Stopping Agent Runtime RabbitMQ consumer")
        if (
            active_connection is not None
            and active_connection.is_open
            and active_channel is not None
            and active_channel.is_open
        ):
            try:
                active_connection.add_callback_threadsafe(
                    active_channel.stop_consuming
                )
            except pika.exceptions.AMQPError:
                LOGGER.debug("RabbitMQ connection closed during shutdown")

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    _wait_for_api_ready(
        api_base_url=api_base_url,
        timeout_seconds=api_ready_timeout_seconds,
        stopping=stopping,
    )
    if stopping.is_set():
        return

    _reconcile_local_agent_server_stale_runs(
        timeout_seconds=api_ready_timeout_seconds,
        stopping=stopping,
    )
    if stopping.is_set():
        return

    with ThreadPoolExecutor(
        max_workers=worker_count,
        thread_name_prefix="lcsp-agent-runtime-boundary",
    ) as executor:
        while not stopping.is_set():
            connection: pika.BlockingConnection | None = None
            channel: Any | None = None
            try:
                connection = pika.BlockingConnection(
                    pika.URLParameters(rabbitmq_url)
                )
                channel = connection.channel()
                active_connection = connection
                active_channel = channel
                _configure_channel(
                    connection=connection,
                    channel=channel,
                    executor=executor,
                    exchange=exchange,
                    bindings=bindings,
                    prefetch_count=prefetch_count,
                    requeue_on_error=requeue_on_error,
                    requeue_delay_seconds=requeue_delay_seconds,
                    fallback_max_redeliveries=fallback_max_redeliveries,
                    cleanup_legacy_mda_topology=_read_bool(
                        "LCSP_AGENT_RUNTIME_CLEANUP_LEGACY_MDA_TOPOLOGY",
                        True,
                    ),
                )
                LOGGER.info("Starting Agent Runtime RabbitMQ consumer")
                channel.start_consuming()
            except (pika.exceptions.AMQPError, OSError):
                if not stopping.is_set():
                    LOGGER.exception(
                        "Agent Runtime RabbitMQ connection lost; reconnecting in %.1fs",
                        reconnect_delay_seconds,
                    )
            finally:
                active_channel = None
                active_connection = None
                try:
                    if channel is not None and channel.is_open:
                        channel.close()
                    if connection is not None and connection.is_open:
                        connection.close()
                except pika.exceptions.AMQPError:
                    LOGGER.debug("RabbitMQ transport already closed")

            if not stopping.is_set():
                stopping.wait(reconnect_delay_seconds)


def _wait_for_api_ready(
    *,
    api_base_url: str | None,
    timeout_seconds: float,
    stopping: Event,
) -> None:
    """Block RabbitMQ consumption until the Nest API can accept callbacks."""
    if not api_base_url:
        return

    health_url = f"{api_base_url.rstrip('/')}/health"
    deadline = monotonic() + max(timeout_seconds, 0)
    last_error: str | None = None

    while not stopping.is_set():
        try:
            response = httpx.get(health_url, timeout=2.0)
            if response.status_code == 200:
                return
            last_error = f"HTTP {response.status_code}"
        except httpx.HTTPError as error:
            last_error = error.__class__.__name__

        if monotonic() >= deadline:
            raise RuntimeError(
                "Nest API was not ready before starting Agent Runtime "
                f"RabbitMQ consumer: {health_url} ({last_error})"
            )

        stopping.wait(DEFAULT_API_READY_POLL_SECONDS)


def _reconcile_local_agent_server_stale_runs(
    *,
    timeout_seconds: float,
    stopping: Event,
) -> None:
    """Clear persisted local-dev runs that predate the current Agent Server process."""
    server_url = os.getenv("LCSP_AGENT_SERVER_URL", DEFAULT_AGENT_SERVER_URL).rstrip("/")
    default_enabled = server_url.startswith(("http://127.0.0.1:", "http://localhost:"))
    if not _read_bool(
        "LCSP_AGENT_RUNTIME_RECONCILE_STALE_RUNS",
        default_enabled,
    ):
        return

    deadline = monotonic() + max(timeout_seconds, 0)
    last_error: str | None = None
    while not stopping.is_set():
        try:
            response = httpx.get(f"{server_url}/ok", timeout=2.0)
            if response.status_code == 200:
                cancelled = reconcile_stale_agent_runs(server_url=server_url)
                if cancelled:
                    LOGGER.warning(
                        "Interrupted %s stale Agent Server run(s) from a previous local process",
                        cancelled,
                    )
                return
            last_error = f"HTTP {response.status_code}"
        except Exception as error:
            last_error = error.__class__.__name__

        if monotonic() >= deadline:
            raise RuntimeError(
                "Agent Server was not ready for stale-run reconciliation before "
                f"starting RabbitMQ consumption: {server_url} ({last_error})"
            )
        stopping.wait(DEFAULT_API_READY_POLL_SECONDS)


def _configure_channel(
    *,
    connection: pika.BlockingConnection,
    channel: Any,
    executor: ThreadPoolExecutor,
    exchange: str,
    bindings: tuple[BoundaryBinding, ...],
    prefetch_count: int,
    requeue_on_error: bool,
    requeue_delay_seconds: float,
    fallback_max_redeliveries: int,
    cleanup_legacy_mda_topology: bool = False,
) -> None:
    channel.exchange_declare(
        exchange=exchange,
        exchange_type="topic",
        durable=True,
    )
    channel.basic_qos(prefetch_count=prefetch_count)
    channel.confirm_delivery()

    if cleanup_legacy_mda_topology:
        _cleanup_legacy_mda_topology(
            channel=channel,
            bindings=bindings,
            requeue_delay_seconds=requeue_delay_seconds,
            fallback_max_redeliveries=fallback_max_redeliveries,
        )

    for binding in bindings:
        retry_delays_seconds = _effective_retry_delays(
            binding.retry_delays_seconds,
            fallback_delay_seconds=requeue_delay_seconds,
            fallback_max_redeliveries=fallback_max_redeliveries,
        )
        channel.queue_declare(queue=binding.queue_name, durable=True)
        for retry_delay_seconds in sorted(set(retry_delays_seconds)):
            channel.queue_declare(
                queue=_retry_queue_name(binding.queue_name, retry_delay_seconds),
                durable=True,
                arguments={
                    "x-message-ttl": _delay_milliseconds(retry_delay_seconds),
                    "x-dead-letter-exchange": "",
                    "x-dead-letter-routing-key": binding.queue_name,
                },
            )
        channel.queue_bind(
            exchange=exchange,
            queue=binding.queue_name,
            routing_key=binding.source_event,
        )
        channel.basic_consume(
            queue=binding.queue_name,
            on_message_callback=_delivery_handler(
                binding.boundary_name,
                connection=connection,
                executor=executor,
                queue_name=binding.queue_name,
                requeue_on_error=requeue_on_error,
                retry_delays_seconds=retry_delays_seconds,
                timeout_seconds=_boundary_timeout_seconds(binding.boundary_name),
            ),
        )
        LOGGER.info(
            "Bound Agent Runtime boundary queue=%s routing_key=%s boundary=%s retry_delays=%s",
            binding.queue_name,
            binding.source_event,
            binding.boundary_name,
            retry_delays_seconds,
        )


def _delivery_handler(
    boundary_name: str,
    *,
    connection: pika.BlockingConnection,
    executor: ThreadPoolExecutor,
    queue_name: str | None = None,
    requeue_on_error: bool,
    retry_delays_seconds: tuple[float, ...] = (),
    timeout_seconds: float | None = None,
) -> Callable[[Any, Any, Any, bytes], None]:
    def handle_delivery(
        channel: Any,
        method: Any,
        properties: Any,
        body: bytes,
    ) -> None:
        settlement_state = DeliverySettlementState(
            deadline=monotonic() + timeout_seconds if timeout_seconds else None
        )
        future = executor.submit(
            _dispatch_delivery,
            boundary_name,
            properties,
            body,
            timeout_seconds,
            settlement_state,
        )
        if timeout_seconds is not None and timeout_seconds > 0:
            timer = Timer(
                timeout_seconds,
                lambda: _schedule_delivery_timeout_settlement(
                    state=settlement_state,
                    future=future,
                    connection=connection,
                    channel=channel,
                    delivery_tag=method.delivery_tag,
                    routing_key=getattr(method, "routing_key", ""),
                    queue_name=queue_name or boundary_name,
                    boundary_name=boundary_name,
                    properties=properties,
                    body=body,
                    requeue_on_error=requeue_on_error,
                    retry_delays_seconds=retry_delays_seconds,
                    timeout_seconds=timeout_seconds,
                ),
            )
            timer.daemon = True
            settlement_state.timer = timer
            timer.start()
        future.add_done_callback(
            lambda completed: _schedule_delivery_settlement_once(
                state=settlement_state,
                connection=connection,
                channel=channel,
                delivery_tag=method.delivery_tag,
                routing_key=getattr(method, "routing_key", ""),
                queue_name=queue_name or boundary_name,
                boundary_name=boundary_name,
                properties=properties,
                body=body,
                requeue_on_error=requeue_on_error,
                retry_delays_seconds=retry_delays_seconds,
                completed=completed,
            )
        )

    return handle_delivery


def _dispatch_delivery(
    boundary_name: str,
    properties: Any,
    body: bytes,
    timeout_seconds: float | None = None,
    settlement_state: DeliverySettlementState | None = None,
) -> None:
    if settlement_state is not None and _delivery_already_settled(settlement_state):
        raise BoundaryExecutionTimeout(timeout_seconds or 0.0)
    message = _decode_message(body)
    correlation_id = _correlation_id(
        message,
        getattr(properties, "headers", None),
        boundary_name,
    )
    _claim_scan_delivery(boundary_name, message, timeout_seconds)
    if settlement_state is not None and settlement_state.deadline is not None:
        timeout_seconds = settlement_state.deadline - monotonic()
        if timeout_seconds <= 0 or _delivery_already_settled(settlement_state):
            raise BoundaryExecutionTimeout(0.0)
    dispatch_agent_runtime_event(
        boundary_name,
        message,
        correlation_id,
        timeout_seconds=timeout_seconds,
    )


def _claim_scan_delivery(
    boundary_name: str,
    message: dict[str, Any],
    timeout_seconds: float | None,
) -> None:
    if boundary_name != "scan_requested":
        return
    scan_job_id = _message_text(message, "scanJobId", "scan_job_id")
    if not scan_job_id:
        return
    client = _worker_client_or_none()
    if client is None:
        return
    try:
        response = client.claim_scan_job(
            scan_job_id,
            {
                "boundary_name": boundary_name,
                "timeout_seconds": timeout_seconds,
            },
        )
    except WorkerCallbackError as error:
        if (
            error.status_code == 404
            and error.error_code == "SCAN_JOB_NOT_FOUND"
        ):
            raise StaleScanDelivery(scan_job_id) from error
        raise
    if response.get("terminal") is True and response.get("claimed") is not True:
        raise TerminalScanDelivery(scan_job_id)


def _notify_scan_delivery_terminal_failure(
    *,
    boundary_name: str,
    properties: Any | None,
    body: bytes,
    reason_code: str,
    summary: str,
    timeout_seconds: float | None = None,
) -> None:
    if (
        boundary_name != "scan_requested"
        and reason_code != SCAN_FAILURE_AGENT_RUNTIME_BOUNDARY_TIMEOUT
    ):
        return
    try:
        message = _decode_message(body)
    except Exception:
        return
    if boundary_name != "scan_requested":
        try:
            report_external_boundary_timeout(
                boundary_name,
                message,
                _correlation_id(
                    message, getattr(properties, "headers", None), boundary_name
                ),
                reason_code,
            )
        except Exception:
            LOGGER.warning(
                "Agent Runtime deadline stream report failed boundary=%s", boundary_name
            )
        return
    scan_job_id = _message_text(message, "scanJobId", "scan_job_id")
    if not scan_job_id:
        return
    client = _worker_client_or_none()
    if client is None:
        return
    client.post_scan_terminal_failure(
        scan_job_id,
        {
            "boundary_name": boundary_name,
            "reason_code": reason_code,
            "status": "FAILED",
            "summary": summary,
            "timeout_seconds": timeout_seconds,
            "correlation_id": _correlation_id(
                message,
                getattr(properties, "headers", None),
                boundary_name,
            ),
        },
    )


def _worker_client_or_none() -> WorkerApiClient | None:
    try:
        config = load_config()
    except Exception:
        return None
    return WorkerApiClient(config.nestjs_api_base_url, config.worker_api_key)


def _message_text(message: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = message.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _scan_failure_reason_code(error: BaseException) -> str:
    if isinstance(error, BoundaryExecutionTimeout):
        return SCAN_FAILURE_AGENT_RUNTIME_BOUNDARY_TIMEOUT
    error_names = {type(error).__name__}
    remote_error_type = getattr(error, "remote_error_type", None)
    if isinstance(remote_error_type, str) and remote_error_type:
        error_names.add(remote_error_type)
    if error_names & {"AgentRuntimeBoundaryTimeout", "AgentServerRunTimeout"}:
        return SCAN_FAILURE_AGENT_RUNTIME_BOUNDARY_TIMEOUT
    cause = getattr(error, "__cause__", None)
    if cause is not None:
        error_names.add(type(cause).__name__)
    joined = " ".join((*error_names, str(error))).upper()
    if "TIMEOUT" in joined:
        return SCAN_FAILURE_PROVIDER_TIMEOUT
    if "SANDBOX" in joined or "HYDRATION" in joined:
        return SCAN_FAILURE_REPOSITORY_SANDBOX_FAILURE
    return SCAN_FAILURE_REPOSITORY_ANALYSIS_FAILED


def _schedule_delivery_settlement(
    *,
    connection: pika.BlockingConnection,
    channel: Any,
    delivery_tag: Any,
    routing_key: str,
    queue_name: str,
    boundary_name: str,
    properties: Any,
    body: bytes,
    requeue_on_error: bool,
    retry_delays_seconds: tuple[float, ...],
    completed: Future[None],
) -> None:
    try:
        connection.add_callback_threadsafe(
            partial(
                _settle_delivery,
                channel=channel,
                delivery_tag=delivery_tag,
                routing_key=routing_key,
                queue_name=queue_name,
                boundary_name=boundary_name,
                properties=properties,
                body=body,
                requeue_on_error=requeue_on_error,
                retry_delays_seconds=retry_delays_seconds,
                completed=completed,
            )
        )
    except pika.exceptions.AMQPError:
        LOGGER.warning(
            "RabbitMQ connection closed before delivery settlement "
            "boundary=%s routing_key=%s",
            boundary_name,
            routing_key,
        )


def _schedule_delivery_settlement_once(
    *,
    state: DeliverySettlementState,
    connection: pika.BlockingConnection,
    channel: Any,
    delivery_tag: Any,
    routing_key: str,
    queue_name: str,
    boundary_name: str,
    properties: Any,
    body: bytes,
    requeue_on_error: bool,
    retry_delays_seconds: tuple[float, ...],
    completed: Future[None],
) -> None:
    with state.lock:
        if state.settled:
            return
        state.settled = True
        if state.timer is not None:
            state.timer.cancel()
            state.timer = None
    _schedule_delivery_settlement(
        connection=connection,
        channel=channel,
        delivery_tag=delivery_tag,
        routing_key=routing_key,
        queue_name=queue_name,
        boundary_name=boundary_name,
        properties=properties,
        body=body,
        requeue_on_error=requeue_on_error,
        retry_delays_seconds=retry_delays_seconds,
        completed=completed,
    )


def _schedule_delivery_timeout_settlement(
    *,
    state: DeliverySettlementState,
    future: Future[None] | None = None,
    connection: pika.BlockingConnection,
    channel: Any,
    delivery_tag: Any,
    routing_key: str,
    queue_name: str,
    boundary_name: str,
    properties: Any,
    body: bytes,
    requeue_on_error: bool,
    retry_delays_seconds: tuple[float, ...],
    timeout_seconds: float,
) -> None:
    with state.lock:
        if state.settled:
            return
        state.settled = True
        state.timer = None
    if future is not None:
        future.cancel()
    error = BoundaryExecutionTimeout(timeout_seconds)
    completed: Future[None] = Future()
    completed.set_exception(error)
    _schedule_delivery_settlement(
        connection=connection,
        channel=channel,
        delivery_tag=delivery_tag,
        routing_key=routing_key,
        queue_name=queue_name,
        boundary_name=boundary_name,
        properties=properties,
        body=body,
        requeue_on_error=requeue_on_error,
        retry_delays_seconds=retry_delays_seconds,
        completed=completed,
    )


def _delivery_already_settled(state: DeliverySettlementState) -> bool:
    with state.lock:
        return state.settled


def _settle_delivery(
    *,
    channel: Any,
    delivery_tag: Any,
    routing_key: str,
    queue_name: str = "",
    boundary_name: str = "",
    properties: Any | None = None,
    body: bytes = b"",
    requeue_on_error: bool = True,
    retry_delays_seconds: tuple[float, ...] = (),
    completed: Future[None] | None = None,
) -> None:
    if not channel.is_open:
        LOGGER.warning(
            "RabbitMQ channel closed before delivery settlement "
            "boundary=%s routing_key=%s",
            boundary_name,
            routing_key,
        )
        return

    error = _delivery_error(completed) if completed is not None else None

    try:
        if error is None:
            channel.basic_ack(delivery_tag=delivery_tag)
            return

        if isinstance(error, (StaleScanDelivery, TerminalScanDelivery)):
            LOGGER.info(
                "Dropped stale Agent Runtime scan delivery boundary=%s routing_key=%s "
                "scan_job_id=%s correlation_id=%s reason=%s",
                boundary_name,
                routing_key,
                error.scan_job_id,
                _property_value(properties, "correlation_id"),
                type(error).__name__,
            )
            channel.basic_ack(delivery_tag=delivery_tag)
            return

        LOGGER.error(
            "Agent Runtime boundary dispatch failed boundary=%s routing_key=%s",
            boundary_name,
            routing_key,
            exc_info=(type(error), error, error.__traceback__),
        )
        retryable = (
            requeue_on_error
            and not isinstance(error, NonRetryableAgentBoundaryError)
            and not is_terminal_boundary_error(error)
        )
        current_attempt = _delivery_attempt(properties)
        max_attempts = len(retry_delays_seconds)
        if retryable and current_attempt < max_attempts:
            next_attempt = current_attempt + 1
            retry_delay_seconds = retry_delays_seconds[current_attempt]
            retry_queue = _retry_queue_name(queue_name, retry_delay_seconds)
            LOGGER.warning(
                "Agent Runtime boundary retry scheduled boundary=%s routing_key=%s "
                "correlation_id=%s attempt=%s max_attempts=%s delay_seconds=%s "
                "exception_type=%s",
                boundary_name,
                routing_key,
                _property_value(properties, "correlation_id"),
                next_attempt,
                max_attempts,
                retry_delay_seconds,
                type(error).__name__,
            )
            if _publish_retry_delivery(
                channel=channel,
                retry_queue=retry_queue,
                properties=properties,
                body=body,
                attempt=next_attempt,
            ):
                channel.basic_ack(delivery_tag=delivery_tag)
            else:
                channel.basic_nack(delivery_tag=delivery_tag, requeue=True)
            return

        if retryable:
            LOGGER.error(
                "Agent Runtime boundary retry exhausted boundary=%s routing_key=%s "
                "correlation_id=%s attempt=%s max_attempts=%s exception_type=%s",
                boundary_name,
                routing_key,
                _property_value(properties, "correlation_id"),
                current_attempt,
                max_attempts,
                type(error).__name__,
            )

        timeout_seconds = (
            error.timeout_seconds
            if isinstance(error, BoundaryExecutionTimeout)
            else None
        )
        _notify_scan_delivery_terminal_failure(
            boundary_name=boundary_name,
            properties=properties,
            body=body,
            reason_code=_scan_failure_reason_code(error),
            summary=(
                "Agent Runtime boundary timed out"
                if isinstance(error, BoundaryExecutionTimeout)
                else "Agent Runtime boundary failed"
            ),
            timeout_seconds=timeout_seconds,
        )
        channel.basic_nack(delivery_tag=delivery_tag, requeue=False)
    except pika.exceptions.AMQPError:
        LOGGER.warning(
            "RabbitMQ channel closed while settling delivery "
            "boundary=%s routing_key=%s",
            boundary_name,
            routing_key,
        )


def _delivery_error(completed: Future[None]) -> BaseException | None:
    try:
        return completed.exception()
    except CancelledError:
        return CancelledError()


def _decode_message(body: bytes) -> dict[str, Any]:
    value = json.loads(body.decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("RabbitMQ Agent Runtime message must be a JSON object")
    return value


def _correlation_id(
    message: dict[str, Any],
    headers: dict[str, Any] | None,
    boundary_name: str,
) -> str:
    payload_value = message.get("correlationId") or message.get("correlation_id")
    if isinstance(payload_value, str) and payload_value:
        return payload_value
    header_value = (headers or {}).get("x-correlation-id")
    if isinstance(header_value, str) and header_value:
        return header_value
    return f"agent-runtime:{boundary_name}"



def _optional_retry_delays(entry: dict[str, Any]) -> tuple[float, ...]:
    raw = entry.get("retry_delays_seconds")
    if raw is None:
        target = entry.get("target")
        if isinstance(target, str) and target:
            return tuple(float(value) for value in load_boundary(target).retry_delays_seconds)
        return ()
    if not isinstance(raw, (list, tuple)):
        raise RuntimeError("Agent Runtime boundary manifest retry_delays_seconds must be a list")
    delays: list[float] = []
    for value in raw:
        delay = float(value)
        if delay < 0:
            raise RuntimeError("Agent Runtime boundary retry delay cannot be negative")
        delays.append(delay)
    return tuple(delays)


def _effective_retry_delays(
    retry_delays_seconds: tuple[float, ...],
    *,
    fallback_delay_seconds: float,
    fallback_max_redeliveries: int,
) -> tuple[float, ...]:
    if retry_delays_seconds:
        return retry_delays_seconds
    return tuple(max(fallback_delay_seconds, 0.0) for _ in range(max(fallback_max_redeliveries, 0)))


def _boundary_timeout_seconds(boundary_name: str) -> float | None:
    """Return the opt-in deadline for one boundary, or None for no deadline.

    Agent work is not time-bounded: how long a run takes depends on model
    reasoning, tool use and repository size, so no boundary has a default
    deadline and the broker's consumer timeout is disabled instead (see
    fogewise-dev-launchers). An operator can still opt in per boundary.
    """
    env_names = [
        "LCSP_AGENT_RUNTIME_BOUNDARY_TIMEOUT_"
        f"{_env_boundary_name(boundary_name)}_SECONDS",
    ]
    if boundary_name == "scan_requested":
        env_names.append("LCSP_AGENT_RUNTIME_SCAN_BOUNDARY_TIMEOUT_SECONDS")
    env_names.append("LCSP_AGENT_RUNTIME_BOUNDARY_TIMEOUT_SECONDS")
    env_name = next((name for name in env_names if os.getenv(name) is not None), None)
    if env_name is None:
        return None
    requested = _positive_float_env(env_name)
    ack_timeout = _positive_float_env(
        "LCSP_AGENT_RUNTIME_BROKER_ACK_TIMEOUT_SECONDS",
        DEFAULT_BROKER_ACK_TIMEOUT_SECONDS,
    )
    margin = _positive_float_env(
        "LCSP_AGENT_RUNTIME_SETTLEMENT_MARGIN_SECONDS",
        DEFAULT_SETTLEMENT_MARGIN_SECONDS,
    )
    if margin >= ack_timeout:
        raise RuntimeError("Settlement margin must be smaller than broker ACK timeout")
    effective = min(requested, ack_timeout - margin)
    if effective < requested:
        LOGGER.warning(
            "Boundary deadline capped before broker ACK timeout "
            "boundary=%s requested=%s effective=%s",
            boundary_name, requested, effective,
        )
    return effective


def _env_boundary_name(boundary_name: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", boundary_name).strip("_").upper()


def _positive_float_env(name: str, default: float | None = None) -> float:
    raw = os.getenv(name)
    if raw is None:
        if default is None:
            raise RuntimeError(f"Missing required env var: {name}")
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise RuntimeError(f"Invalid numeric env var: {name}") from exc
    if not math.isfinite(value) or value <= 0:
        raise RuntimeError(f"{name} must be finite and > 0")
    return value


def _executor_worker_count(prefetch_count: int) -> int:
    raw = os.getenv("LCSP_AGENT_RUNTIME_BOUNDARY_WORKERS")
    if raw is None:
        return max(prefetch_count, DEFAULT_BOUNDARY_WORKERS)
    try:
        configured = int(raw)
    except ValueError as exc:
        raise RuntimeError("LCSP_AGENT_RUNTIME_BOUNDARY_WORKERS must be an integer") from exc
    if configured <= 0:
        raise RuntimeError("LCSP_AGENT_RUNTIME_BOUNDARY_WORKERS must be > 0")
    return max(prefetch_count, configured)


def _cleanup_legacy_mda_topology(
    *,
    channel: Any,
    bindings: tuple[BoundaryBinding, ...],
    requeue_delay_seconds: float,
    fallback_max_redeliveries: int,
) -> None:
    for binding in bindings:
        legacy_queue = f"{LEGACY_MDA_QUEUE_PREFIX}.{binding.boundary_name}"
        legacy_retry_delays = set(LEGACY_RETRY_DELAY_SECONDS)
        legacy_retry_delays.update(
            _effective_retry_delays(
                binding.retry_delays_seconds,
                fallback_delay_seconds=requeue_delay_seconds,
                fallback_max_redeliveries=fallback_max_redeliveries,
            )
        )
        _delete_queue_if_present(channel, legacy_queue)
        for delay_seconds in sorted(legacy_retry_delays):
            _delete_queue_if_present(
                channel,
                _retry_queue_name(legacy_queue, delay_seconds),
            )


def _delete_queue_if_present(channel: Any, queue_name: str) -> None:
    if not queue_name.startswith(f"{LEGACY_MDA_QUEUE_PREFIX}."):
        raise RuntimeError(f"Refusing to delete non-legacy queue: {queue_name}")
    queue_delete = getattr(channel, "queue_delete", None)
    if not callable(queue_delete):
        return
    try:
        queue_delete(queue=queue_name, if_unused=False, if_empty=False)
        LOGGER.info("Deleted legacy MDA RabbitMQ queue queue=%s", queue_name)
    except pika.exceptions.AMQPError:
        LOGGER.warning("Legacy MDA RabbitMQ queue cleanup skipped queue=%s", queue_name)


def _delay_milliseconds(delay_seconds: float) -> int:
    return max(int(delay_seconds * 1000), 1)


def _retry_queue_name(queue_name: str, delay_seconds: float) -> str:
    return f"{queue_name}.retry.{_delay_milliseconds(delay_seconds)}ms"


def _delivery_attempt(properties: Any | None) -> int:
    headers = getattr(properties, "headers", None) or {}
    try:
        return max(int(headers.get(AGENT_RUNTIME_ATTEMPT_HEADER, 0)), 0)
    except (TypeError, ValueError):
        return 0


def _property_value(properties: Any | None, name: str) -> Any:
    return getattr(properties, name, None) if properties is not None else None


def _retry_properties(properties: Any | None, attempt: int) -> pika.BasicProperties:
    headers = dict(getattr(properties, "headers", None) or {})
    headers[AGENT_RUNTIME_ATTEMPT_HEADER] = attempt
    preserved_names = (
        "content_type",
        "content_encoding",
        "priority",
        "correlation_id",
        "reply_to",
        "message_id",
        "timestamp",
        "type",
        "app_id",
    )
    kwargs = {"headers": headers, "delivery_mode": 2}
    for name in preserved_names:
        value = _property_value(properties, name)
        if value is not None:
            kwargs[name] = value
    return pika.BasicProperties(**kwargs)


def _publish_retry_delivery(
    *,
    channel: Any,
    retry_queue: str,
    properties: Any | None,
    body: bytes,
    attempt: int,
) -> bool:
    try:
        result = channel.basic_publish(
            exchange="",
            routing_key=retry_queue,
            body=body,
            properties=_retry_properties(properties, attempt),
            mandatory=True,
        )
    except pika.exceptions.AMQPError:
        LOGGER.exception(
            "Agent Runtime boundary retry publish failed retry_queue=%s attempt=%s",
            retry_queue,
            attempt,
        )
        return False
    return result is not False


def _required_manifest_text(entry: dict[str, str], key: str) -> str:
    value = entry.get(key)
    if not value:
        raise RuntimeError(f"Agent Runtime boundary manifest entry missing {key}")
    return value


def _read_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise RuntimeError(f"Invalid boolean env var: {name}")


if __name__ == "__main__":
    run_consumer()
