"""LCSP-owned LangGraph HTTP runtime for the production Agent Server service.

This server intentionally implements only the LangGraph SDK surface LCSP uses:
thread creation, asynchronous run create/poll/cancel, synchronous wait
compatibility, and thread state reads. It keeps the native Deep Agents/LangGraph
graph as the runtime authority while avoiding the licensed
``langchain/langgraph-api`` image for Fogewise production.
"""

from __future__ import annotations

import logging
import asyncio
import os
import threading
import uuid
import hmac
import hashlib
from collections.abc import Mapping
from concurrent.futures import CancelledError, Future, ThreadPoolExecutor, TimeoutError
from contextlib import ExitStack, asynccontextmanager, contextmanager
from dataclasses import asdict, is_dataclass
from datetime import UTC, datetime
from typing import Any

import anyio
import uvicorn
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from langchain_core.messages import BaseMessage, message_to_dict
from langgraph.store.memory import InMemoryStore
from langsmith_bootstrap import disable_langsmith_tracing_by_default
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from tools.common.capabilities.platform.graph_runtime import checkpoint_database_url
from orchestration.agent_stream import AgentStreamInterrupted, active_agent_stream_cancel
from orchestration.graph_execution import agent_graph_config
from orchestration.runtime_control import (
    active_runtime_run_id,
)


DEFAULT_ASSISTANT_ID = "lcsp-agent"
DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8000
logger = logging.getLogger(__name__)
RUN_NAMESPACE = "lcsp-agent-runtime-runs"


