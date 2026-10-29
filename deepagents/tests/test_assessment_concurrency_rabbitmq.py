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
            channel.exchange_delete(exchange=prefix)
            connection.close()
