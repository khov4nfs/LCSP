"""Dispatch trusted broker events inside the local Deep Agents thread run."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import asdict
from threading import Event, Timer
from typing import Any, Mapping

from langchain.agents.middleware import AgentMiddleware, hook_config
from langgraph.config import get_config

from orchestration.context import LCSPRunContext
from orchestration.runtime_control import (
    NativeExecutionScope,
    active_native_execution_scope,
    active_runtime_run_id,
    hosted_checkpoint_scope,
)
from tools.common.capabilities.agent_runtime.runtime_control import report_runtime_control
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
from tools.common.capabilities.platform.callback_schemas import (
    SCAN_CALLBACK_STATUSES,
    ScanCallbackPayload,
)
from tools.common.capabilities.platform.codebase_memory import (
    ensure_codebase_memory_index,
)
from tools.common.capabilities.platform.config import load_config
from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.platform.repository_sandbox import (
    activate_repository_backend,
    ensure_repository_for_event,
    resolve_repository_thread_backend,
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
    """Apply the same native cancellation/registration scope in langgraph dev."""
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
    frozen_context = asdict(context)
    frozen_context["logical_run_id"] = context.logical_run_id or run_id
    execution_scope = NativeExecutionScope()
    run_token = active_runtime_run_id.set(run_id)
    execution_token = active_native_execution_scope.set(execution_scope)
    try:
        control = report_runtime_control(thread_id, run_id, frozen_context, "RUNNING")
        if control.get("state") in {"STOP_REQUESTED", "STOPPED", "RESUME_REQUESTED", "COMPLETED"}:
            # Re-execution of the same cancelled generation is not Continue.
            # A fresh native generation is required to resume its checkpoints.
            active_agent_stream_cancel.get().set()
            raise asyncio.CancelledError("Native runtime generation already stopped")
        with hosted_checkpoint_scope(thread_id, frozen_context["logical_run_id"]):
            try:
                return _dispatch_system_event(state, runtime)
            finally:
                execution_scope.drain()
    finally:
        active_native_execution_scope.reset(execution_token)
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
        if context.system_boundary_name == "scan_requested":
            scan_job_id = _event_text(context.system_event, "scanJobId", "scan_job_id")
            client = _worker_client()
            if scan_job_id and client is not None:
                client.post_scan_terminal_failure(
                    scan_job_id,
                    {
                        "boundary_name": context.system_boundary_name,
                        "reason_code": _BOUNDARY_TIMEOUT_CODE,
                        "status": "FAILED",
                        "summary": "LangGraph repository run expired before execution started",
                        "timeout_seconds": None,
                        "correlation_id": correlation_id,
                    },
                )
        else:
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

    backend = resolve_repository_thread_backend(_repository_config(runtime))
    correlation_id = (
        context.correlation_id
        or _event_text(context.system_event, "correlationId", "correlation_id")
        or context.system_boundary_name
    )
    scan_job_id = _event_text(context.system_event, "scanJobId", "scan_job_id")
    client = _worker_client()
    _post_scan_runtime_event(
        client,
        scan_job_id,
        event_type="RUN_STARTED",
        run_status="RUNNING",
        summary="Repository scan runtime accepted the scan job",
    )
    lifecycle = lambda event: _post_repository_lifecycle_event(  # noqa: E731
        client,
        scan_job_id,
        event,
    )
    try:
        ensure_repository_for_event(
            backend,
            context.system_boundary_name,
            context.system_event,
            lifecycle=lifecycle,
        )
        # Agents query the repository through the Codebase Memory graph; index
        # the hydrated snapshot before any of them starts (reused if current).
        ensure_codebase_memory_index(backend, lifecycle=lifecycle)
    except Exception as exc:
        _post_repository_hydration_failed(client, scan_job_id, exc)
        if context.system_boundary_name == "scan_requested" and scan_job_id:
            try:
                _post_failed_scan_callback(client, scan_job_id)
            except Exception:
                pass
        raise
    with activate_repository_backend(backend):
        check_agent_execution_active()
        invoke_boundary(
            context.system_boundary_name,
            dict(context.system_event),
            correlation_id,
        )
    return {"jump_to": "end"}


dispatch_agent_runtime_system_event = _SystemEventDispatchMiddleware()


def _context(value: object) -> LCSPRunContext | None:
    if isinstance(value, LCSPRunContext):
        return value
    if isinstance(value, Mapping):
        return LCSPRunContext(**dict(value))
    return None


def _worker_client() -> WorkerApiClient | None:
    try:
        config = load_config()
    except Exception:
        return None
    return WorkerApiClient(config.nestjs_api_base_url, config.worker_api_key)


def _post_scan_runtime_event(
    client: WorkerApiClient | None,
    scan_job_id: str | None,
    *,
    event_type: str,
    run_status: str,
    summary: str,
    tool_name: str | None = None,
    error_summary: str | None = None,
    output_summary: Mapping[str, Any] | None = None,
) -> None:
    if client is None or not scan_job_id:
        return
    payload: dict[str, Any] = {
        "event_type": event_type,
        "run_status": run_status,
        "stage": "SCAN",
        "summary": summary,
    }
    if tool_name:
        payload["tool_name"] = tool_name
    if error_summary:
        payload["error_summary"] = error_summary
    if output_summary:
        payload["output_summary"] = dict(output_summary)
    client.post_scan_runtime_event(scan_job_id, payload)


def _post_repository_lifecycle_event(
    client: WorkerApiClient | None,
    scan_job_id: str | None,
    event: str,
) -> None:
    mapping = {
        "repository_archive_downloading": {
            "event_type": "TOOL_STARTED",
            "run_status": "RUNNING",
            "tool_name": "repository_archive_download",
            "summary": "Downloading repository archive",
        },
        "repository_archive_downloaded": {
            "event_type": "TOOL_COMPLETED",
            "run_status": "RUNNING",
            "tool_name": "repository_archive_download",
            "summary": "Repository archive downloaded",
        },
        "repository_sandbox_hydrating": {
            "event_type": "TOOL_STARTED",
            "run_status": "RUNNING",
            "tool_name": "repository_sandbox_hydration",
            "summary": "Hydrating repository archive into Docker sandbox",
        },
        "repository_sandbox_hydrated": {
            "event_type": "TOOL_COMPLETED",
            "run_status": "RUNNING",
            "tool_name": "repository_sandbox_hydration",
            "summary": "Repository sandbox hydrated",
        },
        "repository_sandbox_reused": {
            "event_type": "TOOL_COMPLETED",
            "run_status": "RUNNING",
            "tool_name": "repository_sandbox_hydration",
            "summary": "Repository sandbox already hydrated",
        },
        "codebase_memory_indexing": {
            "event_type": "TOOL_STARTED",
            "run_status": "RUNNING",
            "tool_name": "codebase_memory_index",
            "summary": "Indexing repository into Codebase Memory graph",
        },
        "codebase_memory_indexed": {
            "event_type": "TOOL_COMPLETED",
            "run_status": "RUNNING",
            "tool_name": "codebase_memory_index",
            "summary": "Codebase Memory graph indexed",
        },
        "codebase_memory_index_reused": {
            "event_type": "TOOL_COMPLETED",
            "run_status": "RUNNING",
            "tool_name": "codebase_memory_index",
            "summary": "Codebase Memory graph already indexed",
        },
        "codebase_memory_index_failed": {
            "event_type": "TOOL_FAILED",
            "run_status": "FAILED",
            "tool_name": "codebase_memory_index",
            "summary": "Codebase Memory graph indexing failed",
        },
    }
    payload = mapping.get(event)
    if payload:
        _post_scan_runtime_event(client, scan_job_id, **payload)


def _post_repository_hydration_failed(
    client: WorkerApiClient | None,
    scan_job_id: str | None,
    exc: Exception,
) -> None:
    error_summary = (
        "Repository sandbox hydration failed before source analysis started"
    )
    _post_scan_runtime_event(
        client,
        scan_job_id,
        event_type="TOOL_FAILED",
        run_status="FAILED",
        tool_name="repository_sandbox_hydration",
        summary="Repository sandbox hydration failed",
        error_summary=error_summary,
        output_summary={"errorType": type(exc).__name__},
    )
    _post_scan_runtime_event(
        client,
        scan_job_id,
        event_type="RUN_FAILED",
        run_status="FAILED",
        summary="Repository scan failed before source analysis started",
        error_summary=error_summary,
        output_summary={"errorCode": "REPOSITORY_SANDBOX_HYDRATION_FAILED"},
    )


def _post_failed_scan_callback(
    client: WorkerApiClient | None,
    scan_job_id: str,
) -> None:
    if client is None:
        return
    client.post_scan_callback(
        scan_job_id,
        ScanCallbackPayload(
            scan_job_id=scan_job_id,
            status=SCAN_CALLBACK_STATUSES["failed"],
            tools_version={},
            config_hash={},
            evidence_payload={
                "failure": {
                    "code": "REPOSITORY_SANDBOX_HYDRATION_FAILED",
                    "phase": "REPOSITORY_SANDBOX_HYDRATING",
                }
            },
            privacy_flags={
                "containsSourceCode": False,
                "secretsRedacted": True,
                "sourceStrippedFromFindings": True,
            },
            error_code="REPOSITORY_SANDBOX_HYDRATION_FAILED",
        ),
    )


def _repository_config(runtime: Any) -> dict[str, dict[str, str]]:
    config = getattr(runtime, "config", None)
    if isinstance(config, dict) and isinstance(config.get("configurable"), dict):
        configurable = config["configurable"]
        if configurable.get("thread_id"):
            return config

    context = _context(getattr(runtime, "context", None))
    if context is None or not context.thread_id:
        return {"configurable": {}}

    event = context.system_event if isinstance(context.system_event, dict) else {}
    configurable = {
        "thread_id": context.thread_id,
        "cwd": "/workspace/repository",
    }
    _copy_if_present(configurable, "assessment_id", context.assessment_id)
    _copy_if_present(
        configurable,
        "snapshot_id",
        context.snapshot_id or _event_text(event, "snapshotId", "snapshot_id"),
    )
    _copy_if_present(
        configurable,
        "scan_job_id",
        context.scan_job_id or _event_text(event, "scanJobId", "scan_job_id"),
    )
    _copy_if_present(
        configurable,
        "commit_sha",
        context.commit_sha or _event_text(event, "commitSha", "commit_sha"),
    )
    return {"configurable": configurable}


def _copy_if_present(target: dict[str, str], key: str, value: str | None) -> None:
    if value:
        target[key] = value


def _event_text(event: Mapping[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = event.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


__all__ = ["dispatch_agent_runtime_system_event"]