class LocalAgentRuntime:
    """Synchronous LangGraph runner behind a LangGraph-SDK-compatible facade."""

    def __init__(self, *, store=None) -> None:
        self._threads: dict[str, dict[str, Any]] = {}
        self._locks: dict[str, threading.Lock] = {}
        self._runs: dict[tuple[str, str], dict[str, Any]] = {}
        self._run_futures: dict[tuple[str, str], Future[None]] = {}
        self._cancel_events: dict[tuple[str, str], threading.Event] = {}
        self._revoked_threads: set[str] = set()
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(
            max_workers=_run_worker_count(),
            thread_name_prefix="lcsp-local-agent-run",
        )
        self._checkpointer_context = None
        self._checkpointer = None
        self._store_context = None
        self._store = store if store is not None else InMemoryStore()
        self._run_payloads: dict[tuple[str, str], dict[str, Any]] = {}
        self._database_url: str | None = None
        self.graph = None

    def start(self) -> None:
        disable_langsmith_tracing_by_default()
        checkpointer = self._open_checkpointer()
        if self._database_url:
            from langgraph.store.postgres import PostgresStore

            self._store_context = PostgresStore.from_conn_string(self._database_url)
            self._store = self._store_context.__enter__()
            self._store.setup()
        from agent import create_root_agent

        self.graph = create_root_agent(checkpointer=checkpointer, store=self._store)
        self._restore_runs()

    def close(self) -> None:
        # Drain in-flight runs before tearing down the checkpointer/runtime.
        # Using wait=False allowed model/tool threads to keep emitting stream and
        # billing callbacks after the HTTP process had already begun shutdown,
        # which produced a cascade of ConnectError warnings and could lose the
        # terminal activity for an otherwise valid run.
        self._executor.shutdown(wait=True, cancel_futures=True)
        if self._store_context is not None:
            self._store_context.__exit__(None, None, None)
            self._store_context = None
        if self._checkpointer_context is not None:
            self._checkpointer_context.__exit__(None, None, None)
            self._checkpointer_context = None
            self._checkpointer = None

    def create_thread(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        thread_id = _text(payload.get("thread_id")) or str(uuid.uuid4())
        metadata = payload.get("metadata") if isinstance(payload.get("metadata"), Mapping) else {}
        now = _now()
        with self._lock:
            if thread_id in self._revoked_threads:
                raise PermissionError("Assessment thread access is revoked")
            existing = self._threads.get(thread_id)
            if existing is not None:
                return existing
            thread = {
                "thread_id": thread_id,
                "created_at": now,
                "updated_at": now,
                "metadata": dict(metadata),
                "status": "idle",
                "values": {},
            }
            self._threads[thread_id] = thread
            self._locks.setdefault(thread_id, threading.Lock())
            return thread

    def get_thread(self, thread_id: str) -> dict[str, Any] | None:
        with self._lock:
            return self._threads.get(thread_id)

    def create_run(
        self,
        thread_id: str,
        payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        """Schedule one LangGraph run and return immediately with SDK run state."""
        self.create_thread({"thread_id": thread_id, "if_exists": "do_nothing"})
        run_id = str(uuid.uuid4())
        now = _now()
        run = {
            "run_id": run_id,
            "thread_id": thread_id,
            "assistant_id": _text(payload.get("assistant_id")) or DEFAULT_ASSISTANT_ID,
            "created_at": now,
            "updated_at": now,
            "status": "pending",
            "metadata": (
                dict(payload.get("metadata") or {})
                if isinstance(payload.get("metadata"), Mapping)
                else {}
            ),
            "multitask_strategy": payload.get("multitask_strategy") or "enqueue",
        }
        key = (thread_id, run_id)
        with self._lock:
            if thread_id in self._revoked_threads:
                raise PermissionError("Assessment thread access is revoked")
            resume_id = (payload.get("metadata") or {}).get("lcsp_resume_request_id")
            if resume_id:
                for (existing_thread, _), existing in self._runs.items():
                    if existing_thread == thread_id and existing["metadata"].get("lcsp_resume_request_id") == resume_id:
                        return dict(existing)
            if payload.get("multitask_strategy") == "reject" and any(
                t == thread_id and r["status"] in {"pending", "running"}
                for (t, _), r in self._runs.items()
            ):
                raise RuntimeError("Agent Server thread already has an active run")
            self._runs[key] = run
            self._run_payloads[key] = _json_ready(dict(payload))
            # Persist the transport request before publishing/scheduling its run ID.
            try:
                self._save_run(key)
            except Exception:
                self._runs.pop(key, None)
                self._run_payloads.pop(key, None)
                raise
            self._cancel_events[key] = threading.Event()
            # Publication and scheduling share the revocation lock.
            future = self._executor.submit(
                self._execute_run, thread_id, run_id, dict(payload),
            )
            self._run_futures[key] = future
        return dict(run)

    def get_run(self, thread_id: str, run_id: str) -> dict[str, Any] | None:
        with self._lock:
            run = self._runs.get((thread_id, run_id))
            return dict(run) if run is not None else None

    def list_runs(self, thread_id: str) -> list[dict[str, Any]]:
        """Return this thread's runs, newest first (mirrors the LangGraph SDK shape)."""
        with self._lock:
            runs = [
                dict(run)
                for (run_thread_id, _run_id), run in self._runs.items()
                if run_thread_id == thread_id
            ]
        runs.sort(key=lambda run: str(run.get("created_at") or ""), reverse=True)
        return runs

    def cancel_run(self, thread_id: str, run_id: str) -> dict[str, Any] | None:
        """Cancel a queued run immediately, or signal an in-flight run to stop.

        A run already inside ``graph.stream(...)`` cannot be killed outright without
        corrupting graph state, so this sets a cooperative cancel event that
        ``_run_graph`` checks between completed supersteps (the same points the
        checkpointer already persists to), leaving the thread cleanly resumable.
        """
        key = (thread_id, run_id)
        with self._lock:
            run = self._runs.get(key)
            future = self._run_futures.get(key)
            cancel_event = self._cancel_events.get(key)
            if run is None:
                return None
            if run["status"] not in {"pending", "running"}:
                return dict(run)
        if future is not None and future.cancel():
            self._set_run_status(thread_id, run_id, "interrupted")
            self._set_thread_status(thread_id, "idle")
        else:
            if cancel_event is not None:
                cancel_event.set()
            with self._lock:
                current = self._runs.get(key)
                if current is not None:
                    current["cancel_requested_at"] = _now()
                    current["updated_at"] = _now()
                    self._save_run(key)
        return self.get_run(thread_id, run_id)

    def erase_assessment(self, assessment_id: str, owner_id: str, root_thread_id: str) -> None:
        from tools.common.capabilities.agent_runtime.agent_server_client import agent_thread_id
        from tools.common.capabilities.platform.docker_sandbox import DockerSandboxManager
        from tools.common.capabilities.platform.logging_path import erase_assessment_logs

        # The transport graph and the Root have distinct storage identities;
        # neither is a second assessment reasoning authority.
        threads = {root_thread_id, agent_thread_id("", {"assessmentId": assessment_id}, "")}
        with self._lock:
            self._revoked_threads.update(threads)
            keys = [key for key in self._runs if key[0] in threads]
            for key in keys:
                self._cancel_events[key].set()
            futures = [self._run_futures[key] for key in keys if key in self._run_futures]
        for future in futures:
            future.cancel()
            try:
                future.result(timeout=30)
            except CancelledError:
                pass
            except TimeoutError:
                raise RuntimeError("Assessment execution has not drained") from None
            except Exception:
                # A terminal failed execution cannot still write its checkpoint.
                pass
        saver = self._checkpointer or getattr(self.graph, "checkpointer", None)
        if saver is None or not callable(getattr(saver, "delete_thread", None)):
            raise RuntimeError("Assessment checkpointer erasure is unavailable")
        with ExitStack() as locks:
            for thread in sorted(threads):
                locks.enter_context(self._database_thread_lock(thread, blocking=False))
                lock = self._thread_lock(thread)
                if not lock.acquire(timeout=30):
                    raise RuntimeError("Assessment execution has not drained")
                locks.callback(lock.release)
            for thread in threads:
                saver.delete_thread(thread)
                DockerSandboxManager().erase(thread)
                for item in list(self._stored_runs(thread)):
                    self._store.delete(item.namespace, item.key)
            erase_assessment_logs(owner_id, assessment_id)
            with self._lock:
                for thread in threads:
                    self._threads.pop(thread, None)
                for key in keys:
                    self._runs.pop(key, None)
                    self._run_futures.pop(key, None)
                    self._cancel_events.pop(key, None)
                    self._run_payloads.pop(key, None)

    def wait_for_run(self, thread_id: str, payload: Mapping[str, Any]) -> Any:
        """Synchronous SDK-compatible wait. No run id is tracked on this path, so
        it cannot be cancelled mid-flight — only the async create/poll/cancel path
        (``create_run``/``_execute_run``) supports cooperative interruption."""
        with self._database_thread_lock(thread_id):
            result, _interrupted = self._run_graph(thread_id, payload, cancel_event=None)
        return _json_ready(result)

    def _stored_runs(self, thread_id: str | None = None):
        namespace = (RUN_NAMESPACE, thread_id) if thread_id else (RUN_NAMESPACE,)
        offset = 0
        while items := self._store.search(namespace, limit=100, offset=offset):
            yield from items
            offset += len(items)

    def _save_run(self, key: tuple[str, str]) -> None:
        self._store.put(
            (RUN_NAMESPACE, key[0]), key[1],
            {"run": dict(self._runs[key]), "payload": self._run_payloads.get(key)},
        )

    def _restore_runs(self) -> None:
        """Recover transport scheduling; native LangGraph remains the checkpoint authority."""
        for item in list(self._stored_runs()):
            run = dict(item.value["run"])
            key = (run["thread_id"], run["run_id"])
            self.create_thread({"thread_id": key[0], "metadata": run.get("metadata", {})})
            self._runs[key] = run
            self._cancel_events[key] = threading.Event()
            if run.get("cancel_requested_at"):
                self._cancel_events[key].set()
            if run["status"] in {"pending", "running"}:
                payload = dict(item.value["payload"])
                # Running work resumes its saved superstep without appending another input.
                snapshot = self._graph().get_state({"configurable": {"thread_id": key[0]}})
                if run["status"] == "running" and (getattr(snapshot, "metadata", {}) or {}).get("lcsp_runtime_run_id") == key[1]:
                    payload["input"] = None
                self._run_payloads[key] = payload
                self._run_futures[key] = self._executor.submit(self._execute_restored_run, *key, payload)

    def _execute_restored_run(self, thread_id: str, run_id: str, payload: Mapping[str, Any]) -> None:
        if (payload.get("context") or {}).get("system_boundary_name"):
            from tools.common.capabilities.agent_runtime.rabbitmq_consumer import (
                _wait_for_api_ready,
            )

            # Restarted graph work has the same API readiness requirement as broker delivery.
            _wait_for_api_ready(
                api_base_url=os.getenv("NESTJS_API_BASE_URL"),
                timeout_seconds=float("inf"),
                stopping=self._cancel_events[(thread_id, run_id)],
            )
        self._execute_run(thread_id, run_id, payload)

    @contextmanager
    def _database_thread_lock(self, thread_id: str, *, blocking: bool = True):
        if not self._database_url:
            yield
            return
        import psycopg

        lock_id = int.from_bytes(hashlib.sha256(thread_id.encode()).digest()[:8], "big", signed=True)
        # Process death releases this lock; another server cannot replay the thread concurrently.
        with psycopg.connect(self._database_url, autocommit=True) as connection:
            function = "pg_advisory_lock" if blocking else "pg_try_advisory_lock"
            acquired = connection.execute(f"SELECT {function}(%s)", (lock_id,)).fetchone()
            if not blocking and not acquired[0]:
                raise RuntimeError("Assessment execution has not drained")
            try:
                yield
            finally:
                connection.execute("SELECT pg_advisory_unlock(%s)", (lock_id,))

    def _run_graph(
        self,
        thread_id: str,
        payload: Mapping[str, Any],
        *,
        cancel_event: threading.Event | None,
    ) -> tuple[Any, bool]:
        """Run, or resume, the graph for one turn.

        Streams by superstep instead of a single blocking ``invoke`` so a set
        ``cancel_event`` can stop execution between completed nodes — the same
        points the checkpointer persists to, so the thread is always left in a
        cleanly resumable state. Returns ``(last_state, interrupted)``.
        """
        self.create_thread({"thread_id": thread_id, "if_exists": "do_nothing"})
        lock = self._thread_lock(thread_id)
        with lock:
            with self._lock:
                if thread_id in self._revoked_threads:
                    raise PermissionError("Assessment thread access is revoked")
            self._set_thread_status(thread_id, "busy")
            try:
                graph = self._graph()
                context = payload.get("context")
                if not isinstance(context, Mapping):
                    context = {}
                config = _runtime_config(
                    thread_id,
                    payload.get("config"),
                    payload.get("metadata"),
                    context,
                )
                if payload.get("checkpoint_id"):
                    config["configurable"]["checkpoint_id"] = payload["checkpoint_id"]
                graph_input = payload.get("input")
                if graph_input is None:
                    # No new input: resume from the checkpoint only if there is
                    # pending work, else this is a harmless no-op turn.
                    pending = graph.get_state(config)
                    if not getattr(pending, "next", None):
                        values = dict(getattr(pending, "values", {}) or {})
                        self._update_thread_values(thread_id, values)
                        return values, False
                try:
                    stream = graph.stream(
                        graph_input,
                        config=config,
                        context=dict(context),
                        stream_mode="values",
                    )
                except TypeError as exc:
                    if "context" not in str(exc):
                        raise
                    stream = graph.stream(
                        graph_input, config=config, stream_mode="values"
                    )
                interrupted = False
                last_chunk: Any = None
                # Governed provider/tool calls observe the native run cancellation.
                cancel_token = (
                    active_agent_stream_cancel.set(cancel_event)
                    if cancel_event is not None
                    else None
                )
                try:
                    for chunk in stream:
                        last_chunk = chunk
                        if cancel_event is not None and cancel_event.is_set():
                            interrupted = True
                            break
                except (AgentStreamInterrupted, asyncio.CancelledError):
                    interrupted = True
                finally:
                    close = getattr(stream, "close", None)
                    try:
                        if callable(close):
                            close()
                    finally:
                        if cancel_token is not None:
                            active_agent_stream_cancel.reset(cancel_token)
                snapshot = graph.get_state(config)
                if interrupted and getattr(snapshot, "created_at", None) and not getattr(snapshot, "next", ()):
                    # Completion wins a late Stop; there is no pending checkpoint
                    # to advertise as resumable work.
                    interrupted = False
                values = dict(getattr(snapshot, "values", {}) or {})
                self._update_thread_values(thread_id, values)
                return last_chunk, interrupted
            finally:
                self._set_thread_status(thread_id, "idle")

    def _execute_run(
        self,
        thread_id: str,
        run_id: str,
        payload: Mapping[str, Any],
    ) -> None:
        with self._database_thread_lock(thread_id):
            saved = self._store.get((RUN_NAMESPACE, thread_id), run_id)
            if saved is not None and saved.value["run"]["status"] not in {"pending", "running"}:
                with self._lock:
                    self._runs[(thread_id, run_id)] = dict(saved.value["run"])
                return
            self._execute_owned_run(thread_id, run_id, payload)

    def _execute_owned_run(self, thread_id: str, run_id: str, payload: Mapping[str, Any]) -> None:
        self._set_run_status(thread_id, run_id, "running")
        key = (thread_id, run_id)
        with self._lock:
            cancel_event = self._cancel_events.get(key)
        context = dict(payload.get("context") or {})
        context.setdefault("logical_run_id", run_id)
        payload = {**payload, "context": context}
        run_token = active_runtime_run_id.set(run_id)
        try:
            _result, interrupted = self._run_graph(
                thread_id, payload, cancel_event=cancel_event
            )
        except Exception as exc:
            logger.exception(
                "LCSP local Agent Server asynchronous run failed",
                extra={"thread_id": thread_id, "run_id": run_id},
            )
            self._update_thread_error(thread_id, exc)
            self._set_thread_status(thread_id, "error")
            self._set_run_status(thread_id, run_id, "error")
            return
        finally:
            active_runtime_run_id.reset(run_token)
        self._set_run_status(
            thread_id, run_id, "interrupted" if interrupted else "success"
        )

    def get_state(self, thread_id: str) -> dict[str, Any]:
        self.create_thread({"thread_id": thread_id, "if_exists": "do_nothing"})
        graph = self._graph()
        config = {"configurable": {"thread_id": thread_id}}
        try:
            snapshot = graph.get_state(config)
            values = dict(getattr(snapshot, "values", {}) or {})
            thread = self.get_thread(thread_id) or {}
            thread_error = (thread.get("values") or {}).get("__error__")
            if thread_error is not None:
                values.setdefault("__error__", thread_error)
            metadata = getattr(snapshot, "metadata", {}) or {}
            next_nodes = list(getattr(snapshot, "next", ()) or ())
            checkpoint = _checkpoint_from_config(getattr(snapshot, "config", None))
            parent_config = _checkpoint_from_config(
                getattr(snapshot, "parent_config", None)
            )
        except Exception:
            thread = self.get_thread(thread_id) or {}
            values = dict(thread.get("values") or {})
            metadata = {}
            next_nodes = []
            checkpoint = None
            parent_config = None
        return _json_ready(
            {
                "values": values,
                "next": next_nodes,
                "tasks": [],
                "metadata": metadata,
                "checkpoint": checkpoint,
                "parent_config": parent_config,
            }
        )

    def _open_checkpointer(self) -> object | None:
        configured = (
            os.environ.get("LANGGRAPH_CHECKPOINT_DATABASE_URL")
            or os.environ.get("POSTGRES_URI")
            or os.environ.get("DATABASE_URL")
            or ""
        )
        checkpoint_url = checkpoint_database_url(configured)
        self._database_url = checkpoint_url or None
        if not checkpoint_url:
            if _production_mode():
                raise RuntimeError(
                    "production LCSP Agent Runtime requires "
                    "LANGGRAPH_CHECKPOINT_DATABASE_URL"
                )
            from langgraph.checkpoint.memory import InMemorySaver

            return InMemorySaver()
        from langgraph.checkpoint.postgres import PostgresSaver

        self._checkpointer_context = PostgresSaver.from_conn_string(checkpoint_url)
        self._checkpointer = self._checkpointer_context.__enter__()
        self._checkpointer.setup()
        return self._checkpointer

    def _graph(self):
        if self.graph is None:
            raise RuntimeError("LCSP local agent runtime has not started")
        return self.graph

    def _thread_lock(self, thread_id: str) -> threading.Lock:
        with self._lock:
            return self._locks.setdefault(thread_id, threading.Lock())

    def _set_thread_status(self, thread_id: str, status: str) -> None:
        with self._lock:
            thread = self._threads.setdefault(
                thread_id,
                {
                    "thread_id": thread_id,
                    "created_at": _now(),
                    "metadata": {},
                    "values": {},
                },
            )
            thread["status"] = status
            thread["updated_at"] = _now()

    def _set_run_status(self, thread_id: str, run_id: str, status: str) -> None:
        with self._lock:
            run = self._runs.get((thread_id, run_id))
            if run is None:
                return
            run["status"] = status
            run["updated_at"] = _now()
            if status not in {"pending", "running"}:
                self._run_payloads.pop((thread_id, run_id), None)
            self._save_run((thread_id, run_id))

    def _update_thread_error(self, thread_id: str, exc: BaseException) -> None:
        with self._lock:
            thread = self._threads.get(thread_id)
            if thread is None:
                return
            values = dict(thread.get("values") or {})
            values["__error__"] = {
                "error": type(exc).__name__,
                "message": str(exc),
            }
            thread["values"] = values
            thread["updated_at"] = _now()

    def _update_thread_values(self, thread_id: str, values: Mapping[str, Any]) -> None:
        with self._lock:
            thread = self._threads.setdefault(
                thread_id,
                {
                    "thread_id": thread_id,
                    "created_at": _now(),
                    "metadata": {},
                    "status": "idle",
                },
            )
            thread["values"] = _json_ready(dict(values))
            thread["updated_at"] = _now()


@asynccontextmanager
async def lifespan(app: Starlette):
    runtime = LocalAgentRuntime()
    runtime.start()
    app.state.runtime = runtime
    try:
        yield
    finally:
        runtime.close()


async def ok(_request: Request) -> JSONResponse:
    return JSONResponse({"ok": True})


async def create_thread(request: Request) -> JSONResponse:
    runtime: LocalAgentRuntime = request.app.state.runtime
    payload = await request.json()
    try:
        return JSONResponse(_json_ready(runtime.create_thread(payload)))
    except PermissionError:
        return JSONResponse({"error": "thread not found"}, status_code=404)


async def get_thread(request: Request) -> JSONResponse:
    runtime: LocalAgentRuntime = request.app.state.runtime
    thread_id = request.path_params["thread_id"]
    thread = runtime.get_thread(thread_id)
    if thread is None:
        return JSONResponse({"error": "thread not found"}, status_code=404)
    return JSONResponse(_json_ready(thread))


async def wait_for_run(request: Request) -> JSONResponse:
    runtime: LocalAgentRuntime = request.app.state.runtime
    thread_id = request.path_params["thread_id"]
    payload = await request.json()
    try:
        result = await anyio.to_thread.run_sync(runtime.wait_for_run, thread_id, payload)
    except PermissionError:
        return JSONResponse({"error": "thread not found"}, status_code=404)
    except Exception as exc:
        logger.exception("LCSP local Agent Server run failed")
        return JSONResponse(
            {
                "error": type(exc).__name__,
                "detail": str(exc),
            },
            status_code=500,
        )
    return JSONResponse(_json_ready(result))


async def create_run(request: Request) -> JSONResponse:
    runtime: LocalAgentRuntime = request.app.state.runtime
    thread_id = request.path_params["thread_id"]
    payload = await request.json()
    try:
        return JSONResponse(_json_ready(runtime.create_run(thread_id, payload)))
    except PermissionError:
        return JSONResponse({"error": "thread not found"}, status_code=404)


async def list_runs(request: Request) -> JSONResponse:
    runtime: LocalAgentRuntime = request.app.state.runtime
    thread_id = request.path_params["thread_id"]
    return JSONResponse(_json_ready(runtime.list_runs(thread_id)))


async def get_run(request: Request) -> JSONResponse:
    runtime: LocalAgentRuntime = request.app.state.runtime
    thread_id = request.path_params["thread_id"]
    run_id = request.path_params["run_id"]
    run = runtime.get_run(thread_id, run_id)
    if run is None:
        return JSONResponse({"error": "run not found"}, status_code=404)
    return JSONResponse(_json_ready(run))


async def cancel_run(request: Request) -> JSONResponse:
    runtime: LocalAgentRuntime = request.app.state.runtime
    thread_id = request.path_params["thread_id"]
    run_id = request.path_params["run_id"]
    run = runtime.cancel_run(thread_id, run_id)
    if run is None:
        return JSONResponse({"error": "run not found"}, status_code=404)
    return JSONResponse(_json_ready(run))


async def get_state(request: Request) -> JSONResponse:
    runtime: LocalAgentRuntime = request.app.state.runtime
    thread_id = request.path_params["thread_id"]
    try:
        return JSONResponse(runtime.get_state(thread_id))
    except PermissionError:
        return JSONResponse({"error": "thread not found"}, status_code=404)


class AssessmentErasureRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    assessmentId: str = Field(pattern=r"^[A-Za-z0-9_-]{1,300}$")
    ownerId: str = Field(pattern=r"^[A-Za-z0-9_-]{1,300}$")
    threadId: str = Field(pattern=r"^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$")


async def erase_assessment(request: Request) -> JSONResponse:
    key = os.environ.get("WORKER_API_KEY", "")
    if not key or not hmac.compare_digest(request.headers.get("x-worker-api-key", ""), key):
        return JSONResponse({"erased": False}, status_code=403)
    try:
        payload = AssessmentErasureRequest.model_validate(await request.json())
    except (ValueError, ValidationError):
        return JSONResponse({"erased": False}, status_code=400)
    runtime: LocalAgentRuntime = request.app.state.runtime
    try:
        await anyio.to_thread.run_sync(runtime.erase_assessment, payload.assessmentId, payload.ownerId, payload.threadId)
    except Exception:
        # No checkpoint, sandbox, provider, or customer content in cleanup responses.
        return JSONResponse({"erased": False}, status_code=409)
    return JSONResponse({"erased": True})


app = Starlette(
    lifespan=lifespan,
    routes=[
        Route("/ok", ok, methods=["GET"]),
        Route("/health", ok, methods=["GET"]),
        Route("/internal/assessment-erasure", erase_assessment, methods=["POST"]),
        Route("/threads", create_thread, methods=["POST"]),
        Route("/threads/{thread_id}", get_thread, methods=["GET"]),
        Route("/threads/{thread_id}/runs", create_run, methods=["POST"]),
        Route("/threads/{thread_id}/runs", list_runs, methods=["GET"]),
        Route("/threads/{thread_id}/runs/wait", wait_for_run, methods=["POST"]),
        Route(
            "/threads/{thread_id}/runs/{run_id}",
            get_run,
            methods=["GET"],
        ),
        Route(
            "/threads/{thread_id}/runs/{run_id}/cancel",
            cancel_run,
            methods=["POST"],
        ),
        Route("/threads/{thread_id}/state", get_state, methods=["GET"]),
    ],
)


def _runtime_config(
    thread_id: str,
    config: object,
    metadata: object,
    context: Mapping[str, Any],
) -> dict[str, Any]:
    runtime_config = agent_graph_config(config if isinstance(config, Mapping) else None)
    configurable = dict(runtime_config.get("configurable") or {})
    configurable["thread_id"] = thread_id
    for key, value in context.items():
        if isinstance(value, (str, int, float, bool)) and value is not None:
            configurable.setdefault(key, value)
    configurable.setdefault("cwd", "/workspace/repository")
    runtime_config["configurable"] = configurable
    runtime_metadata = dict(runtime_config.get("metadata") or {})
    if isinstance(metadata, Mapping):
        runtime_metadata.update(dict(metadata))
    runtime_config["metadata"] = runtime_metadata
    if active_runtime_run_id.get():
        runtime_metadata["lcsp_runtime_run_id"] = active_runtime_run_id.get()
    return runtime_config


def _checkpoint_from_config(config: object) -> dict[str, Any] | None:
    if not isinstance(config, Mapping):
        return None
    configurable = config.get("configurable")
    if not isinstance(configurable, Mapping):
        return None
    checkpoint = {
        key: configurable.get(key)
        for key in ("thread_id", "checkpoint_ns", "checkpoint_id")
        if configurable.get(key) is not None
    }
    return checkpoint or None


def _json_ready(value: Any) -> Any:
    if isinstance(value, BaseMessage):
        return message_to_dict(value)
    if is_dataclass(value):
        return _json_ready(asdict(value))
    if isinstance(value, Mapping):
        return {str(key): _json_ready(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_ready(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        return _json_ready(model_dump(mode="json"))
    return str(value)


def _text(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _now() -> str:
    return datetime.now(tz=UTC).isoformat()


def _run_worker_count() -> int:
    raw = os.environ.get("LCSP_AGENT_RUNTIME_JOBS_PER_WORKER", "8").strip()
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(
            "LCSP_AGENT_RUNTIME_JOBS_PER_WORKER must be a positive integer"
        ) from exc
    if value < 1 or value > 64:
        raise RuntimeError(
            "LCSP_AGENT_RUNTIME_JOBS_PER_WORKER must be between 1 and 64"
        )
    return value


def _production_mode() -> bool:
    mode = os.environ.get("LCSP_AGENT_RUNTIME_MODE", "").strip().lower()
    return mode == "production" or os.environ.get("NODE_ENV", "").strip().lower() == "production"


def main() -> None:
    host = os.environ.get("LCSP_AGENT_RUNTIME_HOST", DEFAULT_HOST)
    port = int(os.environ.get("PORT") or os.environ.get("LCSP_AGENT_RUNTIME_PORT") or DEFAULT_PORT)
    uvicorn.run(
        "tools.common.capabilities.agent_runtime.local_server:app",
        host=host,
        port=port,
        reload=False,
        factory=False,
    )


if __name__ == "__main__":
    main()


__all__ = ["LocalAgentRuntime", "app", "main"]
