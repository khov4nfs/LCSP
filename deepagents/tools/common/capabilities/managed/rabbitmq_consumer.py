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
from time import monotonic, sleep
from typing import Any, Callable

import httpx
import pika

from tools.common.capabilities.platform.env import load_runtime_env
from tools.common.capabilities.managed.boundary import NonRetryableAgentBoundaryError
from tools.common.capabilities.managed.invocation import (
    invocation_boundary_manifest,
    invoke_boundary,
)

LOGGER = logging.getLogger("lcsp.mda.rabbitmq_consumer")
DEFAULT_EXCHANGE = "lcsp.events"
DEFAULT_QUEUE_PREFIX = "lcsp.mda.boundary"
DEFAULT_RECONNECT_DELAY_SECONDS = 2.0
DEFAULT_REQUEUE_DELAY_SECONDS = 2.0
DEFAULT_API_READY_TIMEOUT_SECONDS = 60.0
DEFAULT_API_READY_POLL_SECONDS = 0.5


@dataclass(frozen=True)
class BoundaryBinding:
    """One RabbitMQ queue binding for one Managed Agent boundary."""

    boundary_name: str
    source_event: str
    queue_name: str


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
) -> None:
    channel.exchange_declare(
        exchange=exchange,
        exchange_type="topic",
        durable=True,
    )
    channel.basic_qos(prefetch_count=prefetch_count)

    for binding in bindings:
        channel.queue_declare(queue=binding.queue_name, durable=True)
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
                requeue_on_error=requeue_on_error,
                requeue_delay_seconds=requeue_delay_seconds,
            ),
        )
        LOGGER.info(
            "Bound Managed Agent boundary queue=%s routing_key=%s boundary=%s",
            binding.queue_name,
            binding.source_event,
            binding.boundary_name,
        )


def _delivery_handler(
    boundary_name: str,
    *,
    connection: pika.BlockingConnection,
    executor: ThreadPoolExecutor,
    requeue_on_error: bool,
    requeue_delay_seconds: float,
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
                boundary_name=boundary_name,
                requeue_on_error=requeue_on_error,
                requeue_delay_seconds=requeue_delay_seconds,
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
    boundary_name: str,
    requeue_on_error: bool,
    requeue_delay_seconds: float,
    completed: Future[None],
) -> None:
    error = _delivery_error(completed)
    if (
        error is not None
        and requeue_on_error
        and not isinstance(error, NonRetryableAgentBoundaryError)
        and requeue_delay_seconds > 0
    ):
        sleep(requeue_delay_seconds)

    try:
        connection.add_callback_threadsafe(
            partial(
                _settle_delivery,
                channel=channel,
                delivery_tag=delivery_tag,
                routing_key=routing_key,
                boundary_name=boundary_name,
                requeue_on_error=requeue_on_error,
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
    boundary_name: str,
    requeue_on_error: bool,
    completed: Future[None],
) -> None:
    if not channel.is_open:
        LOGGER.warning(
            "RabbitMQ channel closed before delivery settlement "
            "boundary=%s routing_key=%s",
            boundary_name,
            routing_key,
        )
        return

    error = _delivery_error(completed)

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
        channel.basic_nack(
            delivery_tag=delivery_tag,
            requeue=(
                requeue_on_error
                and not isinstance(error, NonRetryableAgentBoundaryError)
            ),
        )
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
