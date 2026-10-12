"""Dispatch trusted broker events inside the local Deep Agents thread run."""

from __future__ import annotations

import asyncio
import logging
import time
from threading import Event, Timer
from typing import Any, Mapping

from langchain.agents.middleware import AgentMiddleware, hook_config
from langgraph.config import get_config

from orchestration.context import LCSPRunContext
from orchestration.runtime_control import (
    active_runtime_run_id,
)
from orchestration.agent_stream import (
    AgentStreamInterrupted,
    active_agent_stream_cancel,
    check_agent_execution_active,
)
from tools.common.capabilities.agent_runtime.boundary import AgentRuntimeBoundaryTimeout
from tools.common.capabilities.agent_runtime.invocation import (
    invoke_boundary,
    report_external_boundary_timeout,
)


_LOGGER = logging.getLogger(__name__)
_BOUNDARY_TIMEOUT_CODE = "AGENT_RUNTIME_BOUNDARY_TIMEOUT"


class _SystemEventDispatchMiddleware(AgentMiddleware):
    """Run trusted LCSP system events before the root model is invoked.

    The Agent Server executes graphs asynchronously. A sync-only hook would run
    the whole boundary (minutes of model calls) on the server event loop, so the
    server could not answer any other request: every other broker delivery then
    timed out creating its thread and was dropped after its retries. The async
    hook moves the blocking boundary onto a worker thread (context variables are
    copied), keeping the server responsive while the event runs.
    """

    @property
    def name(self) -> str:
        return "dispatch_agent_runtime_system_event"

    @hook_config(can_jump_to=["end"])
    def before_agent(self, state, runtime) -> dict[str, Any] | None:
        return _dispatch_system_event(state, runtime)

    @hook_config(can_jump_to=["end"])
    async def abefore_agent(self, state, runtime) -> dict[str, Any] | None:
        cancel = active_agent_stream_cancel.get() or Event()
        token = active_agent_stream_cancel.set(cancel)
        try:
            # Agent Server injects the native run/thread IDs here. A LangChain
            # callback run_id is a different identity and must never be used.
            configured = get_config().get("configurable", {})
        except RuntimeError:
            configured = {}
        task = asyncio.create_task(
            asyncio.to_thread(_dispatch_hosted_system_event, state, runtime, configured)
        )
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            # Cancelling to_thread's await does not stop its underlying thread.
            # Keep the native run active until boundary/checkpoint cleanup drains;
            # otherwise the control worker could acknowledge STOPPED too early.
            cancel.set()
            while not task.done():
                try:
                    await asyncio.shield(task)
                except asyncio.CancelledError:
                    continue
                except BaseException:
                    break
            if not task.cancelled():
                task.exception()  # retrieve the cancelled boundary's outcome
            raise
        finally:
            active_agent_stream_cancel.reset(token)


def _dispatch_hosted_system_event(state, runtime, configured):
    """Apply the same native cancellation scope in langgraph dev."""
    context = _context(getattr(runtime, "context", None))
    run_id = configured.get("run_id")
    thread_id = configured.get("thread_id")
    if (
        active_runtime_run_id.get() is not None
        or not run_id or not thread_id
        or context is None
        or not context.system_boundary_name or not context.system_event
    ):
        # The LCSP-owned server already binds and registers its execution scope.
        return _dispatch_system_event(state, runtime)
    run_id, thread_id = str(run_id), str(thread_id)
    run_token = active_runtime_run_id.set(run_id)
    try:
        return _dispatch_system_event(state, runtime)
    finally:
        active_runtime_run_id.reset(run_token)


def _dispatch_system_event(state, runtime) -> dict[str, Any] | None:
    context = _context(runtime.context)
    cancel = active_agent_stream_cancel.get() or Event()
    token = active_agent_stream_cancel.set(cancel)
    timer = None
    if context is not None and context.system_deadline_at is not None:
        remaining = context.system_deadline_at - time.time()
        if remaining <= 0:
            try:
                _report_expired_queued_event(context)
            finally:
                active_agent_stream_cancel.reset(token)
            return {"jump_to": "end"}
        else:
            timer = Timer(remaining, cancel.set)
            timer.daemon = True
            timer.start()
    try:
        check_agent_execution_active()
        return _dispatch_active_system_event(state, runtime)
    except AgentStreamInterrupted as error:
        # Agent Server handles Exception/CancelledError as terminal run states;
        # the stream's BaseException stop sentinel must not escape its worker.
        if (
            context is not None
            and context.system_deadline_at is not None
            and time.time() >= context.system_deadline_at
        ):
            raise AgentRuntimeBoundaryTimeout(
                "Agent Runtime boundary deadline reached"
            ) from error
        raise asyncio.CancelledError("Agent Runtime boundary interrupted") from error
    finally:
        if timer is not None:
            timer.cancel()
        active_agent_stream_cancel.reset(token)


def _report_expired_queued_event(context: LCSPRunContext) -> None:
    """Retire persisted work that was already timed out before execution began."""
    if not context.system_boundary_name or not context.system_event:
        return
    correlation_id = (
        context.correlation_id
        or _event_text(context.system_event, "correlationId", "correlation_id")
        or context.system_boundary_name
    )
    try:
        report_external_boundary_timeout(
            context.system_boundary_name,
            dict(context.system_event),
            correlation_id,
            _BOUNDARY_TIMEOUT_CODE,
        )
    except Exception as error:
        # The broker may already have settled the timed-out delivery, and the
        # API can still be starting while persisted Agent Server runs wake up.
        _LOGGER.warning(
            "Unable to report expired queued Agent Runtime boundary %s: %s",
            context.system_boundary_name,
            type(error).__name__,
        )


def _dispatch_active_system_event(state, runtime) -> dict[str, Any] | None:
    _ = state
    context = _context(runtime.context)
    if context is None or not context.system_boundary_name or not context.system_event:
        return None

    correlation_id = (
        context.correlation_id
        or _event_text(context.system_event, "correlationId", "correlation_id")
        or context.system_boundary_name
    )
    check_agent_execution_active()
    invoke_boundary(context.system_boundary_name, dict(context.system_event), correlation_id)
    return {"jump_to": "end"}


dispatch_agent_runtime_system_event = _SystemEventDispatchMiddleware()


def _context(value: object) -> LCSPRunContext | None:
    if isinstance(value, LCSPRunContext):
        return value
    if isinstance(value, Mapping):
        return LCSPRunContext(**dict(value))
    return None
















def _event_text(event: Mapping[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = event.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


__all__ = ["dispatch_agent_runtime_system_event"]
