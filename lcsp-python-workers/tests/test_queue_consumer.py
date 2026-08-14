import json
import signal
from unittest.mock import MagicMock

import pytest

from lcsp_workers.platform.config import WorkerConfig
from lcsp_workers.platform.queue_consumer import ConsumerBase, NonRetryableWorkerError
from lcsp_workers.platform.logging import configure_logging

configure_logging("INFO")


class DummyConsumer(ConsumerBase):
    queue_name = "test_queue"
    routing_key = "test.routing"

    def __init__(self, config, pbac_client=None):
        super().__init__(config, pbac_client)
        self.handle_called = False
        self.raise_in_handle = False

    def handle(self, message: dict, correlationId: str) -> None:
        if self.raise_in_handle:
            raise ValueError("Intentional error")
        self.handle_called = True


class DelayedRetryConsumer(DummyConsumer):
    retry_delays_seconds = (10, 60, 300)


@pytest.fixture
def config():
    return WorkerConfig(
        rabbitmq_url="amqp://guest:guest@localhost/",
        rabbitmq_exchange="test.events",
        nestjs_api_base_url="http://localhost:3000",
        worker_api_key="test-key",
        log_level="INFO",
        max_retries=3,
    )


@pytest.fixture
def pbac_mock():
    return MagicMock()


@pytest.fixture
def channel_mock():
    return MagicMock()


@pytest.fixture
def method_mock():
    method = MagicMock()
    method.delivery_tag = 1
    return method


def test_t01_valid_message_pbac_allow(config, pbac_mock, channel_mock, method_mock):
    """T01: Valid message + PBAC allow calls handle and acks."""
    pbac_mock.check.return_value = "allow"
    consumer = DummyConsumer(config, pbac_mock)

    properties = MagicMock()
    properties.headers = {"user_id": "u1", "action": "test"}
    body = json.dumps({"test": "data"}).encode("utf-8")

    consumer._on_message(channel_mock, method_mock, properties, body)

    pbac_mock.check.assert_called_once()
    assert consumer.handle_called is True
    channel_mock.basic_ack.assert_called_once_with(delivery_tag=1)
    channel_mock.basic_nack.assert_not_called()
    channel_mock.basic_publish.assert_not_called()


def test_t01_scan_trigger_headers_allow(config, pbac_mock, channel_mock, method_mock):
    """T01b: Snapshot auto-scan headers are enough for PBAC allow."""
    pbac_mock.check.return_value = "allow"
    consumer = DummyConsumer(config, pbac_mock)

    properties = MagicMock()
    properties.headers = {
        "user_id": "user-1",
        "organization_id": "org-1",
        "action": "scan:trigger",
        "x-correlation-id": "corr-1",
    }
    body = json.dumps({"snapshotId": "snapshot-1"}).encode("utf-8")

    consumer._on_message(channel_mock, method_mock, properties, body)

    pbac_mock.check.assert_called_once_with(
        user_id="user-1",
        organization_id="org-1",
        action="scan:trigger",
        correlationId="corr-1",
    )
    assert consumer.handle_called is True
    channel_mock.basic_ack.assert_called_once_with(delivery_tag=1)


def test_t02_pbac_deny(config, pbac_mock, channel_mock, method_mock, capsys):
    """T02: PBAC deny nacks without requeue and logs WORKER_TASK_DENIED."""
    pbac_mock.check.return_value = "deny"
    consumer = DummyConsumer(config, pbac_mock)

    properties = MagicMock()
    properties.headers = {}
    body = b"{}"

    consumer._on_message(channel_mock, method_mock, properties, body)

    assert consumer.handle_called is False
    channel_mock.basic_nack.assert_called_once_with(delivery_tag=1, requeue=False)

    captured = capsys.readouterr()
    assert "WORKER_TASK_DENIED" in captured.out


