from __future__ import annotations

from types import SimpleNamespace
import os
from uuid import uuid4

import pytest
from langgraph.store.memory import InMemoryStore

from tools.common.capabilities.agent_runtime.local_server import LocalAgentRuntime, RUN_NAMESPACE


class RecordingGraph:
    def __init__(self, *, checkpoint_run_id=None, pending=True):
        self.metadata = {"lcsp_runtime_run_id": checkpoint_run_id}
        self.pending = pending
        self.calls = []

    def get_state(self, config):
        return SimpleNamespace(values={"done": True}, next=("work",) if self.pending else (), metadata=self.metadata)

    def stream(self, graph_input, *, config, context, stream_mode):
        self.calls.append((graph_input, config, context))
        self.pending = False
        yield {"done": True}


def saved_run(store, *, status="running", payload=None, cancel=False):
    thread, run = str(uuid4()), str(uuid4())
    record = {"run_id": run, "thread_id": thread, "status": status, "metadata": {}, "created_at": "2026-10-10T00:00:00Z"}
    if cancel:
        record["cancel_requested_at"] = "2026-10-10T00:00:01Z"
    store.put((RUN_NAMESPACE, thread), run, {"run": record, "payload": payload})
    return thread, run


@pytest.mark.parametrize("status,checkpoint_is_current,expected_input", [
    ("pending", False, {"messages": ["start"]}),
    ("running", True, None),
    ("running", False, {"messages": ["start"]}),
])
def test_restart_restores_same_run_and_context_without_repeating_checkpointed_input(status, checkpoint_is_current, expected_input):
    store = InMemoryStore()
    thread, run = saved_run(store, status=status, payload={"input": {"messages": ["start"]}, "context": {"assessment_id": "synthetic"}})
    runtime = LocalAgentRuntime(store=store)
    runtime.graph = graph = RecordingGraph(checkpoint_run_id=run if checkpoint_is_current else "previous-run")
    try:
        runtime._restore_runs()
        runtime._run_futures[(thread, run)].result(timeout=5)
        assert runtime.get_run(thread, run)["status"] == "success"
        assert graph.calls[0][0] == expected_input
        assert graph.calls[0][1]["metadata"]["lcsp_runtime_run_id"] == run
        assert graph.calls[0][2]["logical_run_id"] == run
        assert graph.calls[0][2]["assessment_id"] == "synthetic"
        assert store.get((RUN_NAMESPACE, thread), run).value["payload"] is None
    finally:
        runtime.close()


def test_completed_run_is_restored_for_polling_and_never_reexecuted():
    store = InMemoryStore()
    thread, run = saved_run(store, status="success")
    runtime = LocalAgentRuntime(store=store)
    runtime.graph = graph = RecordingGraph()
    try:
        runtime._restore_runs()
        assert runtime.get_run(thread, run)["status"] == "success"
        assert not runtime._run_futures
        assert graph.calls == []
    finally:
        runtime.close()


def test_another_server_completed_the_durable_run_before_this_worker_acquired_its_lock():
    store = InMemoryStore()
    thread, run = saved_run(store, status="success")
    runtime = LocalAgentRuntime(store=store)
    runtime.graph = graph = RecordingGraph()
    try:
        runtime._execute_run(thread, run, {"input": {"messages": ["duplicate"]}})
        assert runtime.get_run(thread, run)["status"] == "success"
        assert graph.calls == []
    finally:
        runtime.close()


def test_restart_preserves_cancel_request_instead_of_resuming_work():
    store = InMemoryStore()
    thread, run = saved_run(store, cancel=True, payload={"input": {"messages": ["start"]}})
    runtime = LocalAgentRuntime(store=store)
    runtime.graph = RecordingGraph(checkpoint_run_id=run)
    try:
        runtime._restore_runs()
        runtime._run_futures[(thread, run)].result(timeout=5)
        assert runtime._cancel_events[(thread, run)].is_set()
        assert runtime.get_run(thread, run)["status"] == "interrupted"
    finally:
        runtime.close()


def test_run_request_is_durable_before_executor_submission():
    store = InMemoryStore()
    runtime = LocalAgentRuntime(store=store)

    class Executor:
        def submit(self, context_run, target, thread, run, payload):
            assert store.get((RUN_NAMESPACE, thread), run).value["payload"] == payload
            from concurrent.futures import Future
            return Future()

        def shutdown(self, **kwargs):
            pass

    runtime._executor.shutdown()
    runtime._executor = Executor()
    runtime.create_run("synthetic-thread", {"input": {"messages": ["start"]}})
    runtime.close()


def test_restored_system_event_waits_for_authoritative_api_without_blocking_server_start(monkeypatch):
    from tools.common.capabilities.agent_runtime import rabbitmq_consumer
    observed = []
    monkeypatch.setattr(rabbitmq_consumer, "_wait_for_api_ready", lambda **kwargs: observed.append(kwargs))
    store = InMemoryStore()
    thread, run = saved_run(store, payload={"input": {}, "context": {"system_boundary_name": "assessment_root_requested"}})
    runtime = LocalAgentRuntime(store=store)
    runtime.graph = RecordingGraph(checkpoint_run_id=run)
    try:
        runtime._restore_runs()
        runtime._run_futures[(thread, run)].result(timeout=5)
        assert observed[0]["stopping"] is runtime._cancel_events[(thread, run)]
        assert observed[0]["timeout_seconds"] == float("inf")
        assert runtime.get_run(thread, run)["status"] == "success"
    finally:
        runtime.close()


