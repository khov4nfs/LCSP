"""Cancellation fencing for governed provider and tool calls."""

from __future__ import annotations

import asyncio
from contextvars import ContextVar, copy_context
from threading import Event, Thread
from typing import Any, Callable


active_runtime_run_id: ContextVar[str | None] = ContextVar("runtime_run_id", default=None)
active_abandoned_call: ContextVar[Event | None] = ContextVar("abandoned_runtime_call", default=None)

def cancellable_sync(call: Callable[[], Any], *, late_result: Callable[[Any], None] | None = None) -> Any:
    """Abandon blocking work safely; its thread retains the cancelled scope.

    This does not claim to abort a synchronous transport. Only provider usage
    may be observed after abandonment; content and tool results never return.
    """
    from orchestration.agent_stream import active_agent_stream_cancel, check_agent_execution_active

    check_agent_execution_active()
    cancel = active_agent_stream_cancel.get()
    if cancel is None:
        return call()
    done = Event()
    abandoned = Event()
    outcome: list[Any] = []
    context = copy_context()

    def execute() -> None:
        token = active_abandoned_call.set(abandoned)
        try:
            result = call()
            outcome.extend((True, result))
            # Usage is still real when an unabortable provider answers late.
            if (abandoned.is_set() or cancel.is_set()) and late_result is not None:
                late_result(result)
        except BaseException as error:
            outcome.extend((False, error))
        finally:
            active_abandoned_call.reset(token)
            done.set()

    Thread(target=lambda: context.run(execute), daemon=True, name="lcsp-cancellable-call").start()
    while not done.wait(0.025):
        if cancel.is_set():
            abandoned.set()
            check_agent_execution_active()
    check_agent_execution_active()
    if not outcome[0]:
        raise outcome[1]
    return outcome[1]


async def cancellable_async(call: Callable[[], Any], *, late_result: Callable[[Any], None] | None = None) -> Any:
    """Cancel a native async model/tool task while it is awaiting its transport."""
    from orchestration.agent_stream import active_agent_stream_cancel, check_agent_execution_active

    check_agent_execution_active()
    cancel = active_agent_stream_cancel.get()
    task = asyncio.ensure_future(call())
    try:
        while not task.done():
            await asyncio.wait({task}, timeout=0.025)
            if not task.done():
                check_agent_execution_active()
        if cancel is not None and cancel.is_set() and not task.cancelled() and task.exception() is None and late_result is not None:
            await asyncio.to_thread(late_result, task.result())
        check_agent_execution_active()
        return task.result()
    finally:
        if not task.done():
            task.cancel()
            # Await cleanup of cancellable transports. Blocking tool threads
            # inherit the permanent stop signal and cannot publish late work.
            try:
                await task
            except BaseException:
                pass
