"""RabbitMQ ingress for Managed Deep Agent invocation boundaries."""

from __future__ import annotations

import json
import logging
import os
import signal
from concurrent.futures import CancelledError, Future, ThreadPoolExecutor
from dataclasses import dataclass
from functools import partial
from threading import Event
from time import monotonic
from typing import Any, Callable

import httpx
import pika

from middleware.failure_policy import is_terminal_task_error
from orchestration.agent_stream import install_agent_stream_log_handler

from tools.common.capabilities.platform.env import load_runtime_env
from tools.common.capabilities.platform.logging import suppress_langgraph_heartbeat_logs
from tools.common.capabilities.managed.boundary import NonRetryableAgentBoundaryError
from tools.common.capabilities.managed.invocation import (
    invocation_boundary_manifest,
    invoke_boundary,
    load_boundary,
)

LOGGER = logging.getLogger("lcsp.mda.rabbitmq_consumer")
DEFAULT_EXCHANGE = "lcsp.events"
DEFAULT_QUEUE_PREFIX = "lcsp.mda.boundary"
DEFAULT_RECONNECT_DELAY_SECONDS = 2.0
DEFAULT_REQUEUE_DELAY_SECONDS = 2.0
DEFAULT_FALLBACK_MAX_REDELIVERIES = 3
MANAGED_ATTEMPT_HEADER = "x-lcsp-managed-attempt"
DEFAULT_API_READY_TIMEOUT_SECONDS = 60.0
DEFAULT_API_READY_POLL_SECONDS = 0.5


@dataclass(frozen=True)
class BoundaryBinding:
    """One RabbitMQ queue binding for one Managed Agent boundary."""

    boundary_name: str
    source_event: str
    queue_name: str
    retry_delays_seconds: tuple[float, ...] = ()


