import asyncio
import time
from contextvars import copy_context
from threading import Event, Thread
from types import SimpleNamespace
from typing import TypedDict

import pytest
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import InMemorySaver
from conftest import use_model_routes
from middleware.usage_metering import UsageMeteringMiddleware
from orchestration.agent_stream import (
    AgentStreamInterrupted, AgentStreamSession, activate_agent_stream,
    active_agent_stream_cancel, invoke_graph_with_stream,
)
from orchestration.runtime_control import (
    cancellable_async, active_checkpoint_scope, AsyncCompatibleSaver, checkpointed_invocation,
    native_stream,
)


@pytest.fixture
def metering(monkeypatch):
    use_model_routes(monkeypatch, {"routes": {"a": {"provider": "openai", "model": "test-model"}}, "roles": {"default": "a"}})
    middleware = UsageMeteringMiddleware()
    events, usage = [], []
    monkeypatch.setattr("middleware.usage_metering.publish_agent_stream_event", lambda kind, **data: events.append(kind))
    monkeypatch.setattr(middleware, "_record", lambda response, model: usage.append(response))
    return middleware, events, usage


def request():
    return SimpleNamespace(model=SimpleNamespace(provider="openai", model_name="test-model"))


def stop_when_started(started, cancel):
    assert started.wait(2)
    cancel.set()


def test_nonabortable_model_is_abandoned_before_release_and_late_usage_only(metering):
    middleware, events, usage = metering
    started, release, returned, cancel = Event(), Event(), Event(), Event()
    def provider(_):
        started.set()
        release.wait(3)
        returned.set()
        return SimpleNamespace(content="late content")
    Thread(target=stop_when_started, args=(started, cancel), daemon=True).start()
    token = active_agent_stream_cancel.set(cancel)
    try:
        began = time.monotonic()
        with pytest.raises(AgentStreamInterrupted):
            middleware.wrap_model_call(request(), provider)
        assert time.monotonic() - began < 0.75
        assert not returned.is_set()
        assert "MODEL_CALL_CANCELLED" in events
        assert "MODEL_CALL_COMPLETED" not in events
        # Even a retry/fallback cannot enter another provider attempt.
        with pytest.raises(AgentStreamInterrupted):
            middleware.wrap_model_call(request(), provider)
        release.set()
        assert returned.wait(1)
        deadline = time.monotonic() + 1
        while not usage and time.monotonic() < deadline:
            time.sleep(0.01)
        assert len(usage) == 1
        assert "MODEL_CALL_COMPLETED" not in events
    finally:
        release.set()
        active_agent_stream_cancel.reset(token)


@pytest.mark.asyncio
async def test_native_model_task_cancelled_while_awaiting_provider(metering):
    middleware, events, usage = metering
    started, cancelled, cancel = Event(), Event(), Event()
    async def provider(_):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    Thread(target=stop_when_started, args=(started, cancel), daemon=True).start()
    token = active_agent_stream_cancel.set(cancel)
    try:
        with pytest.raises(AgentStreamInterrupted):
            await asyncio.wait_for(middleware.awrap_model_call(request(), provider), timeout=0.75)
        assert cancelled.is_set()
        assert not usage
        assert events == ["MODEL_CALL_STARTED", "MODEL_CALL_CANCELLED"]
    finally:
        active_agent_stream_cancel.reset(token)


@pytest.mark.asyncio
async def test_async_usage_delivery_does_not_block_model_cancellation(metering, monkeypatch):
    middleware, events, _ = metering
    recording, release, cancel = Event(), Event(), Event()
    def record(_response, _model):
        recording.set()
        release.wait(2)
    monkeypatch.setattr(middleware, "_record", record)
    async def provider(_):
        return SimpleNamespace(content="answered before stop")
    token = active_agent_stream_cancel.set(cancel)
    task = asyncio.create_task(middleware.awrap_model_call(request(), provider))
    try:
        assert await asyncio.to_thread(recording.wait, 1)
        cancel.set()
        # Native graph cancellation can cancel the task while telemetry is
        # still delivering; that delivery is usage-only and cannot publish content.
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, .75)
        assert not release.is_set()
        assert "MODEL_CALL_CANCELLED" in events
        assert "MODEL_CALL_COMPLETED" not in events
    finally:
        release.set()
        active_agent_stream_cancel.reset(token)


def test_blocking_tool_late_result_never_returns_to_graph(metering):
    middleware, _, _ = metering
    started, release, cancel = Event(), Event(), Event()
    def tool(_):
        started.set()
        release.wait(3)
        return "late tool result"
    Thread(target=stop_when_started, args=(started, cancel), daemon=True).start()
    token = active_agent_stream_cancel.set(cancel)
    try:
        with pytest.raises(AgentStreamInterrupted):
            middleware.wrap_tool_call(None, tool)
        assert not release.is_set()
    finally:
        release.set()
        active_agent_stream_cancel.reset(token)


