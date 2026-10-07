import json
import time
from concurrent.futures import Future, ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace

import pytest

from tools.common.capabilities.agent_runtime import rabbitmq_consumer


class FakeChannel:
    def __init__(self):
        self.acked = []
        self.nacked = []
        self.published = []
        self.declared = []
        self.bound = []
        self.consumed = []
        self.deleted = []
        self.confirmed = False
        self.publish_result = True
        self.is_open = True

    def basic_ack(self, delivery_tag):
        self.acked.append(delivery_tag)

    def basic_nack(self, delivery_tag, requeue):
        self.nacked.append((delivery_tag, requeue))

    def basic_publish(self, **kwargs):
        self.published.append(kwargs)
        return self.publish_result

    def confirm_delivery(self):
        self.confirmed = True

    def queue_declare(self, **kwargs):
        self.declared.append(kwargs)

    def exchange_declare(self, **_kwargs):
        pass

    def queue_bind(self, **kwargs):
        self.bound.append(kwargs)

    def basic_qos(self, **_kwargs):
        pass

    def basic_consume(self, **kwargs):
        self.consumed.append(kwargs)

    def queue_delete(self, **kwargs):
        self.deleted.append(kwargs)


@pytest.mark.parametrize("boundary", ["scan_requested", "engineering_assessment_requested"])
def test_configured_boundary_deadline_leaves_broker_settlement_margin(monkeypatch, boundary):
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_BROKER_ACK_TIMEOUT_SECONDS", "1800")
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_SETTLEMENT_MARGIN_SECONDS", "120")
    monkeypatch.setenv(f"LCSP_AGENT_RUNTIME_BOUNDARY_TIMEOUT_{boundary.upper()}_SECONDS", "3600")
    assert rabbitmq_consumer._boundary_timeout_seconds(boundary) == 1680


def test_short_test_deadline_is_not_extended(monkeypatch):
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_BOUNDARY_TIMEOUT_SCAN_REQUESTED_SECONDS", "5")
    assert rabbitmq_consumer._boundary_timeout_seconds("scan_requested") == 5


def test_invalid_settlement_margin_fails_before_consuming(monkeypatch):
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_BOUNDARY_TIMEOUT_SCAN_REQUESTED_SECONDS", "60")
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_BROKER_ACK_TIMEOUT_SECONDS", "120")
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_SETTLEMENT_MARGIN_SECONDS", "120")
    with pytest.raises(RuntimeError, match="Settlement margin"):
        rabbitmq_consumer._boundary_timeout_seconds("scan_requested")


@pytest.mark.parametrize("value", ["nan", "inf", "0", "-1"])
def test_broker_deadline_configuration_requires_finite_positive_values(monkeypatch, value):
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_BOUNDARY_TIMEOUT_SCAN_REQUESTED_SECONDS", "60")
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_BROKER_ACK_TIMEOUT_SECONDS", value)
    with pytest.raises(RuntimeError, match="finite and > 0"):
        rabbitmq_consumer._boundary_timeout_seconds("scan_requested")


def test_long_boundary_budget_requires_matching_broker_budget(monkeypatch):
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_BROKER_ACK_TIMEOUT_SECONDS", "7200")
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_BOUNDARY_TIMEOUT_SCAN_REQUESTED_SECONDS", "3600")
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_SETTLEMENT_MARGIN_SECONDS", "120")
    assert rabbitmq_consumer._boundary_timeout_seconds("scan_requested") == 3600


@pytest.mark.parametrize(
    "boundary",
    [
        "scan_requested",
        "engineering_assessment_requested",
        "assessment_interview_resume_requested",
    ],
)
def test_boundaries_have_no_deadline_unless_one_is_configured(monkeypatch, boundary):
    # Agent reasoning time is not bounded; the broker consumer timeout is off.
    for name in (
        f"LCSP_AGENT_RUNTIME_BOUNDARY_TIMEOUT_{boundary.upper()}_SECONDS",
        "LCSP_AGENT_RUNTIME_SCAN_BOUNDARY_TIMEOUT_SECONDS",
        "LCSP_AGENT_RUNTIME_BOUNDARY_TIMEOUT_SECONDS",
    ):
        monkeypatch.delenv(name, raising=False)
    assert rabbitmq_consumer._boundary_timeout_seconds(boundary) is None