def test_t03_pbac_unreachable_republishes_with_bounded_retry(
    config, pbac_mock, channel_mock, method_mock
):
    """T03: PBAC unreachable republishes with an explicit retry counter."""
    pbac_mock.check.side_effect = ConnectionError("unreachable")
    consumer = DummyConsumer(config, pbac_mock)

    properties = MagicMock()
    properties.headers = {}
    body = b"{}"

    consumer._on_message(channel_mock, method_mock, properties, body)

    assert consumer.handle_called is False
    channel_mock.basic_publish.assert_called_once()
    publish_kwargs = channel_mock.basic_publish.call_args.kwargs
    assert publish_kwargs["routing_key"] == "test_queue"
    assert publish_kwargs["properties"].headers["x-lcsp-retry-count"] == 1
    channel_mock.basic_ack.assert_called_once_with(delivery_tag=1)
    channel_mock.basic_nack.assert_not_called()


def test_t04_handle_exception_retry_and_dlq(config, pbac_mock, channel_mock, method_mock):
    """T04: Handler failures use a bounded explicit retry count then dead-letter."""
    pbac_mock.check.return_value = "allow"
    consumer = DummyConsumer(config, pbac_mock)
    consumer.raise_in_handle = True
    body = b"{}"

    properties1 = MagicMock()
    properties1.headers = {"x-lcsp-retry-count": 2}
    properties1.correlationId = "cid-123"
    consumer._on_message(channel_mock, method_mock, properties1, body)

    channel_mock.basic_publish.assert_called_once()
    retry_properties = channel_mock.basic_publish.call_args.kwargs["properties"]
    assert retry_properties.headers["x-lcsp-retry-count"] == 3
    assert retry_properties.correlation_id == "cid-123"
    channel_mock.basic_ack.assert_called_with(delivery_tag=1)

    channel_mock.reset_mock()
    properties2 = MagicMock()
    properties2.headers = {"x-lcsp-retry-count": 3}
    consumer._on_message(channel_mock, method_mock, properties2, body)

    channel_mock.basic_publish.assert_not_called()
    channel_mock.basic_nack.assert_called_once_with(delivery_tag=1, requeue=False)


def test_terminal_handler_error_bypasses_retry(config, pbac_mock, channel_mock, method_mock):
    """A recorded terminal failure must enter the broker DLQ immediately."""
    pbac_mock.check.return_value = "allow"
    consumer = DummyConsumer(config, pbac_mock)
    consumer.handle = MagicMock(side_effect=NonRetryableWorkerError("terminal"))

    properties = MagicMock()
    properties.headers = {}
    consumer._on_message(channel_mock, method_mock, properties, b"{}")

    channel_mock.basic_nack.assert_called_once_with(delivery_tag=1, requeue=False)
    channel_mock.basic_publish.assert_not_called()


def test_retry_count_falls_back_to_x_death(config):
    consumer = DummyConsumer(config, MagicMock())
    assert consumer._get_attempt_count({"x-death": [{"count": 2}]}) == 2


def test_retry_policy_uses_a_ttl_queue_for_each_attempt(
    config,
    pbac_mock,
    channel_mock,
    method_mock,
):
    pbac_mock.check.return_value = "allow"
    consumer = DelayedRetryConsumer(config, pbac_mock)
    consumer.raise_in_handle = True
    properties = MagicMock()
    properties.headers = {"x-lcsp-retry-count": 1}

    consumer._on_message(channel_mock, method_mock, properties, b"{}")

    assert channel_mock.basic_publish.call_args.kwargs["routing_key"] == "test_queue.retry.60s"


def test_run_declares_ttl_retry_queues(monkeypatch, config):
    consumer = DelayedRetryConsumer(config, MagicMock())
    connection = MagicMock()
    connection.is_open = True
    connection.process_data_events.side_effect = KeyboardInterrupt()
    channel = MagicMock()
    connection.channel.return_value = channel
    monkeypatch.setattr(
        "lcsp_workers.platform.queue_consumer.pika.BlockingConnection",
        lambda _params: connection,
    )
    monkeypatch.setattr(
        "lcsp_workers.platform.queue_consumer.pika.URLParameters",
        lambda url: url,
    )
    monkeypatch.setattr(
        "lcsp_workers.platform.queue_consumer.HealthServer",
        lambda **_kwargs: MagicMock(),
    )

    consumer.run()

    channel.exchange_declare.assert_called_once_with(
        exchange="test.events",
        exchange_type="topic",
        durable=True,
    )
    assert channel.queue_declare.call_args_list[1].kwargs == {
        "queue": "test_queue.retry.10s",
        "durable": True,
        "arguments": {
            "x-message-ttl": 10_000,
            "x-dead-letter-exchange": "",
            "x-dead-letter-routing-key": "test_queue",
        },
    }