def test_fallback_does_not_try_a_second_credential_after_midflight_stop(metering, monkeypatch):
    from middleware import token_fallback
    from middleware.token_fallback import TokenFallbackMiddleware
    middleware, _, _ = metering
    fallback = TokenFallbackMiddleware()
    monkeypatch.setattr(token_fallback, "model_provider", lambda _: "openai")
    monkeypatch.setattr(token_fallback, "provider_token_source", lambda _: ("OPENAI_API_KEY", ("first", "second")))
    monkeypatch.setattr(fallback, "_candidate_request", lambda candidate, _p, _t, index: SimpleNamespace(model=candidate.model, key_slot=index))
    started, release, cancel = Event(), Event(), Event()
    attempts = []
    def provider(candidate):
        attempts.append(candidate.key_slot)
        started.set()
        release.wait(2)
        raise ConnectionError("late failure from cancelled attempt")
    Thread(target=stop_when_started, args=(started, cancel), daemon=True).start()
    token = active_agent_stream_cancel.set(cancel)
    try:
        with pytest.raises(AgentStreamInterrupted):
            fallback.wrap_model_call(request(), lambda candidate: middleware.wrap_model_call(candidate, provider))
        assert attempts == [0]
    finally:
        release.set()
        active_agent_stream_cancel.reset(token)


def test_explicit_workflow_checkpoint_identity_is_not_replaced_by_root_scope():
    class State(TypedDict):
        value: int
    existing = InMemorySaver()
    builder = StateGraph(State)
    builder.add_node("rule", lambda state: {"value": state["value"] + 1})
    builder.add_edge(START, "rule")
    builder.add_edge("rule", END)
    graph = builder.compile(checkpointer=existing)
    config = {"configurable": {"thread_id": "completed-rule-workflow", "pinned": "value"}}
    graph.invoke({"value": 1}, config)
    token = active_checkpoint_scope.set((AsyncCompatibleSaver(InMemorySaver()), "outer-dispatch"))
    try:
        _, input_value, resumed_config, completed = checkpointed_invocation(graph, None, config, "rule")
        assert completed == {"value": 2}
        assert input_value is None
        assert resumed_config == config
    finally:
        active_checkpoint_scope.reset(token)


@pytest.mark.parametrize("stage", ["INTERVIEW", "RULE_ANALYSIS", "GATE"])
def test_native_server_stop_resume_fences_old_provider_and_reuses_completed_work(metering, monkeypatch, stage):
    from tools.common.capabilities.agent_runtime.local_server import LocalAgentRuntime
    middleware, _, _ = metering
    started, release, returned = Event(), Event(), Event()
    calls = []
    class State(TypedDict):
        value: int
    def completed(state):
        calls.append("completed")
        return {"value": state["value"] + 1}
    def provider(_):
        calls.append("provider")
        if calls.count("provider") == 1:
            started.set()
            release.wait(3)
            returned.set()
        return SimpleNamespace(content="result")
    def thinking(state):
        middleware.wrap_model_call(request(), provider)
        return {"value": state["value"] + 1}
    child_builder = StateGraph(State)
    child_builder.add_node("completed", completed)
    child_builder.add_node("thinking", thinking)
    child_builder.add_edge(START, "completed")
    child_builder.add_edge("completed", "thinking")
    child_builder.add_edge("thinking", END)
    child = child_builder.compile()
    root_builder = StateGraph(State)
    root_builder.add_node("dispatch", lambda state: invoke_graph_with_stream(child, state, graph_name="workflow", stage=stage))
    root_builder.add_edge(START, "dispatch")
    root_builder.add_edge("dispatch", END)
    runtime = LocalAgentRuntime()
    runtime.graph = root_builder.compile(checkpointer=InMemorySaver())
    context = {"logical_run_id": "one-logical-turn"}
    def wait_terminal(run_id):
        deadline = time.monotonic() + 1
        while time.monotonic() < deadline:
            run = runtime.get_run("exact-thread", run_id)
            if run["status"] not in {"pending", "running"}:
                return run
            time.sleep(0.01)
        pytest.fail("native interruption/resume exceeded the bounded test interval")
    try:
        first = runtime.create_run("exact-thread", {"input": {"value": 0}, "context": context})
        assert started.wait(1)
        runtime.cancel_run("exact-thread", first["run_id"])
        assert wait_terminal(first["run_id"])["status"] == "interrupted"
        assert not returned.is_set()
        checkpoint = runtime.get_state("exact-thread")["checkpoint"]
        payload = {"input": None, "context": context, "checkpoint_id": checkpoint["checkpoint_id"], "metadata": {"lcsp_resume_request_id": "same-continue"}, "multitask_strategy": "reject"}
        resumed = runtime.create_run("exact-thread", payload)
        assert runtime.create_run("exact-thread", payload)["run_id"] == resumed["run_id"]
        assert wait_terminal(resumed["run_id"])["status"] == "success"
        assert calls == ["completed", "provider", "provider"]
        assert runtime.get_state("exact-thread")["values"] == {"value": 2}
        release.set()
        assert returned.wait(1)
        assert runtime.get_state("exact-thread")["values"] == {"value": 2}
        assert runtime.create_run("exact-thread", payload)["run_id"] == resumed["run_id"]
    finally:
        release.set()
        runtime.close()


