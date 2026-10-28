"""LCSP-346: actual overlap, bounded admission and connection-thread settlement."""

import json
import queue
import threading
import time
from contextvars import ContextVar
from types import SimpleNamespace

import pika
import pytest

from test_agent_runtime_rabbitmq_consumer import FakeChannel
from tools.common.capabilities.agent_runtime import rabbitmq_consumer as bridge


class Connection:
    def __init__(self):
        self.callbacks = queue.Queue()
        self.open = True

    def add_callback_threadsafe(self, callback):
        if not self.open:
            raise pika.exceptions.ConnectionWrongStateError()
        self.callbacks.put(callback)

    def drain(self, count=1):
        for _ in range(count):
            self.callbacks.get(timeout=3)()


class Channel(FakeChannel):
    def __init__(self):
        super().__init__()
        self.owner = threading.get_ident()

    def basic_ack(self, delivery_tag):
        assert threading.get_ident() == self.owner
        super().basic_ack(delivery_tag)

    def basic_nack(self, delivery_tag, requeue):
        assert threading.get_ident() == self.owner
        super().basic_nack(delivery_tag, requeue)


def deliver(executor, connection, channel, tag, *, timeout=None, attempt=0):
    handler = bridge._delivery_handler(
        "assessment_root_requested", connection=connection, executor=executor,
        queue_name="lcsp346.root", requeue_on_error=True, timeout_seconds=timeout,
    )
    handler(channel, SimpleNamespace(delivery_tag=tag, routing_key="command.root"),
            SimpleNamespace(headers={bridge.AGENT_RUNTIME_ATTEMPT_HEADER: attempt}),
            json.dumps({"assessmentId": tag, "accountId": f"account-{tag}"}).encode())


@pytest.mark.parametrize("workers", [1, 2])
def test_delivery_overlap_capacity_backpressure_and_out_of_order_settlement(monkeypatch, workers):
    entered = {tag: threading.Event() for tag in ["A", "B", "C"]}
    release = {tag: threading.Event() for tag in entered}
    intervals = {}

    def dispatch(_boundary, message, _correlation, **_kwargs):
        tag = message["assessmentId"]
        assert message["accountId"] == f"account-{tag}"
        intervals[tag] = [time.monotonic(), None]
        entered[tag].set()
        assert release[tag].wait(5)
        intervals[tag][1] = time.monotonic()

    monkeypatch.setattr(bridge, "dispatch_agent_runtime_event", dispatch)
    connection, channel = Connection(), Channel()
    with bridge.BoundedBoundaryExecutor(max_workers=workers) as executor:
        try:
            deliver(executor, connection, channel, "A")
            assert entered["A"].wait(2)
            deliver(executor, connection, channel, "B")
            if workers == 2:
                assert entered["B"].wait(2)
                assert channel.acked == []
                deliver(executor, connection, channel, "C", attempt=2)
                assert not entered["C"].is_set()
                assert channel.published[-1]["properties"].headers[bridge.AGENT_RUNTIME_ATTEMPT_HEADER] == 2
                assert channel.acked == ["C"]  # Confirmed durable deferral, not execution.
                release["B"].set()
                connection.drain()
                assert channel.acked == ["C", "B"]
                assert not release["A"].is_set()
                assert min(intervals["B"][1], time.monotonic()) > max(intervals["A"][0], intervals["B"][0])
            else:
                assert not entered["B"].is_set()
                assert channel.acked == ["B"]
            release["A"].set()
            connection.drain()
            assert channel.acked[-1] == "A"
            # Pending broker work can enter only after an execution slot is released.
            release["C"].set()
            deliver(executor, connection, channel, "C")
            connection.drain()
            assert entered["C"].is_set()
            assert executor._work_queue.qsize() == 0
        finally:
            for event in release.values():
                event.set()