def test_failed_persistence_does_not_publish_or_block_a_thread(monkeypatch):
    store = InMemoryStore()
    runtime = LocalAgentRuntime(store=store)
    original = runtime._save_run
    def unavailable(key):
        raise RuntimeError("store unavailable")
    monkeypatch.setattr(runtime, "_save_run", unavailable)
    try:
        with pytest.raises(RuntimeError, match="store unavailable"):
            runtime.create_run("synthetic-thread", {"input": {}, "multitask_strategy": "reject"})
        assert runtime.list_runs("synthetic-thread") == []
        assert not runtime._run_futures and not runtime._run_payloads
        monkeypatch.setattr(runtime, "_save_run", original)
        runtime.graph = RecordingGraph()
        run = runtime.create_run("synthetic-thread", {"input": {}, "multitask_strategy": "reject"})
        runtime._run_futures[("synthetic-thread", run["run_id"])].result(timeout=5)
        assert runtime.get_run("synthetic-thread", run["run_id"])["status"] == "success"
    finally:
        runtime.close()


def test_postgres_reconnection_preserves_run_and_checkpoint_and_erases_only_owned_records(monkeypatch):
    url = os.environ.get("LCSP_RUNTIME_RECOVERY_TEST_DATABASE_URL")
    if not url:
        pytest.skip("explicit owned disposable PostgreSQL target required")
    from langgraph.checkpoint.postgres import PostgresSaver
    from langgraph.graph import START, END, StateGraph
    from langgraph.store.postgres import PostgresStore
    from tools.common.capabilities.platform.docker_sandbox import DockerSandboxManager
    from tools.common.capabilities.platform import logging_path

    thread, run = str(uuid4()), str(uuid4())
    calls = []
    builder = StateGraph(dict)
    builder.add_node("inspect", lambda state: (calls.append("inspect"), state)[1])
    builder.add_node("finish", lambda state: (calls.append("finish"), state)[1])
    builder.add_edge(START, "inspect")
    builder.add_edge("inspect", "finish")
    builder.add_edge("finish", END)
    with PostgresSaver.from_conn_string(url) as saver, PostgresStore.from_conn_string(url) as store:
        saver.setup(); store.setup()
        graph = builder.compile(checkpointer=saver, interrupt_before=["finish"])
        graph.invoke({"accepted": "synthetic"}, {"configurable": {"thread_id": thread}, "metadata": {"lcsp_runtime_run_id": run}})
        record = {"run_id": run, "thread_id": thread, "status": "running", "metadata": {}, "created_at": "2026-10-10T00:00:00Z"}
        store.put((RUN_NAMESPACE, thread), run, {"run": record, "payload": {"input": {"accepted": "synthetic"}, "context": {}}})
        from assessment_root.learning import promote_reviewed_heuristic
        from tests.test_assessment_learning import PROPOSAL, REVIEW_KEY, signature
        heuristic = promote_reviewed_heuristic(store, PROPOSAL, signature(PROPOSAL), REVIEW_KEY)
    # New native PostgreSQL connections, as after a process restart.
    with PostgresSaver.from_conn_string(url) as saver, PostgresStore.from_conn_string(url) as store:
        runtime = LocalAgentRuntime(store=store)
        runtime.graph = builder.compile(checkpointer=saver)
        runtime._checkpointer = saver
        runtime._database_url = url
        try:
            from assessment_root.learning import retrieve_heuristics
            assert retrieve_heuristics(store, "coverage")[0]["heuristicId"] == heuristic
            runtime._restore_runs()
            runtime._run_futures[(thread, run)].result(timeout=10)
            assert calls == ["inspect", "finish"]
            assert runtime.get_run(thread, run)["status"] == "success"
            assert runtime.graph.get_state({"configurable": {"thread_id": thread}}).values == {"accepted": "synthetic"}
            other = saved_run(store, status="success")
            # The real PostgreSQL lock fences a second server and releases after ownership ends.
            with runtime._database_thread_lock(thread):
                with pytest.raises(RuntimeError, match="has not drained"):
                    with runtime._database_thread_lock(thread, blocking=False):
                        pass
            with runtime._database_thread_lock(thread, blocking=False):
                pass
            monkeypatch.setattr(DockerSandboxManager, "erase", lambda *_: None)
            monkeypatch.setattr(logging_path, "erase_assessment_logs", lambda *_: None)
            runtime.erase_assessment("synthetic-owned", "synthetic-owner", thread)
            assert not list(saver.list({"configurable": {"thread_id": thread}}))
            assert store.get((RUN_NAMESPACE, thread), run) is None
            assert store.get((RUN_NAMESPACE, other[0]), other[1]) is not None
            assert retrieve_heuristics(store, "coverage")[0]["heuristicId"] == heuristic
        finally:
            runtime.close()
