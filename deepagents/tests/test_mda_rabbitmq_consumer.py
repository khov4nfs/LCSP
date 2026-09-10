import json
from concurrent.futures import Future
from threading import Event
from types import SimpleNamespace

import pytest

from tools.common.capabilities.managed import rabbitmq_consumer


class FakeChannel:
    def __init__(self):
        self.acked = []
        self.nacked = []
        self.is_open = True

    def basic_ack(self, delivery_tag):
        self.acked.append(delivery_tag)

    def basic_nack(self, delivery_tag, requeue):
        self.nacked.append((delivery_tag, requeue))


class ImmediateExecutor:
    def submit(self, function, *args):
        future = Future()
        try:
            future.set_result(function(*args))
        except Exception as error:
            future.set_exception(error)
        return future


class FakeConnection:
    def __init__(self):
        self.callbacks = []

    def add_callback_threadsafe(self, callback):
        self.callbacks.append(callback)
        callback()


def test_boundary_bindings_are_derived_from_manifest(monkeypatch):
    monkeypatch.setattr(
        rabbitmq_consumer,
        "invocation_boundary_manifest",
        lambda: (
            {
                "name": "scan_requested",
                "source_event": "command.scan.requested.v1",
            },
            {
                "name": "engineering_assessment_requested",
                "source_event": "event.technical-evidence.accepted.v1",
            },
        ),
    )

    bindings = rabbitmq_consumer.boundary_bindings("lcsp.mda.test")

    assert bindings == (
        rabbitmq_consumer.BoundaryBinding(
            boundary_name="scan_requested",
            source_event="command.scan.requested.v1",
            queue_name="lcsp.mda.test.scan_requested",
        ),
        rabbitmq_consumer.BoundaryBinding(
            boundary_name="engineering_assessment_requested",
            source_event="event.technical-evidence.accepted.v1",
            queue_name="lcsp.mda.test.engineering_assessment_requested",
        ),
    )


def test_delivery_handler_invokes_boundary_and_acks(monkeypatch):
    invoked = []
    monkeypatch.setattr(
        rabbitmq_consumer,
        "invoke_boundary",
        lambda boundary_name, message, correlation_id: invoked.append(
            (boundary_name, message, correlation_id)
        ),
    )
    channel = FakeChannel()
    method = SimpleNamespace(
        delivery_tag="delivery-1",
        routing_key="command.scan.requested.v1",
    )
    properties = SimpleNamespace(headers={"x-correlation-id": "header-corr"})
    body = json.dumps({"scanJobId": "scan-1"}).encode("utf-8")

    handler = rabbitmq_consumer._delivery_handler(
        "scan_requested",
        connection=FakeConnection(),
        executor=ImmediateExecutor(),
        requeue_on_error=True,
        requeue_delay_seconds=0,
    )
    handler(channel, method, properties, body)

    assert invoked == [
        ("scan_requested", {"scanJobId": "scan-1"}, "header-corr"),
    ]
    assert channel.acked == ["delivery-1"]
    assert channel.nacked == []


def test_delivery_handler_uses_payload_correlation_id(monkeypatch):
    invoked = []
    monkeypatch.setattr(
        rabbitmq_consumer,
        "invoke_boundary",
        lambda boundary_name, message, correlation_id: invoked.append(
            (boundary_name, message, correlation_id)
        ),
    )
    channel = FakeChannel()
    method = SimpleNamespace(delivery_tag="delivery-1", routing_key="event.test")
    properties = SimpleNamespace(headers={"x-correlation-id": "header-corr"})
    body = json.dumps({"correlationId": "payload-corr"}).encode("utf-8")

    handler = rabbitmq_consumer._delivery_handler(
        "test_boundary",
        connection=FakeConnection(),
        executor=ImmediateExecutor(),
        requeue_on_error=True,
        requeue_delay_seconds=0,
    )
    handler(channel, method, properties, body)

    assert invoked == [
        ("test_boundary", {"correlationId": "payload-corr"}, "payload-corr")
    ]
    assert channel.acked == ["delivery-1"]
    assert channel.nacked == []


def test_delivery_handler_nacks_on_dispatch_failure(monkeypatch):
    def fail(_boundary_name, _message, _correlation_id):
        raise RuntimeError("dispatch failed")

    monkeypatch.setattr(rabbitmq_consumer, "invoke_boundary", fail)
    channel = FakeChannel()
    method = SimpleNamespace(delivery_tag="delivery-1", routing_key="event.test")
    properties = SimpleNamespace(headers={})
    body = json.dumps({"payload": True}).encode("utf-8")

    handler = rabbitmq_consumer._delivery_handler(
        "test_boundary",
        connection=FakeConnection(),
        executor=ImmediateExecutor(),
        requeue_on_error=False,
        requeue_delay_seconds=0,
    )
    handler(channel, method, properties, body)

    assert channel.acked == []
    assert channel.nacked == [("delivery-1", False)]


def test_delivery_handler_never_requeues_terminal_boundary_failure(monkeypatch):
    def fail(_boundary_name, _message, _correlation_id):
        raise rabbitmq_consumer.NonRetryableAgentBoundaryError("terminal")

    monkeypatch.setattr(rabbitmq_consumer, "invoke_boundary", fail)
    channel = FakeChannel()
    method = SimpleNamespace(delivery_tag="delivery-1", routing_key="event.test")
    properties = SimpleNamespace(headers={})
    body = json.dumps({"payload": True}).encode("utf-8")

    handler = rabbitmq_consumer._delivery_handler(
        "test_boundary",
        connection=FakeConnection(),
        executor=ImmediateExecutor(),
        requeue_on_error=True,
        requeue_delay_seconds=0,
    )
    handler(channel, method, properties, body)

    assert channel.acked == []
    assert channel.nacked == [("delivery-1", False)]


