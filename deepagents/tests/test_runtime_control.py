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
    active_agent_stream_cancel,
)
from orchestration.runtime_control import (
    cancellable_async,
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