@pytest.mark.parametrize("confirmed", [True, False])
def test_reconnect_and_reused_delivery_tag_cannot_cross_settle_or_grow_work(monkeypatch, confirmed):
    entered, release = threading.Event(), threading.Event()
    calls = []

    def dispatch(_boundary, message, _correlation, **_kwargs):
        calls.append(message["assessmentId"])
        entered.set()
        assert release.wait(5)

    monkeypatch.setattr(bridge, "dispatch_agent_runtime_event", dispatch)
    old_connection, new_connection = Connection(), Connection()
    old_channel, new_channel = Channel(), Channel()
    new_channel.publish_result = confirmed
    with bridge.BoundedBoundaryExecutor(max_workers=1) as executor:
        try:
            deliver(executor, old_connection, old_channel, "1")
            assert entered.wait(2)
            old_connection.open = old_channel.is_open = False
            for _ in range(100):
                deliver(executor, new_connection, new_channel, "1")
            assert calls == ["1"]
            assert executor._work_queue.qsize() == 0
            assert len(new_channel.acked if confirmed else new_channel.nacked) == 100
        finally:
            release.set()
    assert old_channel.acked == []
    assert new_connection.callbacks.empty()
    deliver_executor = bridge.BoundedBoundaryExecutor(max_workers=1)
    try:
        deliver(deliver_executor, new_connection, new_channel, "redelivered")
        new_connection.drain()
        assert calls == ["1", "redelivered"]
        assert new_channel.acked[-1] == "redelivered"
    finally:
        deliver_executor.shutdown()


def test_timeout_does_not_free_a_still_executing_worker_or_double_settle(monkeypatch):
    entered, release = threading.Event(), threading.Event()
    monkeypatch.setattr(bridge, "_notify_boundary_timeout", lambda **kwargs: None)

    def dispatch(*_args, **_kwargs):
        entered.set()
        assert release.wait(5)

    monkeypatch.setattr(bridge, "dispatch_agent_runtime_event", dispatch)
    connection, channel = Connection(), Channel()
    with bridge.BoundedBoundaryExecutor(max_workers=1) as executor:
        try:
            deliver(executor, connection, channel, "A", timeout=0.02)
            assert entered.wait(2)
            connection.drain()
            assert channel.nacked == [("A", False)]
            deliver(executor, connection, channel, "B")
            assert channel.acked == ["B"]
            assert len(channel.published) == 1
        finally:
            release.set()
    assert connection.callbacks.empty()
    assert channel.nacked == [("A", False)]


def test_worker_context_isolated_across_reused_threads_and_failures():
    identity = ContextVar("lcsp346_identity", default=None)
    def work(value):
        assert identity.get() is None
        identity.set(value)
        if value == "failure":
            raise RuntimeError("one assessment failed")
        return identity.get()
    with bridge.BoundedBoundaryExecutor(max_workers=1) as executor:
        assert executor.submit(work, "account-A").result(timeout=2) == "account-A"
        with pytest.raises(RuntimeError, match="one assessment"):
            executor.submit(work, "failure").result(timeout=2)
        assert executor.submit(work, "account-B").result(timeout=2) == "account-B"
    assert identity.get() is None


def test_failed_submission_releases_capacity():
    executor = bridge.BoundedBoundaryExecutor(max_workers=1)
    executor.shutdown()
    for _ in range(2):
        with pytest.raises(RuntimeError, match="cannot schedule"):
            executor.submit(lambda: None)


@pytest.mark.parametrize("raw", ["0", "-1", "65536", "nan", "1.5"])
def test_unbounded_or_invalid_prefetch_is_rejected(monkeypatch, raw):
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_RABBITMQ_PREFETCH", raw)
    with pytest.raises(RuntimeError, match="PREFETCH"):
        bridge._prefetch_count(2)


@pytest.mark.parametrize("raw", ["0", "-1", "65", "nan"])
def test_unsupported_worker_capacity_is_rejected(monkeypatch, raw):
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_BOUNDARY_WORKERS", raw)
    with pytest.raises(RuntimeError, match="BOUNDARY_WORKERS"):
        bridge._executor_worker_count()


@pytest.mark.parametrize("workers,server,expected", [(1, 8, 1), (2, 8, 2), (4, 2, 2)])
def test_server_recovery_cannot_exceed_the_boundary_worker_cap(monkeypatch, workers, server, expected):
    from tools.common.capabilities.agent_runtime.local_server import _run_worker_count

    monkeypatch.setenv("LCSP_AGENT_RUNTIME_BOUNDARY_WORKERS", str(workers))
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_JOBS_PER_WORKER", str(server))
    assert _run_worker_count() == expected