def test_retryable_delivery_failure_waits_before_requeue(monkeypatch):
    delays = []
    monkeypatch.setattr(
        rabbitmq_consumer,
        "sleep",
        lambda seconds: delays.append(seconds),
    )
    channel = FakeChannel()
    completed = Future()
    completed.set_exception(RuntimeError("retryable"))

    rabbitmq_consumer._schedule_delivery_settlement(
        connection=FakeConnection(),
        channel=channel,
        delivery_tag="delivery-1",
        routing_key="event.test",
        boundary_name="test_boundary",
        requeue_on_error=True,
        requeue_delay_seconds=2,
        completed=completed,
    )

    assert delays == [2]
    assert channel.nacked == [("delivery-1", True)]


def test_delivery_settlement_does_not_nack_a_closed_channel():
    channel = FakeChannel()
    channel.is_open = False
    completed = Future()
    completed.set_result(None)

    rabbitmq_consumer._settle_delivery(
        channel=channel,
        delivery_tag="delivery-1",
        routing_key="event.test",
        boundary_name="test_boundary",
        requeue_on_error=True,
        completed=completed,
    )

    assert channel.acked == []
    assert channel.nacked == []


def test_delivery_settlement_does_not_nack_after_ack_loses_connection():
    class AckLosingChannel(FakeChannel):
        def basic_ack(self, delivery_tag):
            raise rabbitmq_consumer.pika.exceptions.ChannelWrongStateError(
                "channel closed"
            )

    channel = AckLosingChannel()
    completed = Future()
    completed.set_result(None)

    rabbitmq_consumer._settle_delivery(
        channel=channel,
        delivery_tag="delivery-1",
        routing_key="event.test",
        boundary_name="test_boundary",
        requeue_on_error=True,
        completed=completed,
    )

    assert channel.nacked == []


def test_decode_message_rejects_non_object_payload():
    with pytest.raises(ValueError):
        rabbitmq_consumer._decode_message(json.dumps(["bad"]).encode("utf-8"))


def test_wait_for_api_ready_retries_until_health_ok(monkeypatch):
    calls = []

    def get(url, timeout):
        calls.append((url, timeout))
        if len(calls) == 1:
            raise rabbitmq_consumer.httpx.ConnectError("not ready")
        return SimpleNamespace(status_code=200)

    monkeypatch.setattr(rabbitmq_consumer.httpx, "get", get)

    rabbitmq_consumer._wait_for_api_ready(
        api_base_url="http://127.0.0.1:4000/",
        timeout_seconds=1,
        stopping=Event(),
    )

    assert calls == [
        ("http://127.0.0.1:4000/health", 2.0),
        ("http://127.0.0.1:4000/health", 2.0),
    ]


def test_wait_for_api_ready_times_out_before_consuming(monkeypatch):
    def get(_url, timeout):
        raise rabbitmq_consumer.httpx.ConnectError("not ready")

    monkeypatch.setattr(
        rabbitmq_consumer.httpx,
        "get",
        get,
    )

    with pytest.raises(RuntimeError, match="Nest API was not ready"):
        rabbitmq_consumer._wait_for_api_ready(
            api_base_url="http://127.0.0.1:4000",
            timeout_seconds=0,
            stopping=Event(),
        )


@pytest.mark.parametrize("wrapped", [False, True])
def test_schema_type_failure_is_not_requeued(wrapped):
    error = TypeError("invalid schema type")
    if wrapped:
        outer = RuntimeError("dispatch failed")
        outer.__cause__ = error
        error = outer
    channel = FakeChannel()
    completed = Future()
    completed.set_exception(error)
    rabbitmq_consumer._settle_delivery(
        channel=channel, delivery_tag="schema-task", routing_key="event.test",
        boundary_name="test_boundary", requeue_on_error=True, completed=completed,
    )
    assert channel.nacked == [("schema-task", False)]


@pytest.mark.parametrize(
    ("status_code", "requeued"),
    [(409, False), (404, False), (422, False), (None, True)],
)
def test_rejected_api_callback_is_not_requeued(status_code, requeued):
    # A boundary re-runs its model on every redelivery. When our own API rejects the
    # resulting decision, requeueing the identical payload spends money on each attempt and
    # never converges, so only an exhausted server failure stays retryable.
    from tools.common.capabilities.platform.api_client import WorkerCallbackError

    error = WorkerCallbackError(
        "INTERVIEW_RESOLUTION_CRITERIA_UNSATISFIED: Callback failed with client error 409."
        if status_code
        else "Callback failed after 3 attempts with server error 503.",
        status_code=status_code,
    )
    channel = FakeChannel()
    completed = Future()
    completed.set_exception(error)

    rabbitmq_consumer._settle_delivery(
        channel=channel, delivery_tag="callback-task", routing_key="command.test",
        boundary_name="test_boundary", requeue_on_error=True, completed=completed,
    )

    assert channel.nacked == [("callback-task", requeued)]


def test_a_malformed_api_response_is_not_mistaken_for_a_rejection():
    # Response-shape failures carry no HTTP status and keep their retryable classification.
    from tools.common.capabilities.platform.api_client import WorkerCallbackError

    error = WorkerCallbackError("Interview Agent decision response was invalid.")

    assert error.status_code is None
    assert error.callback_client_error is False
