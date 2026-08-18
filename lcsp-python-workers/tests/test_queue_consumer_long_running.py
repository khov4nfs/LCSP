from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from lcsp_workers.platform.queue_consumer import ConsumerBase, _ThreadsafeChannelProxy


class LongRunningConsumer(ConsumerBase):
    queue_name = "long-running-test"
    routing_key = "test.long-running"
    requires_pbac = False

    def __init__(self, config):
        super().__init__(config)
        self.handled = False

    def handle(self, message: dict, correlationId: str) -> None:
        self.handled = True


def _config():
    return SimpleNamespace(max_retries=3)


def test_threadsafe_channel_proxy_marshals_ack_to_connection_thread() -> None:
    connection = MagicMock()
    connection.is_open = True
    connection.add_callback_threadsafe.side_effect = lambda callback: callback()
    channel = MagicMock()
    channel.is_open = True
    proxy = _ThreadsafeChannelProxy(connection, channel)

    proxy.basic_ack(delivery_tag=7)

    connection.add_callback_threadsafe.assert_called_once()
    channel.basic_ack.assert_called_once_with(delivery_tag=7)


def test_delivery_handler_runs_off_connection_thread_and_acks_via_proxy() -> None:
    connection = MagicMock()
    connection.is_open = True
    connection.add_callback_threadsafe.side_effect = lambda callback: callback()
    channel = MagicMock()
    channel.is_open = True
    method = MagicMock()
    method.delivery_tag = 11
    properties = MagicMock()
    properties.headers = {"x-correlation-id": "corr-1"}

    consumer = LongRunningConsumer(_config())
    consumer._start_message_thread(connection, channel, method, properties, b"{}")
    consumer._join_message_threads()

    assert consumer.handled is True
    channel.basic_ack.assert_called_once_with(delivery_tag=11)
    assert consumer._has_active_message_threads() is False
