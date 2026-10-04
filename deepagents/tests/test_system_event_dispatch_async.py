from __future__ import annotations

import asyncio
import contextvars
import time
from dataclasses import replace
from threading import Event
from typing import TypedDict

import pytest
from langchain.agents.factory import _get_can_jump_to

import middleware.system_event_dispatch as system_dispatch
from orchestration.agent_stream import active_agent_stream_cancel
from tools.common.capabilities.agent_runtime.boundary import AgentRuntimeBoundaryTimeout
from orchestration.context import LCSPRunContext
from orchestration.runtime_control import active_runtime_run_id

_MARKER = contextvars.ContextVar("marker", default=None)


def test_hook_keeps_node_name_and_jump_to_end() -> None:
    middleware = system_dispatch.dispatch_agent_runtime_system_event

    assert middleware.name == "dispatch_agent_runtime_system_event"
    assert _get_can_jump_to(middleware, "before_agent") == ["end"]


@pytest.mark.asyncio
async def test_async_hook_runs_boundary_off_the_event_loop(monkeypatch) -> None:
    # Regression: the sync hook ran whole boundaries on the Agent Server event
    # loop, so concurrent broker deliveries timed out creating their threads.
    seen: list[object] = []

    def blocking_dispatch(state, runtime):
        seen.append(_MARKER.get())
        time.sleep(0.3)
        return {"jump_to": "end"}

    monkeypatch.setattr(system_dispatch, "_dispatch_system_event", blocking_dispatch)
    ticks = 0

    async def heartbeat() -> None:
        nonlocal ticks
        while True:
            ticks += 1
            await asyncio.sleep(0.01)

    _MARKER.set("request-context")
    beat = asyncio.create_task(heartbeat())
    try:
        result = await system_dispatch.dispatch_agent_runtime_system_event.abefore_agent(
            {}, object()
        )
    finally:
        beat.cancel()

    assert result == {"jump_to": "end"}
    assert ticks >= 10
    assert seen == ["request-context"]


@pytest.mark.asyncio
async def test_cancelled_async_hook_signals_the_underlying_thread(monkeypatch):
    started, stopped = Event(), Event()

    def blocking_dispatch(state, runtime):
        cancel = active_agent_stream_cancel.get()
        started.set()
        assert cancel is not None
        assert cancel.wait(2)
        stopped.set()

    monkeypatch.setattr(system_dispatch, "_dispatch_system_event", blocking_dispatch)
    task = asyncio.create_task(
        system_dispatch.dispatch_agent_runtime_system_event.abefore_agent({}, object())
    )
    assert await asyncio.to_thread(started.wait, 2)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert await asyncio.to_thread(stopped.wait, 2)
    assert active_agent_stream_cancel.get() is None


@pytest.mark.asyncio
@pytest.mark.parametrize("boundary", [
    "assessment_interview_resume_requested",
    "engineering_assessment_requested",
    "targeted_reanalysis_requested",
])
async def test_hosted_native_stop_drains_nested_model_and_resumes_checkpoint(monkeypatch, boundary):
    """Exercise real async LangGraph execution, not the LocalAgentRuntime facade."""
    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.graph import StateGraph, START, END
    from langgraph.runtime import Runtime
    from orchestration.agent_stream import invoke_with_stream

    for key in ("LANGGRAPH_CHECKPOINT_DATABASE_URL", "POSTGRES_URI", "DATABASE_URL"):
        monkeypatch.delenv(key, raising=False)
    reports, calls = [], []
    entered, cancelling, release_cleanup = Event(), Event(), Event()

    def register(thread, run, context, state):
        reports.append((thread, run, context, state))
        return {"state": state}

    monkeypatch.setattr(system_dispatch, "report_runtime_control", register)

    class State(TypedDict):
        count: int

    def prefix(state):
        calls.append("prefix")
        return {"count": state["count"] + 1}

    async def model(state):
        calls.append(("model", active_runtime_run_id.get()))
        if not entered.is_set():
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelling.set()
                # Simulate transport/checkpoint cleanup still owning the thread.
                while not release_cleanup.is_set():
                    await asyncio.sleep(.005)
        return {"count": state["count"] + 1}

    def persist(state):
        calls.append("persist")
        return state

    nested = (StateGraph(State).add_node("prefix", prefix).add_node("model", model)
              .add_node("persist", persist).add_edge(START, "prefix")
              .add_edge("prefix", "model").add_edge("model", "persist")
              .add_edge("persist", END).compile())

    def dispatch(_state, _runtime):
        result = invoke_with_stream(nested, {"count": 0}, agent_name="hosted-stop-test")
        calls.append(("result", result["count"]))
        return {"jump_to": "end"}

    monkeypatch.setattr(system_dispatch, "_dispatch_active_system_event", dispatch)

    async def root_node(state, runtime: Runtime):
        await system_dispatch.dispatch_agent_runtime_system_event.abefore_agent(state, runtime)
        return {"count": 1}

    root = (StateGraph(State, context_schema=LCSPRunContext).add_node("dispatch", root_node)
            .add_edge(START, "dispatch").add_edge("dispatch", END).compile(checkpointer=InMemorySaver()))
    thread_id = f"hosted-{boundary}"
    context = LCSPRunContext(assessment_id="a", thread_id=thread_id,
                             system_boundary_name=boundary, system_event={"original": True})
    config = {"configurable": {"thread_id": thread_id, "run_id": "native-first"}}
    task = asyncio.create_task(root.ainvoke({"count": 0}, config=config, context=context, durability="sync"))
    try:
        assert await asyncio.to_thread(entered.wait, 2)
        assert reports[0][1] == "native-first"
        assert reports[0][2]["logical_run_id"] == "native-first"
        task.cancel()
        assert await asyncio.to_thread(cancelling.wait, 2)
        await asyncio.sleep(.03)
        assert not task.done(), "native interruption must wait for nested cleanup"
        assert "persist" not in calls
        release_cleanup.set()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, 2)
        assert root.get_state(config).next == ("dispatch",)
        assert "persist" not in calls

        # SDK Continue supplies no new input and preserves the original logical
        # run. It must not replay the completed prefix of the nested graph.
        resumed_config = {"configurable": {"thread_id": thread_id, "run_id": "native-second"}}
        await root.ainvoke(None, config=resumed_config,
                          context=replace(context, logical_run_id="native-first"), durability="sync")
        assert reports[-1][1] == "native-second"
        assert reports[-1][2]["logical_run_id"] == "native-first"
        assert calls == ["prefix", ("model", "native-first"), ("model", "native-second"), "persist", ("result", 2)]
    finally:
        release_cleanup.set()
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    assert active_runtime_run_id.get() is None


