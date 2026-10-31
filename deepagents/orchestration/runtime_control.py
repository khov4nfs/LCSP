"""Cancellation fencing for governed provider and tool calls."""

from __future__ import annotations

import asyncio
from contextvars import ContextVar, copy_context
from threading import Condition, Event, Thread
from concurrent.futures import Future
from typing import Any, Callable


active_runtime_run_id: ContextVar[str | None] = ContextVar("runtime_run_id", default=None)
active_abandoned_call: ContextVar[Event | None] = ContextVar("abandoned_runtime_call", default=None)
active_physical_run_scope: ContextVar[PhysicalRunScope | None] = ContextVar("physical_runtime_scope", default=None)


class PhysicalRunScope:
    """Retain physical execution authority while cancelled calls can still finish/account."""

    def __init__(self) -> None:
        self._condition = Condition()
        self._calls = 0

    def retain(self) -> None:
        """Business purpose: Reserve physical ownership before a child call can be scheduled.

        Business rules:
        - Registration precedes thread publication so cancellation cannot hide unscheduled work.
        Execution flow:
        1. Increment the run's outstanding physical-call count under its condition lock.
        Failure cases:
        - No timeout or logical cancellation can undo this reservation.
        Side effects:
        - Updates only the owning run's in-memory physical occupancy.
        """
        with self._condition:
            self._calls += 1

    def release(self) -> None:
        """Business purpose: Record that a child call and its final accounting callback really ended.

        Business rules:
        - Only the child's actual termination path releases its one retained call.
        Execution flow:
        1. Decrement physical occupancy and wake a waiting execution drain.
        Failure cases:
        - Unbalanced release raises rather than fabricating available capacity.
        Side effects:
        - Updates run-local occupancy; grants no API lease or provider admission.
        """
        with self._condition:
            if self._calls <= 0:
                raise RuntimeError("Unbalanced physical execution release")
            self._calls -= 1
            self._condition.notify_all()

    def drain(self) -> None:
        """Business purpose: Prevent capacity handoff while abandoned work can still write usage.

        Business rules:
        - Logical completion, Stop and lease expiry cannot substitute for physical quiescence.
        Execution flow:
        1. Wait interruptibly on actual outstanding child termination until none remain.
        Failure cases:
        - An unabortable call retains capacity until it ends; no artificial timeout frees its slot.
        Side effects:
        - Blocks only this execution's worker; unrelated Roots keep their independent workers.
        """
        with self._condition:
            self._condition.wait_for(lambda: self._calls == 0)

def cancellable_sync(call: Callable[[], Any], *, late_result: Callable[[Any], None] | None = None) -> Any:
    """Business purpose: Interrupt logical work promptly while retaining its real physical occupancy.

    Business rules:
    - An unabortable call keeps the cancelled context; late content/tool results never return to the graph.
    - The enclosing native execution retains its physical slot until the call and late usage callback end.
    Execution flow:
    1. Check execution authority, register physical work and start the context-bound call.
    2. Return its result or interrupt the logical caller while physical cleanup remains tracked.
    Failure cases:
    - Provider/tool exceptions propagate; scheduling failure releases only work that never started.
    Side effects:
    - Runs the governed call and any authorized usage-only late callback; never releases global capacity itself.
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
    scope = active_physical_run_scope.get()
    if scope is not None:
        scope.retain()

    def execute() -> None:
        """Business purpose: Finish a retained blocking call and any authorized late usage callback.

        Business rules:
        - The abandoned context denies late domain/content writes; physical occupancy survives logical interruption.
        Execution flow:
        1. Run the original call and retain its result/error for the logical caller.
        2. Record authorized late usage, then release occupancy after all callback cleanup.
        Failure cases:
        - Call/callback errors are preserved; physical cleanup always executes.
        Side effects:
        - Executes the supplied governed operation and usage callback, then marks actual termination.
        """
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
            if scope is not None:
                scope.release()

    try:
        Thread(target=lambda: context.run(execute), daemon=True, name="lcsp-cancellable-call").start()
    except BaseException:
        if scope is not None:
            scope.release()
        raise
    while not done.wait(0.025):
        if cancel.is_set():
            abandoned.set()
            check_agent_execution_active()
    check_agent_execution_active()
    if not outcome[0]:
        raise outcome[1]
    return outcome[1]


async def physical_to_thread(call: Callable[..., Any], *args: Any) -> Any:
    """Business purpose: Retain accounting I/O that may outlive a cancelled async model task.

    Business rules:
    - Registration occurs before scheduling; cancellation cannot release a running blocking callback.
    - This uses one thread per awaited callback, bounded by the enclosing native physical execution slots.
    Execution flow:
    1. Register a context-bound callback and publish a cancellable future for its logical caller.
    2. Run or skip an already-cancelled callback, releasing occupancy only when the thread terminates.
    Failure cases:
    - Callback failures propagate through the future; logical cancellation leaves real I/O tracked.
    Side effects:
    - Executes existing blocking usage/admission I/O without changing its accounting semantics.
    """
    scope = active_physical_run_scope.get()
    if scope is None:
        return await asyncio.to_thread(call, *args)
    scope.retain()
    context = copy_context()
    future: Future = Future()

    def execute() -> None:
        """Business purpose: Complete one retained accounting callback before physical handoff.

        Business rules:
        - A callback cancelled before start performs no I/O; running callbacks retain occupancy to termination.
        Execution flow:
        1. Claim the future, invoke the callback and settle its actual outcome.
        Failure cases:
        - Any callback exception is preserved for the logical caller; cleanup still releases its reservation.
        Side effects:
        - Performs only the supplied existing accounting operation and releases its run-local occupancy.
        """
        try:
            if future.set_running_or_notify_cancel():
                try:
                    future.set_result(call(*args))
                except BaseException as error:
                    future.set_exception(error)
        finally:
            scope.release()

    try:
        Thread(target=lambda: context.run(execute), daemon=True, name="lcsp-physical-accounting").start()
    except BaseException:
        scope.release()
        raise
    return await asyncio.wrap_future(future)


async def cancellable_async(call: Callable[[], Any], *, late_result: Callable[[Any], None] | None = None) -> Any:
    """Business purpose: Cancel an awaited native transport while retaining late accounting work.

    Business rules:
    - Cancelled content/tool results never return to the graph; real late usage remains accounted.
    Execution flow:
    1. Await the governed task while checking execution authority.
    2. Track any late accounting callback and await native cancellation cleanup.
    Failure cases:
    - Provider/tool/cancellation exceptions retain their existing meaning; no successful result is fabricated.
    Side effects:
    - Executes/cancels the supplied native call and authorized usage callback, without freeing physical capacity.
    """
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
            await physical_to_thread(late_result, task.result())
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
