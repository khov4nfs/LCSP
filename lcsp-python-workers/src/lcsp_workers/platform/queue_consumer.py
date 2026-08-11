import json
import os
import signal
import pika

from lcsp_workers.platform.correlation import extract_from_amqp_headers, set_correlation_id
from lcsp_workers.platform.health import DEFAULT_HEALTH_PORT, HealthServer
from lcsp_workers.platform.logging import get_logger

logger = get_logger(__name__)

_RETRY_HEADER = "x-lcsp-retry-count"


class ConsumerBase:
    queue_name: str  # Override in subclass
    routing_key: str  # Override in subclass
    requires_pbac: bool = True  # Override to False for system-only workers

    def __init__(self, config, pbac_client=None):
        self._config = config
        self._pbac = pbac_client
        self._shutdown = False
        self._channel = None
        self._health_server: HealthServer | None = None

    def handle(self, message: dict, correlation_id: str) -> None:
        """Override with domain logic."""
        raise NotImplementedError

    def run(self) -> None:
        signal.signal(signal.SIGTERM, self._handle_sigterm)
        signal.signal(signal.SIGINT, self._handle_sigterm)
        conn = None
        self._health_server = HealthServer(
            worker_name=self.__class__.__name__,
            rabbitmq_connected_provider=self._is_rabbitmq_connected,
            port=self._read_health_port(),
        )

        try:
            self._health_server.start()

            conn = pika.BlockingConnection(pika.URLParameters(self._config.rabbitmq_url))
            channel = conn.channel()
            self._channel = channel
            channel.queue_declare(queue=self.queue_name, durable=True)
            channel.queue_bind(
                exchange=self._config.rabbitmq_exchange,
                queue=self.queue_name,
                routing_key=self.routing_key,
            )
            channel.basic_qos(prefetch_count=1)
            channel.basic_consume(self.queue_name, self._on_message)

            while not self._shutdown:
                try:
                    conn.process_data_events(time_limit=1)
                except KeyboardInterrupt:
                    self._handle_sigterm(signal.SIGINT, None)
        finally:
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

    def _on_message(self, ch, method, properties, body) -> None:
        headers = properties.headers or {}
        cid = extract_from_amqp_headers(headers)
        set_correlation_id(cid)
        attempts = self._get_attempt_count(headers)

        if self.requires_pbac:
            try:
                decision = self._pbac.check(
                    user_id=headers.get("user_id", ""),
                    organization_id=headers.get("organization_id", ""),
                    action=headers.get("action", ""),
                    correlation_id=cid,
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
                ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
                return

        try:
            message = json.loads(body)
            if not isinstance(message, dict):
                raise ValueError("worker message must be a JSON object")
            message.setdefault("_delivery_attempt", attempts)
            self.handle(message, cid)
            ch.basic_ack(delivery_tag=method.delivery_tag)
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
        if attempts >= self._config.max_retries:
            logger.error(
                "HANDLER_RETRY_EXHAUSTED",
                attempts=attempts,
                max_retries=self._config.max_retries,
            )
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
            return

        retry_headers = dict(properties.headers or {})
        retry_headers[_RETRY_HEADER] = attempts + 1
        retry_properties = pika.BasicProperties(
            content_type=self._string_property(properties, "content_type"),
            content_encoding=self._string_property(properties, "content_encoding"),
            headers=retry_headers,
            delivery_mode=2,
            correlation_id=self._string_property(properties, "correlation_id"),
            message_id=self._string_property(properties, "message_id"),
            type=self._string_property(properties, "type"),
        )

        try:
            ch.basic_publish(
                exchange="",
                routing_key=self.queue_name,
                body=body,
                properties=retry_properties,
            )
            ch.basic_ack(delivery_tag=method.delivery_tag)
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
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)

    def _handle_sigterm(self, signum, frame) -> None:
        logger.info("SIGTERM_RECEIVED", msg="Finishing current message then stopping")
        self._shutdown = True

    def _get_attempt_count(self, headers: dict) -> int:
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
        value = getattr(properties, name, None)
        return value if isinstance(value, str) else None

    def _is_rabbitmq_connected(self) -> bool:
        channel = self._channel
        if channel is None:
            return False
        return bool(getattr(channel, "is_open", False))

    def _read_health_port(self) -> int:
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