@pytest.mark.asyncio
async def test_hosted_retry_cannot_reopen_a_stopped_native_generation(monkeypatch):
    from types import SimpleNamespace

    monkeypatch.setattr(system_dispatch, "get_config", lambda: {
        "configurable": {"thread_id": "t", "run_id": "stopped-run"},
    })
    monkeypatch.setattr(system_dispatch, "report_runtime_control", lambda *_: {"state": "STOP_REQUESTED"})
    monkeypatch.setattr(system_dispatch, "_dispatch_system_event", lambda *_: pytest.fail("stopped work cannot restart"))
    with pytest.raises(asyncio.CancelledError):
        await system_dispatch.dispatch_agent_runtime_system_event.abefore_agent({}, SimpleNamespace(
            context=LCSPRunContext(assessment_id="a", system_boundary_name="engineering_assessment_requested", system_event={"original": True})
        ))


def test_boundary_deadline_reaches_sync_thread_without_remote_cancel(monkeypatch):
    def dispatch(state, runtime):
        cancel = active_agent_stream_cancel.get()
        assert cancel is not None
        assert cancel.wait(2)
        system_dispatch.check_agent_execution_active()

    monkeypatch.setattr(system_dispatch, "_dispatch_active_system_event", dispatch)
    from types import SimpleNamespace

    runtime = SimpleNamespace(context=LCSPRunContext(system_deadline_at=time.time() + 0.02))
    with pytest.raises(AgentRuntimeBoundaryTimeout):
        system_dispatch._dispatch_system_event({}, runtime)
    assert active_agent_stream_cancel.get() is None


def test_expired_queued_boundary_reports_timeout_without_starting_work(monkeypatch):
    reports = []
    monkeypatch.setattr(
        system_dispatch, "_dispatch_active_system_event",
        lambda *_args: pytest.fail("expired work must not start"),
    )
    monkeypatch.setattr(
        system_dispatch,
        "report_external_boundary_timeout",
        lambda *args: reports.append(args),
    )
    from types import SimpleNamespace

    result = system_dispatch._dispatch_system_event(
        {},
        SimpleNamespace(
            context=LCSPRunContext(
                system_boundary_name="engineering_assessment_requested",
                system_event={"assessmentId": "assessment-1"},
                correlation_id="corr-1",
                system_deadline_at=time.time() - 1,
            )
        ),
    )
    assert result == {"jump_to": "end"}
    assert reports == [
        (
            "engineering_assessment_requested",
            {"assessmentId": "assessment-1"},
            "corr-1",
            "AGENT_RUNTIME_BOUNDARY_TIMEOUT",
        )
    ]
    assert active_agent_stream_cancel.get() is None


def test_expired_queued_scan_reports_terminal_failure(monkeypatch):
    from types import SimpleNamespace

    reports = []
    client = SimpleNamespace(
        post_scan_terminal_failure=lambda scan_job_id, payload: reports.append(
            (scan_job_id, payload)
        )
    )
    monkeypatch.setattr(system_dispatch, "_worker_client", lambda: client)
    monkeypatch.setattr(
        system_dispatch,
        "_dispatch_active_system_event",
        lambda *_args: pytest.fail("expired scan must not start"),
    )

    result = system_dispatch._dispatch_system_event(
        {},
        SimpleNamespace(
            context=LCSPRunContext(
                system_boundary_name="scan_requested",
                system_event={"scanJobId": "scan-1"},
                correlation_id="corr-1",
                system_deadline_at=time.time() - 1,
            )
        ),
    )
    assert result == {"jump_to": "end"}
    assert reports[0][0] == "scan-1"
    assert reports[0][1]["reason_code"] == "AGENT_RUNTIME_BOUNDARY_TIMEOUT"
    assert reports[0][1]["status"] == "FAILED"


def test_expired_queued_run_stops_when_api_is_still_starting(monkeypatch):
    from types import SimpleNamespace

    def api_not_ready(*_args):
        raise ConnectionError("API not ready")

    monkeypatch.setattr(
        system_dispatch,
        "_worker_client",
        lambda: SimpleNamespace(
            post_scan_terminal_failure=api_not_ready,
        ),
    )
    monkeypatch.setattr(
        system_dispatch,
        "_dispatch_active_system_event",
        lambda *_args: pytest.fail("expired scan must not start"),
    )

    assert system_dispatch._dispatch_system_event(
        {},
        SimpleNamespace(
            context=LCSPRunContext(
                system_boundary_name="scan_requested",
                system_event={"scanJobId": "scan-1"},
                system_deadline_at=time.time() - 1,
            )
        ),
    ) == {"jump_to": "end"}
