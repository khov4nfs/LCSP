"""Cancellation and checkpoint scope shared by every assessment runtime stage."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import os
from contextlib import contextmanager
from contextvars import ContextVar, copy_context
from queue import Queue
from threading import Event, Lock, Thread
from typing import Any, Callable

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver


active_runtime_run_id: ContextVar[str | None] = ContextVar("runtime_run_id", default=None)
active_abandoned_call: ContextVar[Event | None] = ContextVar("abandoned_runtime_call", default=None)
active_checkpoint_scope: ContextVar[tuple[Any, str] | None] = ContextVar(
    "runtime_checkpoint_scope", default=None
)


class NativeExecutionScope:
    """Drain all nested checkpoint writers before acknowledging a native turn.

    An async tool cancellation can release its executor thread before a nested
    graph in that thread has finished checkpoint cleanup. A shared scope keeps
    that cleanup inside the original run's cancellation boundary.
    """

    def __init__(self) -> None:
        self._lock = Lock()
        self._threads: list[Thread] = []
        self._closed = False

    def start(self, thread: Thread) -> None:
        with self._lock:
            if self._closed:
                from orchestration.agent_stream import AgentStreamInterrupted
                raise AgentStreamInterrupted("Native execution scope is closed")
            # Start under the lock: drain must never join a registered but
            # not-yet-started thread, or miss a concurrent registration.
            thread.start()
            self._threads.append(thread)

    def drain(self) -> None:
        with self._lock:
            self._closed = True
            threads = tuple(self._threads)
        for thread in threads:
            thread.join()


active_native_execution_scope: ContextVar[NativeExecutionScope | None] = ContextVar(
    "native_execution_scope", default=None
)

# Match langgraph dev's process-local checkpoint lifetime when no durable
# database is configured. Continue must reuse this saver, not a fresh instance.
_dev_nested_checkpointer = InMemorySaver()


@contextmanager
def hosted_checkpoint_scope(thread_id: str, logical_run_id: str):
    """Keep nested checkpoints stable across hosted native run generations."""
    from tools.common.capabilities.platform.graph_runtime import checkpoint_database_url

    url = checkpoint_database_url(
        os.getenv("LANGGRAPH_CHECKPOINT_DATABASE_URL")
        or os.getenv("POSTGRES_URI")
        or os.getenv("DATABASE_URL")
    )

    @contextmanager
    def bind(saver):
        token = active_checkpoint_scope.set(
            (AsyncCompatibleSaver(saver), f"{thread_id}:{logical_run_id}")
        )
        try:
            yield
        finally:
            active_checkpoint_scope.reset(token)

    if url:
        from langgraph.checkpoint.postgres import PostgresSaver

        with PostgresSaver.from_conn_string(url) as saver:
            saver.setup()
            with bind(saver):
                yield
    else:
        if (
            os.getenv("LCSP_AGENT_RUNTIME_MODE", "").strip().lower() == "production"
            or os.getenv("NODE_ENV", "").strip().lower() == "production"
        ):
            raise RuntimeError(
                "production LCSP Agent Runtime requires LANGGRAPH_CHECKPOINT_DATABASE_URL"
            )
        with bind(_dev_nested_checkpointer):
            yield


def invoke_native_values(graph: Any, input_value: Any, **kwargs: Any) -> Any:
    """Keep the graph/checkpointer alive until interruption cleanup completes.

    Only provider/tool operations may be abandoned, never a graph that can
    continue writing the same checkpoint that Continue is about to resume.
    """
    from orchestration.agent_stream import check_agent_execution_active

    result = None
    for result in native_stream(graph, input_value, stream_mode="values", **kwargs):
        check_agent_execution_active()
    check_agent_execution_active()
    return result


def checkpointed_invocation(graph: Any, input_value: Any, config: Any, name: str):
    """Recover pending nested work and reuse completed graph results on root resume."""
    scope = active_checkpoint_scope.get()
    from orchestration.agent_stream import active_agent_stream_cancel
    if scope is None and active_agent_stream_cancel.get() is None:
        return graph, input_value, config, None
    if not callable(getattr(graph, "get_state", None)):
        return graph, input_value, config, None
    configured = (config or {}).get("configurable", {})
    existing_saver = getattr(graph, "checkpointer", None)
    if existing_saver and configured.get("thread_id"):
        # Workflow graphs already have durable, rule-scoped identities. Keep
        # those checkpoints rather than replacing them with a prompt hash.
        saver = existing_saver if isinstance(existing_saver, AsyncCompatibleSaver) else AsyncCompatibleSaver(existing_saver)
    elif scope is not None:
        saver, logical_thread = scope
        task_id = (config or {}).get("metadata", {}).get("lcsp_thread_id")
        key = hashlib.sha256(json.dumps([name, task_id or input_value], sort_keys=True, default=str).encode()).hexdigest()
        config = {**(config or {}), "configurable": {**configured, "thread_id": f"{logical_thread}:{key}", "checkpoint_ns": ""}}
        config["configurable"].pop("checkpoint_id", None)
    else:
        return graph, input_value, config, None
    graph = copy.copy(graph)
    graph.checkpointer = saver
    snapshot = graph.get_state(config)
    if getattr(snapshot, "created_at", None):
        if getattr(snapshot, "next", ()):
            return graph, None, config, None
        return graph, None, config, getattr(snapshot, "values", {})
    return graph, input_value, config, None


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


class AsyncCompatibleSaver(BaseCheckpointSaver):
    """Use the installed sync Postgres saver from native async model graphs."""

    def __init__(self, saver: Any) -> None:
        super().__init__(serde=saver.serde)
        self.saver = saver

    def get_tuple(self, config):
        return self.saver.get_tuple(config)

    def put(self, *args, **kwargs):
        self._assert_not_abandoned()
        return self.saver.put(*args, **kwargs)

    def put_writes(self, *args, **kwargs):
        self._assert_not_abandoned()
        return self.saver.put_writes(*args, **kwargs)

    @staticmethod
    def _assert_not_abandoned():
        abandoned = active_abandoned_call.get()
        if abandoned is not None and abandoned.is_set():
            from orchestration.agent_stream import AgentStreamInterrupted
            raise AgentStreamInterrupted("Abandoned tool cannot write a checkpoint")

    def list(self, *args, **kwargs):
        return self.saver.list(*args, **kwargs)

    def get_next_version(self, current, channel):
        return self.saver.get_next_version(current, channel)

    async def aget_tuple(self, config):
        return await asyncio.to_thread(self.get_tuple, config)

    async def aput(self, *args, **kwargs):
        return await asyncio.to_thread(self.put, *args, **kwargs)

    async def aput_writes(self, *args, **kwargs):
        return await asyncio.to_thread(self.put_writes, *args, **kwargs)

    async def alist(self, *args, **kwargs):
        for item in await asyncio.to_thread(lambda: list(self.list(*args, **kwargs))):
            yield item


def native_stream(graph: Any, input_value: Any, **kwargs: Any):
    """Bridge native async LangGraph execution to existing synchronous boundaries."""
    from orchestration.agent_stream import active_agent_stream_cancel, check_agent_execution_active

    check_agent_execution_active()
    if active_agent_stream_cancel.get() is None or not callable(getattr(graph, "astream", None)):
        yield from graph.stream(input_value, **kwargs)
        return
    queue: Queue[tuple[bool, Any]] = Queue()
    context = copy_context()
    sentinel = object()

    async def consume() -> None:
        async def produce() -> None:
            # Advance an async generator in one task: LangGraph/provider context
            # tokens must be closed in the task that created them.
            async for chunk in graph.astream(input_value, **kwargs, durability="sync"):
                queue.put((True, chunk))

        try:
            await cancellable_async(produce)
        except BaseException as error:
            queue.put((False, error))
        finally:
            queue.put((True, sentinel))

    def run() -> None:
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(consume())
        finally:
            pending = asyncio.all_tasks(loop)
            if pending:
                # LangGraph can shield final checkpoint writes on cancellation.
                # Persist those writes before releasing the run's thread lock.
                loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
            loop.run_until_complete(loop.shutdown_asyncgens())
            # Do not wait for unabortable executor tools here. They keep their
            # cancelled context; no graph result can escape this invocation.
            loop.close()

    thread = Thread(target=lambda: context.run(run), daemon=True, name="lcsp-native-agent")
    scope = active_native_execution_scope.get()
    if scope is None:
        thread.start()
    else:
        scope.start(thread)
    try:
        while True:
            ok, value = queue.get()
            if value is sentinel:
                break
            if not ok:
                raise value
            yield value
    finally:
        thread.join()