def test_two_native_assessment_roots_overlap_with_separate_threads_and_pins(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from uuid import uuid4

    from deepagents.backends import FilesystemBackend
    from langgraph.checkpoint.memory import InMemorySaver
    from test_assessment_root_agent import FakeClient, RootScriptedModel, complete_root_messages
    from assessment_root.runner import run_assessment_root

    class Client(FakeClient):
        def __init__(self, account):
            super().__init__()
            self.account = account
            self.thread, self.execution, self.snapshot = (str(uuid4()) for _ in range(3))

        def claim(self, assessment):
            return {**super().claim(assessment), "threadId": self.thread, "executionId": self.execution}

        def context(self):
            return {**super().context(), "threadId": self.thread, "repositorySnapshotId": self.snapshot,
                    "repositoryCommit": ("a" if self.account == "A" else "b") * 40}

    class Model(RootScriptedModel):
        started: object
        release: object

        def _generate(self, messages, **kwargs):
            if not self.prompts:
                self.started.set()
                assert self.release.wait(8)
            return super()._generate(messages, **kwargs)

    saver = InMemorySaver()
    release = threading.Event()
    clients = [Client("A"), Client("B")]
    assessments = [str(uuid4()), str(uuid4())]
    started = [threading.Event(), threading.Event()]
    backends = []
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = []
        try:
            for index, client in enumerate(clients):
                root = tmp_path / client.account
                root.mkdir()
                (root / "account.txt").write_text(client.account)
                backend = FilesystemBackend(root_dir=root, virtual_mode=True)
                backends.append(backend)
                futures.append(executor.submit(
                    run_assessment_root, client, assessments[index],
                    backend_factory=lambda *_args, b=backend: (b, None),
                    model=Model(started=started[index], release=release, responses=complete_root_messages()),
                    checkpointer=saver, governance=(),
                ))
            # Both real native Root graphs reach inference before either is released.
            assert all(event.wait(6) for event in started)
        finally:
            release.set()
        results = [future.result(timeout=8) for future in futures]
    assert [result["state"] for result in results] == ["SUCCEEDED", "SUCCEEDED"]
    assert len({result["threadId"] for result in results}) == 2
    assert len({result["executionId"] for result in results}) == 2
    for index, client in enumerate(clients):
        saved = saver.get_tuple({"configurable": {"thread_id": client.thread}})
        assert saved is not None
        assert saved.metadata["assessment_id"] == assessments[index]
        assert saved.metadata["repository_snapshot_id"] == client.snapshot
        assert [value for name, value in client.calls if name == "claim"] == [assessments[index]]
        assert backends[index].read("/account.txt").file_data["content"] == client.account


def test_native_researcher_batch_runs_serially_without_accepting_candidates(tmp_path):
    from langchain_core.messages import AIMessage
    from langchain_core.callbacks import BaseCallbackHandler
    from langgraph.checkpoint.memory import InMemorySaver
    from assessment_root.agent import create_assessment_root_agent
    from assessment_root.researcher import RESEARCHER_NAME
    from test_assessment_root_agent import FakeClient, RootScriptedModel, _run, THREAD, complete_root_messages

    class Tasks(BaseCallbackHandler):
        active = maximum = 0

        def on_tool_start(self, serialized, _input, **_kwargs):
            if (serialized or {}).get("name") == "task":
                self.active += 1
                self.maximum = max(self.maximum, self.active)

        def on_tool_end(self, _output, **_kwargs):
            # Only task tools execute in this fixture before finalization.
            if self.active:
                self.active -= 1

    client = FakeClient()
    run = _run(tmp_path, client)
    model = RootScriptedModel(responses=[
        AIMessage(content="", tool_calls=[
            {"name": "task", "args": {"description": f"Inspect candidate {key}", "subagent_type": RESEARCHER_NAME}, "id": key}
            for key in ["candidate-A", "candidate-B"]
        ]),
        AIMessage(content="candidate-A: src/retention.py:3"),
        AIMessage(content="candidate-B: src/retention.py:3"),
        *complete_root_messages(),
    ])
    tasks = Tasks()
    graph = create_assessment_root_agent(run=run, model=model, governance=(),
                                         checkpointer=InMemorySaver(), graph_tools=[])
    graph.invoke({"messages": [{"role": "user", "content": "Inspect both candidates"}]},
                 config={"configurable": {"thread_id": THREAD}, "callbacks": [tasks]}, durability="sync")
    assert tasks.maximum == 1
    assert client.lifecycle_state == "COMPLETE"
    assert not any(name in {"evidence", "fact", "decision", "human"} for name, _ in client.calls)
