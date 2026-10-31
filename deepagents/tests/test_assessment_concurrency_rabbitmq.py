"""Provider-free RabbitMQ 4 integration through the actual consumer/executor."""

import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from uuid import uuid4

import pika
import pytest

from tools.common.capabilities.agent_runtime import rabbitmq_consumer as bridge

URL = os.getenv("LCSP_TEST_RABBITMQ_URL")
pytestmark = pytest.mark.skipif(not URL, reason="requires disposable LCSP_TEST_RABBITMQ_URL")


def pump(connection, predicate, timeout=8):
    deadline = time.monotonic() + timeout
    while not predicate() and time.monotonic() < deadline:
        connection.process_data_events(time_limit=0.05)
    assert predicate(), "real broker did not reach the expected execution/settlement state"


@pytest.mark.skipif(not os.getenv("LCSP_TEST_CAPACITY_BACKLOG_RESERVATION"), reason="requires real PostgreSQL/API backlog fixture")
def test_large_postgres_backlog_delivery_preserves_durable_retry(monkeypatch):
    """Exercise PG -> API -> Agent Server -> SDK -> broker settlement; execute no native Root."""
    import socket
    from types import SimpleNamespace
    from urllib.parse import urlsplit

    import uvicorn
    from tools.common.capabilities.agent_runtime import local_server
    from tools.common.capabilities.agent_runtime.root_capacity import RootCapacityClient

    assert urlsplit(os.environ["NESTJS_API_BASE_URL"]).hostname in {"localhost", "127.0.0.1"}
    assert urlsplit(URL).hostname in {"localhost", "127.0.0.1"} and urlsplit(URL).port == 5678
    monkeypatch.setenv("RABBITMQ_URL", URL)
    monkeypatch.setenv("LCSP_ROOT_CAPACITY_RABBITMQ_MANAGEMENT_URL", "")
    reservation = json.loads(os.environ["LCSP_TEST_CAPACITY_BACKLOG_RESERVATION"])
    capacity = RootCapacityClient()
    capacity.identity = {key: reservation[key] for key in ("hostId", "incarnationId")}
    decisions, call = [], capacity.call

    def observe_admission(action, **payload):
        result = call(action, **payload)
        if action == "reserve":
            decisions.append((payload["commandKey"], result))
        return result

    monkeypatch.setattr(capacity, "call", observe_admission)
    runtime = local_server.LocalAgentRuntime(capacity_client=capacity)
    graph_calls = []

    class NoExecutionGraph:
        def get_state(self, *_args, **_kwargs):
            return SimpleNamespace(values={}, next=(), tasks=(), metadata={}, created_at=None)

        def stream(self, *_args, **_kwargs):
            graph_calls.append(1)
            raise AssertionError("out-of-order/obsolete commands must execute no Root or provider")

    runtime.graph = NoExecutionGraph()
    monkeypatch.setattr(local_server.app.state, "runtime", runtime, raising=False)
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    server = uvicorn.Server(uvicorn.Config(local_server.app, lifespan="off", log_level="warning"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
    thread.start()
    monkeypatch.setenv("LCSP_AGENT_SERVER_URL", f"http://127.0.0.1:{listener.getsockname()[1]}")
    prefix = f"lcsp364.backlog.{uuid4().hex}"
    binding = bridge.BoundaryBinding("assessment_root_requested", prefix, prefix)
    try:
        deadline = time.monotonic() + 5
        while not server.started and time.monotonic() < deadline:
            time.sleep(.01)
        assert server.started
        connection = pika.BlockingConnection(pika.URLParameters(URL))
        try:
            channel = connection.channel()
            acks, timeline = [], []
            owner = threading.get_ident()
            ack, publish_retry = channel.basic_ack, bridge._publish_retry_delivery

            def confirmed_retry(**kwargs):
                confirmed = publish_retry(**kwargs)
                if confirmed:
                    timeline.append("retry-confirmed")
                return confirmed

            def record_ack(delivery_tag):
                assert threading.get_ident() == owner
                acks.append(delivery_tag)
                timeline.append("ack")
                ack(delivery_tag=delivery_tag)

            monkeypatch.setattr(bridge, "_publish_retry_delivery", confirmed_retry)
            monkeypatch.setattr(channel, "basic_ack", record_ack)
            with bridge.BoundedBoundaryExecutor(max_workers=1) as executor:
                bridge._configure_channel(connection=connection, channel=channel, executor=executor,
                    exchange=prefix, bindings=(binding,), prefetch_count=1, worker_count=1,
                    requeue_on_error=True, requeue_delay_seconds=2, fallback_max_redeliveries=0)
                try:
                    for command_key in [reservation["commandKey"], "superseded-command"]:
                        channel.basic_publish(exchange=prefix, routing_key=prefix,
                            body=json.dumps({"assessmentId": reservation["assessmentId"], "idempotencyKey": command_key}).encode(),
                            properties=pika.BasicProperties(delivery_mode=2,
                                headers={bridge.AGENT_RUNTIME_ATTEMPT_HEADER: 3}))
                    pump(connection, lambda: len(acks) == 2, timeout=15)
                    channel.stop_consuming()
                    retry_queue = bridge._retry_queue_name(prefix, 15)
                    # The confirmed copy may already have passed its TTL back to the original queue.
                    ready = sum(channel.queue_declare(queue=q, passive=True).method.message_count for q in [prefix, retry_queue])
                    assert ready == 1
                    method, properties, body = channel.basic_get(retry_queue, auto_ack=False)
                    if method is None:
                        method, properties, body = channel.basic_get(prefix, auto_ack=False)
                    assert json.loads(body)["idempotencyKey"] == reservation["commandKey"]
                    assert properties.delivery_mode == 2
                    assert properties.headers[bridge.AGENT_RUNTIME_ATTEMPT_HEADER] == 3
                    assert timeline == ["retry-confirmed", "ack", "ack"]
                    assert len(set(acks)) == 2 and not graph_calls and not runtime._run_futures
                    valid = [decision for key, decision in decisions if key == reservation["commandKey"]]
                    assert len(valid) == 1 and valid[0]["admitted"] is False and not valid[0].get("obsolete")
                    ack(delivery_tag=method.delivery_tag)
                    print(json.dumps({"gate": "LCSP364_BACKLOG_BROKER_PASS", "originalAcks": len(acks),
                        "durableRetryCopies": ready, "attempt": 3, "nativeExecutions": len(graph_calls)}))
                finally:
                    channel.stop_consuming()
                    channel.queue_delete(queue=prefix)
                    for delay in [2, 15]:
                        channel.queue_delete(queue=bridge._retry_queue_name(prefix, delay))
                    channel.exchange_delete(exchange=prefix)
        finally:
            connection.close()
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        listener.close()
        runtime.close()
        assert not thread.is_alive()


@pytest.mark.parametrize("workers", [1, 2])
def test_real_broker_credit_overlap_backpressure_and_settlement(monkeypatch, workers):
    prefix = f"lcsp346.test.{uuid4().hex}"
    binding = bridge.BoundaryBinding("assessment_root_requested", prefix, prefix)
    started, ended = {}, {}
    releases = {key: threading.Event() for key in ["A", "B", "C"]}
    active = maximum = 0
    lock = threading.Lock()

    def dispatch(_boundary, message, _correlation, **_kwargs):
        nonlocal active, maximum
        key = message["assessmentId"]
        with lock:
            active += 1
            maximum = max(maximum, active)
            started[key] = time.monotonic()
        try:
            assert releases[key].wait(12)
        finally:
            with lock:
                ended[key] = time.monotonic()
                active -= 1

    monkeypatch.setattr(bridge, "dispatch_agent_runtime_event", dispatch)
    connection = pika.BlockingConnection(pika.URLParameters(URL))
    channel = connection.channel()
    acks, owner = [], threading.get_ident()
    ack = channel.basic_ack

    def record_ack(delivery_tag):
        assert threading.get_ident() == owner
        acks.append(delivery_tag)
        ack(delivery_tag=delivery_tag)

    monkeypatch.setattr(channel, "basic_ack", record_ack)
    with bridge.BoundedBoundaryExecutor(max_workers=workers) as executor:
        try:
            bridge._configure_channel(
                connection=connection, channel=channel, executor=executor,
                exchange=prefix, bindings=(binding,), prefetch_count=8, worker_count=workers,
                requeue_on_error=True, requeue_delay_seconds=2, fallback_max_redeliveries=0,
            )
            for key in releases:
                channel.basic_publish(exchange=prefix, routing_key=prefix,
                                      body=json.dumps({"assessmentId": key}).encode())
            pump(connection, lambda: len(started) == workers)
            assert acks == []
            assert channel.queue_declare(queue=prefix, passive=True).method.message_count == 3 - workers
            assert "C" not in started
            if workers == 2:
                releases["B"].set()
                pump(connection, lambda: "C" in started)
                assert "A" not in ended
                assert started["B"] < ended["B"] < started["C"]
                assert len(acks) == 1
            for event in releases.values():
                event.set()
            pump(connection, lambda: len(acks) == 3)
            assert maximum == workers
            assert len(set(acks)) == 3
            if workers == 2:
                assert max(started["A"], started["B"]) < min(ended["A"], ended["B"])
            else:
                assert ended["A"] <= started["B"] <= ended["B"] <= started["C"]
        finally:
            for event in releases.values():
                event.set()
            channel.stop_consuming()
            channel.queue_delete(queue=prefix)
            channel.queue_delete(queue=bridge._retry_queue_name(prefix, 2))
            channel.queue_delete(queue=bridge._retry_queue_name(prefix, 15))
            channel.exchange_delete(exchange=prefix)
            connection.close()


def test_sigterm_recovers_unacknowledged_delivery_on_the_real_broker(tmp_path):
    prefix = f"lcsp346.signal.{uuid4().hex}"
    started, release = tmp_path / "started", tmp_path / "release"
    script = tmp_path / "consumer.py"
    script.write_text('''
import os, time
from pathlib import Path
from tools.common.capabilities.agent_runtime import rabbitmq_consumer as bridge
prefix, started, release = (os.environ[key] for key in ["TEST_QUEUE", "TEST_STARTED", "TEST_RELEASE"])
bridge.load_runtime_env = lambda: None
bridge._worker_client_or_none = lambda: None
bridge._wait_for_api_ready = lambda **kwargs: None
bridge._reconcile_local_agent_server_stale_runs = lambda **kwargs: None
bridge.boundary_bindings = lambda _: (bridge.BoundaryBinding("assessment_root_requested", prefix, prefix),)
def dispatch(*args, **kwargs):
    Path(started).touch()
    deadline = time.monotonic() + 15
    while not Path(release).exists():
        assert time.monotonic() < deadline
        time.sleep(0.02)
bridge.dispatch_agent_runtime_event = dispatch
bridge.run_consumer()
''')
    connection = pika.BlockingConnection(pika.URLParameters(URL))
    channel = connection.channel()
    channel.exchange_declare(exchange=prefix, exchange_type="topic", durable=True)
    channel.queue_declare(queue=prefix, durable=True)
    channel.queue_bind(queue=prefix, exchange=prefix, routing_key=prefix)
    env = {**os.environ, "PYTHONPATH": str(Path(bridge.__file__).parents[4]),
           "RABBITMQ_URL": URL, "RABBITMQ_EXCHANGE": prefix,
           "LCSP_AGENT_RUNTIME_BOUNDARY_WORKERS": "1", "LCSP_AGENT_RUNTIME_RABBITMQ_PREFETCH": "1",
           "TEST_QUEUE": prefix, "TEST_STARTED": str(started), "TEST_RELEASE": str(release)}
    with (tmp_path / "consumer.log").open("w") as log:
        process = subprocess.Popen([sys.executable, str(script)], env=env, stdout=log, stderr=log)
        try:
            channel.basic_publish(exchange=prefix, routing_key=prefix, body=b'{"assessmentId":"signal-owned"}')
            pump(connection, started.exists)
            process.terminate()  # The real run_consumer SIGTERM handler closes its own channel.
            recovered = []

            def redelivered():
                method, _properties, body = channel.basic_get(queue=prefix, auto_ack=False)
                if method:
                    recovered.append((method, body))
                return bool(recovered)

            pump(connection, redelivered)
            method, body = recovered[0]
            assert method.redelivered
            assert json.loads(body)["assessmentId"] == "signal-owned"
            channel.basic_ack(method.delivery_tag)
            release.touch()
            assert process.wait(timeout=5) == 0
        finally:
            release.touch()
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            channel.queue_delete(queue=prefix)
            channel.queue_delete(queue=bridge._retry_queue_name(prefix, 2))
            channel.queue_delete(queue=bridge._retry_queue_name(prefix, 15))
            channel.exchange_delete(exchange=prefix)
            connection.close()