def boundary_bindings(
    queue_prefix: str = DEFAULT_QUEUE_PREFIX,
) -> tuple[BoundaryBinding, ...]:
    """Return queue bindings derived from the Managed Agent boundary manifest."""
    bindings: list[BoundaryBinding] = []
    seen_queues: set[str] = set()

    for entry in invocation_boundary_manifest():
        boundary_name = _required_manifest_text(entry, "name")
        source_event = _required_manifest_text(entry, "source_event")
        queue_name = f"{queue_prefix}.{boundary_name}"
        if queue_name in seen_queues:
            raise RuntimeError(f"duplicate Managed Agent queue: {queue_name}")
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

    rabbitmq_url = os.getenv("RABBITMQ_URL")
    if not rabbitmq_url:
        raise RuntimeError("Missing required env var: RABBITMQ_URL")

    exchange = os.getenv("RABBITMQ_EXCHANGE", DEFAULT_EXCHANGE)
    queue_prefix = os.getenv("LCSP_MDA_RABBITMQ_QUEUE_PREFIX", DEFAULT_QUEUE_PREFIX)
    prefetch_count = int(os.getenv("LCSP_MDA_RABBITMQ_PREFETCH", "1"))
    requeue_on_error = _read_bool("LCSP_MDA_RABBITMQ_REQUEUE_ON_ERROR", True)
    reconnect_delay_seconds = float(
        os.getenv(
            "LCSP_MDA_RABBITMQ_RECONNECT_DELAY_SECONDS",
            str(DEFAULT_RECONNECT_DELAY_SECONDS),
        )
    )
    requeue_delay_seconds = float(
        os.getenv(
            "LCSP_MDA_RABBITMQ_REQUEUE_DELAY_SECONDS",
            str(DEFAULT_REQUEUE_DELAY_SECONDS),
        )
    )
    fallback_max_redeliveries = int(
        os.getenv(
            "LCSP_MDA_RABBITMQ_FALLBACK_MAX_REDELIVERIES",
            str(DEFAULT_FALLBACK_MAX_REDELIVERIES),
        )
    )
    api_base_url = os.getenv("NESTJS_API_BASE_URL")
    api_ready_timeout_seconds = float(
        os.getenv(
            "LCSP_MDA_API_READY_TIMEOUT_SECONDS",
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
        LOGGER.info("Stopping Managed Agent RabbitMQ consumer")
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

    with ThreadPoolExecutor(
        max_workers=prefetch_count,
        thread_name_prefix="lcsp-mda-boundary",
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
                )
                LOGGER.info("Starting Managed Agent RabbitMQ consumer")
                channel.start_consuming()
            except (pika.exceptions.AMQPError, OSError):
                if not stopping.is_set():
                    LOGGER.exception(
                        "Managed Agent RabbitMQ connection lost; reconnecting in %.1fs",
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
                "Nest API was not ready before starting Managed Agent "
                f"RabbitMQ consumer: {health_url} ({last_error})"
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
) -> None:
    channel.exchange_declare(
        exchange=exchange,
        exchange_type="topic",
        durable=True,
    )
    channel.basic_qos(prefetch_count=prefetch_count)
    channel.confirm_delivery()

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
            ),
        )
        LOGGER.info(
            "Bound Managed Agent boundary queue=%s routing_key=%s boundary=%s retry_delays=%s",
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
) -> Callable[[Any, Any, Any, bytes], None]:
    def handle_delivery(
        channel: Any,
        method: Any,
        properties: Any,
        body: bytes,
    ) -> None:
        future = executor.submit(
            _dispatch_delivery,
            boundary_name,
            properties,
            body,
        )
        future.add_done_callback(
            lambda completed: _schedule_delivery_settlement(
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


def _dispatch_delivery(boundary_name: str, properties: Any, body: bytes) -> None:
    message = _decode_message(body)
    correlation_id = _correlation_id(
        message,
        getattr(properties, "headers", None),
        boundary_name,
    )
    invoke_boundary(boundary_name, message, correlation_id)


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

        LOGGER.error(
            "Managed Agent boundary dispatch failed boundary=%s routing_key=%s",
            boundary_name,
            routing_key,
            exc_info=(type(error), error, error.__traceback__),
        )
        retryable = (
            requeue_on_error
            and not isinstance(error, NonRetryableAgentBoundaryError)
            and not is_terminal_task_error(error)
        )
        current_attempt = _delivery_attempt(properties)
        max_attempts = len(retry_delays_seconds)
        if retryable and current_attempt < max_attempts:
            next_attempt = current_attempt + 1
            retry_delay_seconds = retry_delays_seconds[current_attempt]
            retry_queue = _retry_queue_name(queue_name, retry_delay_seconds)
            LOGGER.warning(
                "Managed Agent boundary retry scheduled boundary=%s routing_key=%s "
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
                "Managed Agent boundary retry exhausted boundary=%s routing_key=%s "
                "correlation_id=%s attempt=%s max_attempts=%s exception_type=%s",
                boundary_name,
                routing_key,
                _property_value(properties, "correlation_id"),
                current_attempt,
                max_attempts,
                type(error).__name__,
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
        raise ValueError("RabbitMQ Managed Agent message must be a JSON object")
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
    return f"mda:{boundary_name}"



def _optional_retry_delays(entry: dict[str, Any]) -> tuple[float, ...]:
    raw = entry.get("retry_delays_seconds")
    if raw is None:
        target = entry.get("target")
        if isinstance(target, str) and target:
            return tuple(float(value) for value in load_boundary(target).retry_delays_seconds)
        return ()
    if not isinstance(raw, (list, tuple)):
        raise RuntimeError("Managed Agent boundary manifest retry_delays_seconds must be a list")
    delays: list[float] = []
    for value in raw:
        delay = float(value)
        if delay < 0:
            raise RuntimeError("Managed Agent boundary retry delay cannot be negative")
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


def _delay_milliseconds(delay_seconds: float) -> int:
    return max(int(delay_seconds * 1000), 1)


def _retry_queue_name(queue_name: str, delay_seconds: float) -> str:
    return f"{queue_name}.retry.{_delay_milliseconds(delay_seconds)}ms"


def _delivery_attempt(properties: Any | None) -> int:
    headers = getattr(properties, "headers", None) or {}
    try:
        return max(int(headers.get(MANAGED_ATTEMPT_HEADER, 0)), 0)
    except (TypeError, ValueError):
        return 0


def _property_value(properties: Any | None, name: str) -> Any:
    return getattr(properties, name, None) if properties is not None else None


def _retry_properties(properties: Any | None, attempt: int) -> pika.BasicProperties:
    headers = dict(getattr(properties, "headers", None) or {})
    headers[MANAGED_ATTEMPT_HEADER] = attempt
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
            "Managed Agent boundary retry publish failed retry_queue=%s attempt=%s",
            retry_queue,
            attempt,
        )
        return False
    return result is not False


def _required_manifest_text(entry: dict[str, str], key: str) -> str:
    value = entry.get(key)
    if not value:
        raise RuntimeError(f"Managed Agent boundary manifest entry missing {key}")
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