def test_terminal_claim_drops_delivery_without_dispatch(monkeypatch):
    client = SimpleNamespace(claim_scan_job=lambda *_args: {"claimed": False, "terminal": True})
    monkeypatch.setattr(rabbitmq_consumer, "_worker_client_or_none", lambda: client)
    monkeypatch.setattr(rabbitmq_consumer, "dispatch_agent_runtime_event", lambda *_args, **_kwargs: pytest.fail("terminal scan must not dispatch"))
    with pytest.raises(rabbitmq_consumer.TerminalScanDelivery):
        rabbitmq_consumer._dispatch_delivery("scan_requested", SimpleNamespace(headers={}), b'{"scanJobId":"scan-1"}', 45)


def test_claim_time_is_deducted_from_dispatch_budget(monkeypatch):
    times = iter([10.0])
    monkeypatch.setattr(rabbitmq_consumer, "monotonic", lambda: next(times))
    monkeypatch.setattr(rabbitmq_consumer, "_claim_scan_delivery", lambda *_args: None)
    seen = []
    monkeypatch.setattr(rabbitmq_consumer, "dispatch_agent_runtime_event", lambda *_args, **kwargs: seen.append(kwargs["timeout_seconds"]))
    rabbitmq_consumer._dispatch_delivery("scan_requested", SimpleNamespace(headers={}), b'{}', 45, rabbitmq_consumer.DeliverySettlementState(deadline=40))
    assert seen == [30]


@pytest.mark.parametrize("remote_type", ["AgentRuntimeBoundaryTimeout", "AgentServerRunTimeout"])
def test_remote_boundary_deadline_is_not_misreported_as_provider_timeout(remote_type):
    from tools.common.capabilities.agent_runtime.agent_server_client import AgentServerRunError

    assert rabbitmq_consumer._scan_failure_reason_code(AgentServerRunError(remote_type, "deadline reached")) == "AGENT_RUNTIME_BOUNDARY_TIMEOUT"


class ImmediateExecutor:
    def submit(self, function, *args):
        future = Future()
        try:
            future.set_result(function(*args))
        except Exception as error:
            future.set_exception(error)
        return future


class HangingExecutor:
    def submit(self, _function, *_args):
        return Future()


class QueuedExecutor:
    def __init__(self):
        self.submissions = []

    def submit(self, function, *args):
        future = Future()
        self.submissions.append((future, function, args))
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

    bindings = rabbitmq_consumer.boundary_bindings("lcsp.agent_runtime.test")

    assert bindings == (
        rabbitmq_consumer.BoundaryBinding(
            boundary_name="scan_requested",
            source_event="command.scan.requested.v1",
            queue_name="lcsp.agent_runtime.test.scan_requested",
        ),
        rabbitmq_consumer.BoundaryBinding(
            boundary_name="engineering_assessment_requested",
            source_event="event.technical-evidence.accepted.v1",
            queue_name="lcsp.agent_runtime.test.engineering_assessment_requested",
        ),
    )


