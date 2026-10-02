from __future__ import annotations

import threading
import time

from orchestration.agent_stream import AgentStreamInterrupted
from tools.common.capabilities.agent_runtime import local_server


class _FakeSnapshot:
    def __init__(self, values: dict, next_nodes: tuple[str, ...] = ()) -> None:
        self.values = values
        self.next = next_nodes


class FakeGraph:
    """Minimal stand-in for a compiled LangGraph graph in ``.stream``/``.get_state`` mode."""

    def __init__(self, *, chunks: list[dict], pending_next: tuple[str, ...] = ()) -> None:
        self.chunks = chunks
        self.pending_next = pending_next
        self.stream_calls: list[tuple[object, dict]] = []

    def stream(self, graph_input, *, config, context=None, stream_mode="values"):
        self.stream_calls.append((graph_input, dict(config)))
        for chunk in self.chunks:
            yield chunk

    def get_state(self, config):
        last = self.chunks[-1] if self.chunks else {}
        return _FakeSnapshot(dict(last), self.pending_next)


def _runtime_with_graph(graph: FakeGraph) -> local_server.LocalAgentRuntime:
    runtime = local_server.LocalAgentRuntime()
    runtime.graph = graph
    return runtime


def test_run_graph_returns_last_streamed_chunk_when_not_interrupted() -> None:
    graph = FakeGraph(chunks=[{"messages": [1]}, {"messages": [1, 2]}])
    runtime = _runtime_with_graph(graph)

    result, interrupted = runtime._run_graph(
        "thread-1", {"input": {"messages": []}}, cancel_event=None
    )

    assert result == {"messages": [1, 2]}
    assert interrupted is False


def test_run_graph_stops_early_and_reports_interrupted_when_cancel_event_is_set() -> None:
    graph = FakeGraph(chunks=[{"step": 1}, {"step": 2}, {"step": 3}])
    runtime = _runtime_with_graph(graph)
    cancel_event = threading.Event()
    cancel_event.set()

    result, interrupted = runtime._run_graph(
        "thread-1", {"input": {"messages": []}}, cancel_event=cancel_event
    )

    # Cancellation is checked after the first yielded chunk (the first completed
    # superstep), so the run stops there instead of running to completion.
    assert result == {"step": 1}
    assert interrupted is True


def test_run_graph_resumes_from_checkpoint_when_input_is_none_and_work_is_pending() -> None:
    graph = FakeGraph(chunks=[{"step": "resumed"}], pending_next=("next_node",))
    runtime = _runtime_with_graph(graph)

    result, interrupted = runtime._run_graph(
        "thread-1", {"input": None}, cancel_event=None
    )

    assert interrupted is False
    assert result == {"step": "resumed"}
    # No new input was passed through: the graph resumes purely from its checkpoint.
    graph_input, _config = graph.stream_calls[0]
    assert graph_input is None


def test_run_graph_treats_input_none_as_noop_when_nothing_is_pending() -> None:
    graph = FakeGraph(chunks=[{"step": "noop"}], pending_next=())
    runtime = _runtime_with_graph(graph)

    runtime._run_graph("thread-1", {"input": None}, cancel_event=None)

    graph_input, _config = graph.stream_calls[0]
    assert graph_input == {}


def test_run_graph_treats_agent_stream_interrupted_from_a_nested_call_as_cancelled() -> None:
    """A nested invoke_with_stream call (inside a boundary handler) that observes
    the ambient cancel signal raises AgentStreamInterrupted; _run_graph must treat
    that the same as its own outer cancel_event check, not as a genuine failure."""

    class InterruptingGraph(FakeGraph):
        def stream(self, graph_input, *, config, context=None, stream_mode="values"):
            yield {"step": 1}
            raise AgentStreamInterrupted("nested boundary call was cancelled")

    runtime = _runtime_with_graph(InterruptingGraph(chunks=[]))
    cancel_event = threading.Event()

    result, interrupted = runtime._run_graph(
        "thread-1", {"input": {"messages": []}}, cancel_event=cancel_event
    )

    assert result == {"step": 1}
    assert interrupted is True


def test_list_runs_returns_only_matching_thread_newest_first() -> None:
    runtime = local_server.LocalAgentRuntime()
    runtime._runs[("thread-a", "run-1")] = {
        "run_id": "run-1",
        "thread_id": "thread-a",
        "created_at": "2026-01-01T00:00:00+00:00",
    }
    runtime._runs[("thread-a", "run-2")] = {
        "run_id": "run-2",
        "thread_id": "thread-a",
        "created_at": "2026-01-02T00:00:00+00:00",
    }
    runtime._runs[("thread-b", "run-3")] = {
        "run_id": "run-3",
        "thread_id": "thread-b",
        "created_at": "2026-01-03T00:00:00+00:00",
    }

    runs = runtime.list_runs("thread-a")

    assert [run["run_id"] for run in runs] == ["run-2", "run-1"]


def test_cancel_run_sets_cancel_event_when_run_already_started() -> None:
    runtime = local_server.LocalAgentRuntime()
    key = ("thread-1", "run-1")
    runtime._runs[key] = {"run_id": "run-1", "thread_id": "thread-1", "status": "running"}
    cancel_event = threading.Event()
    runtime._cancel_events[key] = cancel_event

    class AlreadyStartedFuture:
        def cancel(self) -> bool:
            return False

    runtime._run_futures[key] = AlreadyStartedFuture()  # type: ignore[assignment]

    run = runtime.cancel_run("thread-1", "run-1")

    assert cancel_event.is_set()
    assert run is not None
    assert run["cancel_requested_at"] is not None
    # Status transition to "interrupted" happens once _execute_run observes the
    # event and stops iterating, not synchronously inside cancel_run.
    assert run["status"] == "running"


def test_cancel_run_marks_not_yet_started_run_interrupted_immediately() -> None:
    runtime = local_server.LocalAgentRuntime()
    key = ("thread-1", "run-1")
    runtime._runs[key] = {"run_id": "run-1", "thread_id": "thread-1", "status": "pending"}
    runtime._cancel_events[key] = threading.Event()

    class NotYetStartedFuture:
        def cancel(self) -> bool:
            return True

    runtime._run_futures[key] = NotYetStartedFuture()  # type: ignore[assignment]

    run = runtime.cancel_run("thread-1", "run-1")

    assert run is not None
    assert run["status"] == "interrupted"


def test_execute_run_end_to_end_marks_interrupted_status_after_cancel() -> None:
    """A run cancelled mid-stream settles as status="interrupted", not "success"."""
    release = threading.Event()
    started = threading.Event()

    class BlockingGraph(FakeGraph):
        def stream(self, graph_input, *, config, context=None, stream_mode="values"):
            yield {"step": 1}
            started.set()
            release.wait(timeout=5)
            yield {"step": 2}

    runtime = _runtime_with_graph(BlockingGraph(chunks=[]))
    run = runtime.create_run("thread-1", {"input": {"messages": []}})
    run_id = run["run_id"]

    assert started.wait(timeout=5)
    runtime.cancel_run("thread-1", run_id)
    release.set()

    deadline = time.monotonic() + 5
    status = None
    while time.monotonic() < deadline:
        status = runtime.get_run("thread-1", run_id)["status"]
        if status in {"interrupted", "success", "error"}:
            break
        time.sleep(0.02)

    assert status == "interrupted"
    runtime.close()