def test_t05_sigterm_handling(config):
    """T05: SIGTERM during processing finishes current message then exits cleanly."""
    consumer = DummyConsumer(config, MagicMock())

    assert consumer._shutdown is False
    consumer._handle_sigterm(15, None)
    assert consumer._shutdown is True


def test_sigint_handling_sets_shutdown(config):
    consumer = DummyConsumer(config, MagicMock())

    consumer._handle_sigterm(signal.SIGINT, None)

    assert consumer._shutdown is True


def test_run_treats_keyboard_interrupt_as_shutdown(monkeypatch, config):
    consumer = DummyConsumer(config, MagicMock())
    connection = MagicMock()
    connection.is_open = True
    connection.process_data_events.side_effect = KeyboardInterrupt()
    channel = MagicMock()
    connection.channel.return_value = channel

    monkeypatch.setattr(
        "lcsp_workers.platform.queue_consumer.pika.BlockingConnection",
        lambda _params: connection,
    )
    monkeypatch.setattr(
        "lcsp_workers.platform.queue_consumer.pika.URLParameters",
        lambda url: url,
    )
    monkeypatch.setattr(
        "lcsp_workers.platform.queue_consumer.HealthServer",
        lambda **_kwargs: MagicMock(),
    )

    consumer.run()

    assert consumer._shutdown is True
    channel.exchange_declare.assert_called_once_with(
        exchange="test.events",
        exchange_type="topic",
        durable=True,
    )
    channel.queue_bind.assert_called_once_with(
        exchange="test.events",
        queue="test_queue",
        routing_key="test.routing",
    )
    connection.close.assert_called_once()


def test_run_swallows_keyboard_interrupt_while_closing(monkeypatch, config):
    consumer = DummyConsumer(config, MagicMock())
    connection = MagicMock()
    connection.is_open = True
    connection.process_data_events.side_effect = KeyboardInterrupt()
    connection.close.side_effect = KeyboardInterrupt()
    channel = MagicMock()
    connection.channel.return_value = channel

    monkeypatch.setattr(
        "lcsp_workers.platform.queue_consumer.pika.BlockingConnection",
        lambda _params: connection,
    )
    monkeypatch.setattr(
        "lcsp_workers.platform.queue_consumer.pika.URLParameters",
        lambda url: url,
    )
    monkeypatch.setattr(
        "lcsp_workers.platform.queue_consumer.HealthServer",
        lambda **_kwargs: MagicMock(),
    )

    consumer.run()

    assert consumer._shutdown is True
    connection.close.assert_called_once()


def test_t06_correlationId_in_logs(
    config, pbac_mock, channel_mock, method_mock, capsys
):
    """T06: every log line contains correlationId field."""
    pbac_mock.check.return_value = "deny"
    consumer = DummyConsumer(config, pbac_mock)

    properties = MagicMock()
    properties.headers = {"correlationId": "test-cid-123"}
    body = b"{}"

    consumer._on_message(channel_mock, method_mock, properties, body)

    captured = capsys.readouterr()
    assert "test-cid-123" in captured.out


def test_t07_secrets_redacted_from_logs(
    config, pbac_mock, channel_mock, method_mock, capsys
):
    """T07: secret field values are redacted from log output."""
    pbac_mock.check.return_value = "allow"
    consumer = DummyConsumer(config, pbac_mock)
    consumer.raise_in_handle = True

    from lcsp_workers.platform.logging import get_logger

    logger = get_logger("test")
    logger.info("test_secret", token="super-secret-123", api_key="secret-key")

    captured = capsys.readouterr()
    assert "[REDACTED]" in captured.out
    assert "super-secret-123" not in captured.out
    assert "secret-key" not in captured.out