def test_delivery_handler_invokes_boundary_and_acks(monkeypatch):
    invoked = []
    class FakeWorkerClient:
        def claim_scan_job(self, scan_job_id, payload):
            assert scan_job_id == "scan-1"
            assert payload["boundary_name"] == "scan_requested"
            return {"claimed": True, "terminal": False}

        def post_scan_terminal_failure(self, *_args, **_kwargs):
            raise AssertionError("not expected")

    monkeypatch.setattr(
        rabbitmq_consumer,
        "_worker_client_or_none",
        lambda: FakeWorkerClient(),
    )
    monkeypatch.setattr(
        rabbitmq_consumer,
        "dispatch_agent_runtime_event",
        lambda boundary_name, message, correlation_id, timeout_seconds=None: invoked.append(
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
        retry_delays_seconds=(),
    )
    handler(channel, method, properties, body)

    assert invoked == [
        ("scan_requested", {"scanJobId": "scan-1"}, "header-corr"),
    ]
    assert channel.acked == ["delivery-1"]
    assert channel.nacked == []


def test_scan_delivery_claims_job_before_dispatch(monkeypatch):
    calls = []

    class FakeWorkerClient:
        def claim_scan_job(self, scan_job_id, payload):
            calls.append(("claim", scan_job_id, payload))
            return {"claimed": True, "terminal": False}

        def post_scan_terminal_failure(self, *_args, **_kwargs):
            raise AssertionError("not expected")

    monkeypatch.setattr(
        rabbitmq_consumer,
        "_worker_client_or_none",
        lambda: FakeWorkerClient(),
    )
    monkeypatch.setattr(
        rabbitmq_consumer,
        "dispatch_agent_runtime_event",
        lambda boundary_name, message, correlation_id, timeout_seconds=None: calls.append(
            ("dispatch", boundary_name, message, correlation_id)
        ),
    )

    rabbitmq_consumer._dispatch_delivery(
        "scan_requested",
        SimpleNamespace(headers={"x-correlation-id": "corr-claim"}),
        json.dumps({"scanJobId": "scan-claim"}).encode("utf-8"),
        timeout_seconds=45,
    )

    assert calls == [
        (
            "claim",
            "scan-claim",
            {"boundary_name": "scan_requested", "timeout_seconds": 45},
        ),
        (
            "dispatch",
            "scan_requested",
            {"scanJobId": "scan-claim"},
            "corr-claim",
        ),
    ]


def test_delivery_handler_uses_payload_correlation_id(monkeypatch):
    invoked = []
    monkeypatch.setattr(
        rabbitmq_consumer,
        "dispatch_agent_runtime_event",
        lambda boundary_name, message, correlation_id, timeout_seconds=None: invoked.append(
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
        retry_delays_seconds=(),
    )
    handler(channel, method, properties, body)

    assert invoked == [
        ("test_boundary", {"correlationId": "payload-corr"}, "payload-corr")
    ]
    assert channel.acked == ["delivery-1"]
    assert channel.nacked == []


def test_delivery_handler_nacks_on_dispatch_failure(monkeypatch):
    def fail(_boundary_name, _message, _correlation_id, timeout_seconds=None):
        raise RuntimeError("dispatch failed")

    monkeypatch.setattr(rabbitmq_consumer, "dispatch_agent_runtime_event", fail)
    channel = FakeChannel()
    method = SimpleNamespace(delivery_tag="delivery-1", routing_key="event.test")
    properties = SimpleNamespace(headers={})
    body = json.dumps({"payload": True}).encode("utf-8")

    handler = rabbitmq_consumer._delivery_handler(
        "test_boundary",
        connection=FakeConnection(),
        executor=ImmediateExecutor(),
        requeue_on_error=False,
        retry_delays_seconds=(),
    )
    handler(channel, method, properties, body)

    assert channel.acked == []
    assert channel.nacked == [("delivery-1", False)]


def test_delivery_handler_never_requeues_terminal_boundary_failure(monkeypatch):
    def fail(_boundary_name, _message, _correlation_id, timeout_seconds=None):
        raise rabbitmq_consumer.NonRetryableAgentBoundaryError("terminal")

    monkeypatch.setattr(rabbitmq_consumer, "dispatch_agent_runtime_event", fail)
    channel = FakeChannel()
    method = SimpleNamespace(delivery_tag="delivery-1", routing_key="event.test")
    properties = SimpleNamespace(headers={})
    body = json.dumps({"payload": True}).encode("utf-8")

    handler = rabbitmq_consumer._delivery_handler(
        "test_boundary",
        connection=FakeConnection(),
        executor=ImmediateExecutor(),
        requeue_on_error=True,
        retry_delays_seconds=(),
    )
    handler(channel, method, properties, body)

    assert channel.acked == []
    assert channel.nacked == [("delivery-1", False)]


def test_boundary_timeout_settles_delivery_and_terminalizes_scan(monkeypatch):
    failures = []

    class FakeWorkerClient:
        def claim_scan_job(self, *_args, **_kwargs):
            raise AssertionError("not expected")

        def post_scan_terminal_failure(self, scan_job_id, payload):
            failures.append((scan_job_id, payload))

    monkeypatch.setattr(
        rabbitmq_consumer,
        "_worker_client_or_none",
        lambda: FakeWorkerClient(),
    )
    channel = FakeChannel()

    rabbitmq_consumer._schedule_delivery_timeout_settlement(
        state=rabbitmq_consumer.DeliverySettlementState(),
        connection=FakeConnection(),
        channel=channel,
        delivery_tag="delivery-timeout",
        routing_key="command.scan.requested.v1",
        queue_name="lcsp.agent_runtime.test.scan_requested",
        boundary_name="scan_requested",
        properties=SimpleNamespace(headers={"x-correlation-id": "corr-timeout"}),
        body=json.dumps({"scanJobId": "scan-timeout"}).encode("utf-8"),
        requeue_on_error=True,
        retry_delays_seconds=(30,),
        timeout_seconds=0.1,
    )

    assert failures == [
        (
            "scan-timeout",
            {
                "boundary_name": "scan_requested",
                "reason_code": "AGENT_RUNTIME_BOUNDARY_TIMEOUT",
                "status": "FAILED",
                "summary": "Agent Runtime boundary timed out",
                "timeout_seconds": 0.1,
                "correlation_id": "corr-timeout",
            },
        )
    ]
    assert channel.acked == []
    assert channel.nacked == [("delivery-timeout", False)]


def test_engineering_timeout_journals_dispatch_failure_without_terminalizing_scan(monkeypatch):
    from orchestration.agent_stream import AgentStreamSession
    from tools.common.capabilities.agent_runtime import invocation

    events = []
    monkeypatch.setattr(
        invocation, "_agent_stream_session",
        lambda boundary, message, correlation: AgentStreamSession(
            assessment_id=message["assessmentId"],
            run_id=message["scanJobId"],
            correlation_id=correlation,
            boundary_name=boundary,
            emit_payload=events.append,
        ),
    )
    monkeypatch.setattr(
        rabbitmq_consumer, "_worker_client_or_none",
        lambda: pytest.fail("engineering timeout must not fail the Scanner"),
    )
    channel = FakeChannel()
    rabbitmq_consumer._schedule_delivery_timeout_settlement(
        state=rabbitmq_consumer.DeliverySettlementState(),
        connection=FakeConnection(), channel=channel, delivery_tag="engineering-timeout",
        routing_key="technical.evidence.accepted.v1", queue_name="engineering",
        boundary_name="engineering_assessment_requested",
        properties=SimpleNamespace(headers={"x-correlation-id": "corr-engineering"}),
        body=json.dumps({"assessmentId": "assessment-1", "scanJobId": "scan-1"}).encode(),
        requeue_on_error=True, retry_delays_seconds=(30,), timeout_seconds=0.1,
    )
    assert len(events) == 1
    assert events[0]["event_type"] == "BOUNDARY_FAILED"
    assert events[0]["status"] == "FAILED"
    assert events[0]["correlation_id"] == "corr-engineering"
    assert events[0]["run_id"] == "scan-1"
    assert events[0]["data"]["reasonCode"] == "AGENT_RUNTIME_BOUNDARY_TIMEOUT"
    assert channel.nacked == [("engineering-timeout", False)]


def test_scan_terminal_failure_payload_never_uses_model_call_limit_error(monkeypatch):
    from tools.common.capabilities.agent_runtime.agent_server_client import (
        AgentServerRunError,
    )

    failures = []

    class FakeWorkerClient:
        def post_scan_terminal_failure(self, scan_job_id, payload):
            failures.append((scan_job_id, payload))

    monkeypatch.setattr(
        rabbitmq_consumer,
        "_worker_client_or_none",
        lambda: FakeWorkerClient(),
    )
    channel = FakeChannel()
    completed: Future[None] = Future()
    completed.set_exception(
        AgentServerRunError(
            "ModelCallLimitExceededError",
            "run-level model call limit exceeded",
        ),
    )

    rabbitmq_consumer._schedule_delivery_settlement(
        connection=FakeConnection(),
        channel=channel,
        delivery_tag="delivery-limit",
        routing_key="command.scan.requested.v1",
        queue_name="lcsp.agent_runtime.test.scan_requested",
        boundary_name="scan_requested",
        properties=SimpleNamespace(headers={"x-correlation-id": "corr-limit"}),
        body=json.dumps({"scanJobId": "scan-limit"}).encode("utf-8"),
        requeue_on_error=True,
        retry_delays_seconds=(),
        completed=completed,
    )

    assert failures == [
        (
            "scan-limit",
            {
                "boundary_name": "scan_requested",
                "reason_code": "REPOSITORY_ANALYSIS_FAILED",
                "status": "FAILED",
                "summary": "Agent Runtime boundary failed",
                "timeout_seconds": None,
                "correlation_id": "corr-limit",
            },
        )
    ]
    assert "ModelCallLimitExceededError" not in json.dumps(failures)
    assert channel.nacked == [("delivery-limit", False)]


def test_delivery_timeout_prevents_indefinite_unacked_slot(monkeypatch):
    monkeypatch.setattr(rabbitmq_consumer, "_worker_client_or_none", lambda: None)
    channel = FakeChannel()
    settled = Event()
    original_nack = channel.basic_nack

    def basic_nack(delivery_tag, requeue):
        original_nack(delivery_tag, requeue)
        settled.set()

    monkeypatch.setattr(channel, "basic_nack", basic_nack)
    handler = rabbitmq_consumer._delivery_handler(
        "scan_requested",
        connection=FakeConnection(),
        executor=HangingExecutor(),
        queue_name="lcsp.agent_runtime.test.scan_requested",
        requeue_on_error=True,
        retry_delays_seconds=(),
        timeout_seconds=0.01,
    )

    handler(
        channel,
        SimpleNamespace(
            delivery_tag="delivery-hangs",
            routing_key="command.scan.requested.v1",
        ),
        SimpleNamespace(headers={}),
        json.dumps({"scanJobId": "scan-hangs"}).encode("utf-8"),
    )

    assert settled.wait(1)

    assert channel.acked == []
    assert channel.nacked == [("delivery-hangs", False)]


def test_timed_out_delivery_does_not_block_next_scan_when_prefetch_is_one(monkeypatch):
    calls = []
    first_entered = Event()
    release_first = Event()

    def dispatch(_boundary_name, message, _correlation_id, timeout_seconds=None):
        if message["scanJobId"] == "scan-first":
            first_entered.set()
            release_first.wait(5)
            return
        calls.append(message["scanJobId"])

    monkeypatch.setattr(rabbitmq_consumer, "_worker_client_or_none", lambda: None)
    monkeypatch.setattr(rabbitmq_consumer, "dispatch_agent_runtime_event", dispatch)
    channel = FakeChannel()
    connection = FakeConnection()

    with ThreadPoolExecutor(max_workers=2) as executor:
        handler = rabbitmq_consumer._delivery_handler(
            "scan_requested",
            connection=connection,
            executor=executor,
            queue_name="lcsp.agent_runtime.test.scan_requested",
            requeue_on_error=True,
            retry_delays_seconds=(),
            timeout_seconds=0.01,
        )
        handler(
            channel,
            SimpleNamespace(
                delivery_tag="delivery-first",
                routing_key="command.scan.requested.v1",
            ),
            SimpleNamespace(headers={}),
            json.dumps({"scanJobId": "scan-first"}).encode("utf-8"),
        )
        assert first_entered.wait(1)
        time.sleep(0.05)
        assert channel.nacked == [("delivery-first", False)]

        handler(
            channel,
            SimpleNamespace(
                delivery_tag="delivery-second",
                routing_key="command.scan.requested.v1",
            ),
            SimpleNamespace(headers={}),
            json.dumps({"scanJobId": "scan-second"}).encode("utf-8"),
        )
        time.sleep(0.05)
        release_first.set()

    assert calls == ["scan-second"]
    assert channel.acked == ["delivery-second"]
    assert channel.nacked == [("delivery-first", False)]


def test_timeout_cancels_queued_dispatch_before_late_claim_or_side_effect(monkeypatch):
    dispatched = []
    monkeypatch.setattr(rabbitmq_consumer, "_worker_client_or_none", lambda: None)
    monkeypatch.setattr(
        rabbitmq_consumer,
        "dispatch_agent_runtime_event",
        lambda *_args: dispatched.append(_args),
    )
    executor = QueuedExecutor()
    channel = FakeChannel()
    handler = rabbitmq_consumer._delivery_handler(
        "scan_requested",
        connection=FakeConnection(),
        executor=executor,
        queue_name="lcsp.agent_runtime.test.scan_requested",
        requeue_on_error=True,
        retry_delays_seconds=(),
        timeout_seconds=0.01,
    )

    handler(
        channel,
        SimpleNamespace(
            delivery_tag="delivery-queued",
            routing_key="command.scan.requested.v1",
        ),
        SimpleNamespace(headers={}),
        json.dumps({"scanJobId": "scan-late"}).encode("utf-8"),
    )
    time.sleep(0.05)

    future, function, args = executor.submissions[0]
    assert future.cancelled() is True
    with pytest.raises(rabbitmq_consumer.BoundaryExecutionTimeout):
        function(*args)

    assert dispatched == []
    assert channel.acked == []
    assert channel.nacked == [("delivery-queued", False)]


def test_default_boundary_worker_count_keeps_prefetch_one_from_starving(monkeypatch):
    monkeypatch.delenv("LCSP_AGENT_RUNTIME_BOUNDARY_WORKERS", raising=False)

    assert rabbitmq_consumer._executor_worker_count(1) > 1
    assert rabbitmq_consumer._executor_worker_count(8) == 8


def test_retryable_delivery_failure_republishes_to_retry_queue_without_blocking():
    channel = FakeChannel()
    properties = SimpleNamespace(
        headers={"x-correlation-id": "corr-1", "custom": "kept"},
        correlation_id="corr-1",
        message_id="message-1",
        expiration="999999",
        user_id="api-user",
        cluster_id="deprecated-cluster",
    )
    completed = Future()
    completed.set_exception(RuntimeError("retryable"))

    rabbitmq_consumer._schedule_delivery_settlement(
        connection=FakeConnection(),
        channel=channel,
        delivery_tag="delivery-1",
        routing_key="event.test",
        queue_name="lcsp.agent_runtime.test.test_boundary",
        boundary_name="test_boundary",
        properties=properties,
        body=b"{\"payload\":true}",
        requeue_on_error=True,
        retry_delays_seconds=(600,),
        completed=completed,
    )

    assert channel.acked == ["delivery-1"]
    assert channel.nacked == []
    assert len(channel.published) == 1
    published = channel.published[0]
    assert published["exchange"] == ""
    assert published["routing_key"] == "lcsp.agent_runtime.test.test_boundary.retry.600000ms"
    assert published["body"] == b"{\"payload\":true}"
    assert published["mandatory"] is True
    retry_properties = published["properties"]
    assert retry_properties.delivery_mode == 2
    assert retry_properties.correlation_id == "corr-1"
    assert retry_properties.message_id == "message-1"
    assert retry_properties.expiration is None
    assert retry_properties.user_id is None
    assert retry_properties.cluster_id is None
    assert retry_properties.headers == {
        "x-correlation-id": "corr-1",
        "custom": "kept",
        rabbitmq_consumer.AGENT_RUNTIME_ATTEMPT_HEADER: 1,
    }


def test_configure_channel_declares_durable_retry_queue_back_to_original_queue():
    channel = FakeChannel()
    bindings = (
        rabbitmq_consumer.BoundaryBinding(
            boundary_name="test_boundary",
            source_event="event.same",
            queue_name="lcsp.agent_runtime.test.test_boundary",
            retry_delays_seconds=(30,),
        ),
    )

    rabbitmq_consumer._configure_channel(
        connection=FakeConnection(),
        channel=channel,
        executor=ImmediateExecutor(),
        exchange="lcsp.events",
        bindings=bindings,
        prefetch_count=1,
        requeue_on_error=True,
        requeue_delay_seconds=2,
        fallback_max_redeliveries=3,
    )

    assert channel.confirmed is True
    assert {
        "queue": "lcsp.agent_runtime.test.test_boundary.retry.30000ms",
        "durable": True,
        "arguments": {
            "x-message-ttl": 30000,
            "x-dead-letter-exchange": "",
            "x-dead-letter-routing-key": "lcsp.agent_runtime.test.test_boundary",
        },
    } in channel.declared
    assert all(
        not declaration.get("queue", "").startswith("lcsp.mda.boundary.")
        for declaration in channel.declared
    )
    assert channel.bound == [
        {
            "exchange": "lcsp.events",
            "queue": "lcsp.agent_runtime.test.test_boundary",
            "routing_key": "event.same",
        }
    ]


def test_configure_channel_uses_bounded_fallback_for_empty_retry_schedule():
    channel = FakeChannel()
    bindings = (
        rabbitmq_consumer.BoundaryBinding(
            boundary_name="default_boundary",
            source_event="event.default",
            queue_name="lcsp.agent_runtime.test.default_boundary",
            retry_delays_seconds=(),
        ),
    )

    rabbitmq_consumer._configure_channel(
        connection=FakeConnection(),
        channel=channel,
        executor=ImmediateExecutor(),
        exchange="lcsp.events",
        bindings=bindings,
        prefetch_count=1,
        requeue_on_error=True,
        requeue_delay_seconds=2,
        fallback_max_redeliveries=2,
    )

    retry_declarations = [
        declaration for declaration in channel.declared
        if declaration.get("queue", "").endswith(".retry.2000ms")
    ]
    assert retry_declarations == [
        {
            "queue": "lcsp.agent_runtime.test.default_boundary.retry.2000ms",
            "durable": True,
            "arguments": {
                "x-message-ttl": 2000,
                "x-dead-letter-exchange": "",
                "x-dead-letter-routing-key": "lcsp.agent_runtime.test.default_boundary",
            },
        }
    ]


def test_legacy_mda_cleanup_deletes_only_known_retired_queues():
    channel = FakeChannel()
    bindings = (
        rabbitmq_consumer.BoundaryBinding(
            boundary_name="scan_requested",
            source_event="command.scan.requested.v1",
            queue_name="lcsp.agent_runtime.test.scan_requested",
            retry_delays_seconds=(2,),
        ),
    )

    rabbitmq_consumer._cleanup_legacy_mda_topology(
        channel=channel,
        bindings=bindings,
        requeue_delay_seconds=2,
        fallback_max_redeliveries=1,
    )

    deleted_queues = {item["queue"] for item in channel.deleted}
    assert "lcsp.mda.boundary.scan_requested" in deleted_queues
    assert "lcsp.mda.boundary.scan_requested.retry.2000ms" in deleted_queues
    assert all(name.startswith("lcsp.mda.boundary.") for name in deleted_queues)


def test_retry_attempt_header_increments_and_exhaustion_stops_requeue():
    channel = FakeChannel()
    properties = SimpleNamespace(
        headers={rabbitmq_consumer.AGENT_RUNTIME_ATTEMPT_HEADER: 1},
        correlation_id="corr-2",
    )
    completed = Future()
    completed.set_exception(RuntimeError("retryable"))

    rabbitmq_consumer._settle_delivery(
        channel=channel,
        delivery_tag="delivery-2",
        routing_key="event.test",
        queue_name="lcsp.agent_runtime.test.test_boundary",
        boundary_name="test_boundary",
        properties=properties,
        body=b"{}",
        requeue_on_error=True,
        retry_delays_seconds=(30, 120),
        completed=completed,
    )

    assert channel.acked == ["delivery-2"]
    assert channel.nacked == []
    assert channel.published[0]["routing_key"] == "lcsp.agent_runtime.test.test_boundary.retry.120000ms"
    assert channel.published[0]["properties"].headers[rabbitmq_consumer.AGENT_RUNTIME_ATTEMPT_HEADER] == 2

    exhausted = FakeChannel()
    rabbitmq_consumer._settle_delivery(
        channel=exhausted,
        delivery_tag="delivery-3",
        routing_key="event.test",
        queue_name="lcsp.agent_runtime.test.test_boundary",
        boundary_name="test_boundary",
        properties=SimpleNamespace(headers={rabbitmq_consumer.AGENT_RUNTIME_ATTEMPT_HEADER: 2}),
        body=b"{}",
        requeue_on_error=True,
        retry_delays_seconds=(30, 120),
        completed=completed,
    )
    assert exhausted.published == []
    assert exhausted.nacked == [("delivery-3", False)]


def test_retry_publish_not_confirmed_keeps_original_delivery_requeued():
    channel = FakeChannel()
    channel.publish_result = False
    completed = Future()
    completed.set_exception(RuntimeError("retryable"))

    rabbitmq_consumer._settle_delivery(
        channel=channel,
        delivery_tag="delivery-4",
        routing_key="event.test",
        queue_name="lcsp.agent_runtime.test.test_boundary",
        boundary_name="test_boundary",
        properties=SimpleNamespace(headers={}, correlation_id="corr-4"),
        body=b"{}",
        requeue_on_error=True,
        retry_delays_seconds=(30,),
        completed=completed,
    )

    assert channel.acked == []
    assert channel.nacked == [("delivery-4", True)]
    assert len(channel.published) == 1

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
    [(409, False), (404, False), (422, False), (None, False)],
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


def test_missing_scan_job_claim_is_classified_as_stale_delivery(monkeypatch):
    from tools.common.capabilities.platform.api_client import WorkerCallbackError

    class MissingWorkerClient:
        def claim_scan_job(self, scan_job_id, payload):
            assert scan_job_id == "scan-deleted"
            assert payload["boundary_name"] == "scan_requested"
            raise WorkerCallbackError(
                "SCAN_JOB_NOT_FOUND: Callback failed with client error 404.",
                status_code=404,
                error_code="SCAN_JOB_NOT_FOUND",
            )

    monkeypatch.setattr(
        rabbitmq_consumer,
        "_worker_client_or_none",
        lambda: MissingWorkerClient(),
    )

    with pytest.raises(rabbitmq_consumer.StaleScanDelivery) as raised:
        rabbitmq_consumer._claim_scan_delivery(
            "scan_requested",
            {"scanJobId": "scan-deleted"},
            1800,
        )

    assert raised.value.scan_job_id == "scan-deleted"


@pytest.mark.parametrize("delivery_error", [rabbitmq_consumer.StaleScanDelivery, rabbitmq_consumer.TerminalScanDelivery])
def test_stale_scan_delivery_is_acked_without_retry_or_terminal_failure(monkeypatch, delivery_error):
    failures = []

    class FakeWorkerClient:
        def post_scan_terminal_failure(self, scan_job_id, payload):
            failures.append((scan_job_id, payload))

    monkeypatch.setattr(
        rabbitmq_consumer,
        "_worker_client_or_none",
        lambda: FakeWorkerClient(),
    )
    channel = FakeChannel()
    completed: Future[None] = Future()
    completed.set_exception(delivery_error("scan-deleted"))

    rabbitmq_consumer._settle_delivery(
        channel=channel,
        delivery_tag="delivery-stale",
        routing_key="command.scan.requested.v1",
        queue_name="lcsp.agent_runtime.test.scan_requested",
        boundary_name="scan_requested",
        properties=SimpleNamespace(
            headers={"x-correlation-id": "corr-stale"},
            correlation_id="corr-stale",
        ),
        body=json.dumps({"scanJobId": "scan-deleted"}).encode("utf-8"),
        requeue_on_error=True,
        retry_delays_seconds=(2, 10, 30),
        completed=completed,
    )

    assert channel.acked == ["delivery-stale"]
    assert channel.nacked == []
    assert channel.published == []
    assert failures == []


@pytest.mark.parametrize("status", [401, 403])
def test_typed_auth_failure_escaping_every_route_is_not_requeued(status):
    # Inside the model stack a typed auth error rotates credentials/providers. If one
    # still reaches the boundary, redelivery would only resend a rejected credential.
    from google.genai.errors import ClientError
    from langchain_google_genai.chat_models import (
        GoogleAuthenticationError,
        GooglePermissionDeniedError,
    )

    error_type = GoogleAuthenticationError if status == 401 else GooglePermissionDeniedError
    error = error_type("credential rejected")
    error.__cause__ = ClientError(status, {"error": {"code": status, "message": "rejected"}})
    channel = FakeChannel()
    completed = Future()
    completed.set_exception(error)

    rabbitmq_consumer._settle_delivery(
        channel=channel, delivery_tag="auth-task", routing_key="command.test",
        boundary_name="test_boundary", requeue_on_error=True, completed=completed,
    )

    assert channel.nacked == [("auth-task", False)]