def test_stop_waits_for_nested_checkpoint_cleanup():
    from tools.common.capabilities.agent_runtime.local_server import LocalAgentRuntime
    class State(TypedDict):
        value: int
    started, cleanup, release = Event(), Event(), Event()
    class NestedGraph:
        async def astream(self, _input, **_kwargs):
            started.set()
            try:
                await asyncio.Event().wait()
                yield {"value": 1}
            finally:
                cleanup.set()
                # Represent a shielded checkpoint flush after cancellation.
                while not release.is_set():
                    await asyncio.sleep(.01)
    def dispatch(_state):
        context = copy_context()
        def nested_tool():
            try:
                list(native_stream(NestedGraph(), {}, stream_mode="values"))
            except AgentStreamInterrupted:
                pass
        Thread(target=lambda: context.run(nested_tool), daemon=True).start()
        assert started.wait(1)
        active_agent_stream_cancel.get().wait(2)
        raise AgentStreamInterrupted("Parent tool task cancelled")
    builder = StateGraph(State)
    builder.add_node("dispatch", dispatch)
    builder.add_edge(START, "dispatch")
    builder.add_edge("dispatch", END)
    runtime = LocalAgentRuntime()
    runtime.graph = builder.compile(checkpointer=InMemorySaver())
    try:
        run = runtime.create_run("cleanup-thread", {"input": {"value": 0}})
        assert started.wait(1)
        runtime.cancel_run("cleanup-thread", run["run_id"])
        assert cleanup.wait(1)
        assert runtime.get_run("cleanup-thread", run["run_id"])["status"] == "running"
        release.set()
        deadline = time.monotonic() + 1
        while runtime.get_run("cleanup-thread", run["run_id"])["status"] == "running" and time.monotonic() < deadline:
            time.sleep(.01)
        assert runtime.get_run("cleanup-thread", run["run_id"])["status"] == "interrupted"
    finally:
        release.set()
        runtime.close()


@pytest.mark.asyncio
async def test_async_tool_receives_cancellation(metering):
    middleware, _, _ = metering
    started, cancelled, cancel = Event(), Event(), Event()
    async def tool(_):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    Thread(target=stop_when_started, args=(started, cancel), daemon=True).start()
    token = active_agent_stream_cancel.set(cancel)
    try:
        with pytest.raises(AgentStreamInterrupted):
            await asyncio.wait_for(middleware.awrap_tool_call(None, tool), .75)
        assert cancelled.is_set()
    finally:
        active_agent_stream_cancel.reset(token)


@pytest.mark.parametrize("stage", ["INTERVIEW", "RULE_ANALYSIS", "GATE"])
def test_native_checkpoint_resume_preserves_completed_nodes_for_each_stage(stage):
    class State(TypedDict):
        value: int
    calls = []
    started, cancel = Event(), Event()
    async def completed(state):
        calls.append("completed")
        return {"value": state["value"] + 1}
    async def pending(state):
        calls.append("pending")
        started.set()
        if len(calls) == 2:
            await cancellable_async(lambda: asyncio.Event().wait())
        return {"value": state["value"] + 1}
    builder = StateGraph(State)
    builder.add_node("completed", completed)
    builder.add_node("pending", pending)
    builder.add_edge(START, "completed")
    builder.add_edge("completed", "pending")
    builder.add_edge("pending", END)
    graph = builder.compile()
    session = AgentStreamSession("a", "workflow", "correlation", "boundary", lambda _: None, stage=stage)
    scope = active_checkpoint_scope.set((AsyncCompatibleSaver(InMemorySaver()), "original-thread:logical-run"))
    token = active_agent_stream_cancel.set(cancel)
    Thread(target=stop_when_started, args=(started, cancel), daemon=True).start()
    try:
        with activate_agent_stream(session), pytest.raises(AgentStreamInterrupted):
            invoke_graph_with_stream(graph, {"value": 0}, graph_name="workflow", stage=stage)
        assert calls == ["completed", "pending"]
        # A new cancellation generation resumes the SAME nested checkpoint.
        active_agent_stream_cancel.set(Event())
        with activate_agent_stream(session):
            result = invoke_graph_with_stream(graph, {"value": 0}, graph_name="workflow", stage=stage)
            assert result["value"] == 2
            assert calls == ["completed", "pending", "pending"]
            # Re-entering the outer boundary reuses the completed result.
            assert invoke_graph_with_stream(graph, {"value": 0}, graph_name="workflow", stage=stage)["value"] == 2
            assert calls == ["completed", "pending", "pending"]
    finally:
        active_agent_stream_cancel.reset(token)
        active_checkpoint_scope.reset(scope)
