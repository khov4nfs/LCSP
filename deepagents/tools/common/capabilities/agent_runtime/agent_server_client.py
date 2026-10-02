"""Submit broker events into the local LangGraph Agent Server."""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from typing import Any, Mapping
from uuid import UUID, uuid5

import httpx
from langgraph_sdk import get_sync_client

from tools.common.capabilities.agent_runtime.boundary import (
    NonRetryableAgentBoundaryError,
)
from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.platform.config import load_config


DEFAULT_AGENT_SERVER_URL = "http://127.0.0.1:2024"
DEFAULT_ASSISTANT_ID = "lcsp-agent"
DEFAULT_AGENT_SERVER_POLL_SECONDS = 0.5
DEFAULT_AGENT_SERVER_PENDING_HEARTBEAT_SECONDS = 10.0
_THREAD_NAMESPACE = UUID("b7b26975-09de-44e5-a7d5-c996523fd289")
_ACTIVE_RUN_STATUSES = {"pending", "running"}


class AgentServerRunError(NonRetryableAgentBoundaryError):
    """Terminal error returned by a completed Agent Server run."""

    def __init__(self, remote_error_type: str, message: str) -> None:
        self.remote_error_type = remote_error_type or "AgentServerRunError"
        self.remote_message = message or "Agent Server run failed"
        super().__init__(f"{self.remote_error_type}: {self.remote_message}")


# Boundaries whose command only signals a cooperative interrupt of another
# boundary's already-active run. These must never create their own Agent Server
# run: with multitask_strategy="enqueue" that run would simply queue behind the
# very run it exists to stop, arriving only after that run already finished.
_INTERRUPT_TARGET_BOUNDARIES_BY_COMMAND_BOUNDARY: dict[str, tuple[str, ...]] = {
    # The customer's stop covers whatever the assessment is running: an
    # Interview turn, or the per-rule Repository Analyst engineering assessment.
    "assessment_interview_pause_requested": (
        "assessment_interview_resume_requested",
        "engineering_assessment_requested",
    ),
}
# Run status LangGraph reports after ``runs.cancel(action="interrupt")``.
_INTERRUPTED_RUN_STATUS = "interrupted"


def _run_budget_seconds(timeout_seconds: float | None) -> float | None:
    """The boundary's opt-in deadline, else an explicit operator override, else none."""
    if timeout_seconds is not None and timeout_seconds > 0:
        return timeout_seconds
    override = _positive_float_env("LCSP_AGENT_SERVER_RUN_TIMEOUT_SECONDS", 0.0)
    return override or None


def dispatch_agent_runtime_event(
    boundary_name: str,
    message: dict[str, Any],
    correlation_id: str,
    *,
    timeout_seconds: float | None = None,
) -> dict[str, Any] | list[dict[str, Any]]:
    """Create/reuse one assessment thread and synchronously execute the system event.

    The run is created asynchronously and then polled instead of holding one long
    runs.wait request. This exposes scheduler delay, detects terminal errors
    promptly, and lets the boundary deadline interrupt the actual LangGraph run.
    """
    interrupt_targets = _INTERRUPT_TARGET_BOUNDARIES_BY_COMMAND_BOUNDARY.get(
        boundary_name
    )
    if interrupt_targets is not None:
        for interrupt_target in interrupt_targets:
            interrupt_agent_runtime_run(interrupt_target, message, correlation_id)
        return {"status": "interrupt_requested"}

    # No deadline unless the boundary opted into one: agent runs take as long
    # as their reasoning needs.
    budget = _run_budget_seconds(timeout_seconds)
    deadline_at = time.time() + budget if budget is not None else None
    started_at = time.monotonic()
    thread_id = agent_thread_id(boundary_name, message, correlation_id)
    assessment_id = _find_text(message, "assessmentId", "assessment_id")
    workflow_run_id = _find_text(
        message,
        "workflowRunId",
        "workflow_run_id",
        "runId",
        "run_id",
        "scanJobId",
        "scan_job_id",
    )

    context = {
        "assessment_id": assessment_id,
        "workflow_run_id": workflow_run_id,
        "thread_id": thread_id,
        "snapshot_id": _find_text(message, "snapshotId", "snapshot_id"),
        "scan_job_id": _find_text(message, "scanJobId", "scan_job_id"),
        "commit_sha": _find_text(message, "commitSha", "commit_sha"),
        "correlation_id": correlation_id,
        "system_boundary_name": boundary_name,
        "system_deadline_at": deadline_at,
        "system_event": message,
        "repository_path": "/",
    }

    client = get_sync_client(
        url=os.getenv("LCSP_AGENT_SERVER_URL", DEFAULT_AGENT_SERVER_URL),
        timeout=30,
    )
    metadata = {"lcspAgentRuntimeThread": True}
    if assessment_id:
        metadata["assessmentId"] = assessment_id

    client.threads.create(
        thread_id=thread_id,
        if_exists="do_nothing",
        metadata=metadata,
    )
    run = _find_active_thread_run(client, thread_id, boundary_name)
    reused_active_run = run is not None
    if run is None:
        run = client.runs.create(
            thread_id,
            os.getenv("LCSP_AGENT_ASSISTANT_ID", DEFAULT_ASSISTANT_ID),
            input={
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "A trusted LCSP system event is present in runtime context. "
                            "Root middleware dispatches it before model invocation. "
                            "Do not copy the event payload into messages and do not invent "
                            "repository evidence."
                        ),
                    }
                ]
            },
            context=context,
            metadata={
                "lcsp_boundary_name": boundary_name,
                "correlation_id": correlation_id,
                "assessment_id": assessment_id,
            },
            multitask_strategy="enqueue",
            on_completion="keep",
        )
    run_id = _find_text(run, "run_id", "runId")
    if not run_id:
        raise AgentServerRunError(
            "AgentServerRunCreateError",
            "Agent Server did not return a run id",
        )

    observer = _ScanRunObserver(message)
    observer.emit(
        event_type="TOOL_STARTED",
        run_status="RUNNING",
        summary=(
            "Reattached to active LangGraph repository run"
            if reused_active_run
            else "LangGraph repository run queued"
        ),
        output_summary={
            "runId": run_id,
            "schedulerState": _run_status(run, "pending"),
            "reusedActiveRun": reused_active_run,
        },
    )

    return _poll_run_until_terminal(
        client,
        thread_id=thread_id,
        run_id=run_id,
        run=run,
        observer=observer,
        timeout_seconds=(
            max(0.001, budget - (time.monotonic() - started_at))
            if budget is not None
            else None
        ),
    )


def _poll_run_until_terminal(
    client: Any,
    *,
    thread_id: str,
    run_id: str,
    run: Mapping[str, Any],
    observer: "_ScanRunObserver",
    timeout_seconds: float | None,
) -> Any:
    """Poll a created/reused run to a terminal state and return its result values."""
    deadline_seconds = _run_budget_seconds(timeout_seconds)
    poll_seconds = _positive_float_env(
        "LCSP_AGENT_SERVER_POLL_SECONDS",
        DEFAULT_AGENT_SERVER_POLL_SECONDS,
    )
    pending_heartbeat_seconds = _positive_float_env(
        "LCSP_AGENT_SERVER_PENDING_HEARTBEAT_SECONDS",
        DEFAULT_AGENT_SERVER_PENDING_HEARTBEAT_SECONDS,
    )
    started_at = time.monotonic()
    next_heartbeat_at = started_at + pending_heartbeat_seconds
    last_status = _run_status(run, "pending")

    while last_status in _ACTIVE_RUN_STATUSES:
        now = time.monotonic()
        if deadline_seconds is not None and now - started_at >= deadline_seconds:
            client.runs.cancel(
                thread_id,
                run_id,
                wait=False,
                action="interrupt",
            )
            observer.emit(
                event_type="TOOL_FAILED",
                run_status="FAILED",
                summary="LangGraph repository run exceeded boundary deadline",
                error_summary="AGENT_RUNTIME_BOUNDARY_TIMEOUT",
                output_summary={"runId": run_id},
            )
            raise AgentServerRunError(
                "AgentServerRunTimeout",
                f"Agent Server run exceeded {deadline_seconds:.1f}s deadline",
            )

        if now >= next_heartbeat_at:
            observer.emit(
                event_type="TOOL_COMPLETED",
                run_status="RUNNING",
                summary=(
                    "LangGraph repository run waiting for scheduler"
                    if last_status == "pending"
                    else "LangGraph repository run executing"
                ),
                output_summary={
                    "runId": run_id,
                    "schedulerState": last_status,
                    "elapsedSeconds": int(now - started_at),
                },
            )
            next_heartbeat_at = now + pending_heartbeat_seconds

        time.sleep(poll_seconds)
        try:
            run = client.runs.get(thread_id, run_id)
        except httpx.TimeoutException:
            timeout_at = time.monotonic()
            if timeout_at >= next_heartbeat_at:
                observer.emit(
                    event_type="TOOL_COMPLETED",
                    run_status="RUNNING",
                    summary="LangGraph repository run status poll timed out; keeping existing run binding",
                    error_summary="AGENT_RUNTIME_RUN_POLL_TIMEOUT",
                    output_summary={
                        "runId": run_id,
                        "schedulerState": last_status,
                        "elapsedSeconds": int(timeout_at - started_at),
                    },
                )
                next_heartbeat_at = timeout_at + pending_heartbeat_seconds
            continue
        current_status = _run_status(run, last_status)
        if current_status != last_status:
            observer.emit(
                event_type="TOOL_COMPLETED",
                run_status=(
                    "RUNNING"
                    if current_status in _ACTIVE_RUN_STATUSES
                    else ("COMPLETED" if current_status == "success" else "FAILED")
                ),
                summary=f"LangGraph repository run state: {current_status}",
                output_summary={
                    "runId": run_id,
                    "schedulerState": current_status,
                },
            )
        last_status = current_status

    if last_status == _INTERRUPTED_RUN_STATUS:
        # A customer stop, not a failure: settle the delivery without a retry
        # so the stopped work does not restart until the customer continues.
        return {"status": "INTERRUPTED", "runId": run_id}
    state = client.threads.get_state(thread_id)
    if last_status != "success":
        _raise_for_terminal_run(last_status, state)
    result = state.get("values", state) if isinstance(state, Mapping) else state
    _raise_for_agent_server_error(result)
    return result


def interrupt_agent_runtime_run(
    boundary_name: str,
    message: dict[str, Any],
    correlation_id: str,
) -> None:
    """Cooperatively interrupt the active run for this boundary's thread, if any.

    Fire-and-forget: ``action="interrupt"`` never deletes checkpoints, so the
    LangGraph checkpointer keeps the state as of the last completed superstep
    and the thread stays resumable via :func:`resume_agent_runtime_run`. A race
    where the turn already finished before this call lands is not an error.
    """
    thread_id = agent_thread_id(boundary_name, message, correlation_id)
    client = get_sync_client(
        url=os.getenv("LCSP_AGENT_SERVER_URL", DEFAULT_AGENT_SERVER_URL),
        timeout=30,
    )
    run = _find_active_thread_run(client, thread_id, boundary_name)
    if run is None:
        return
    run_id = _find_text(run, "run_id", "runId")
    if not run_id:
        return
    client.runs.cancel(thread_id, run_id, wait=False, action="interrupt")


def resume_agent_runtime_run(
    boundary_name: str,
    message: dict[str, Any],
    correlation_id: str,
    *,
    timeout_seconds: float | None = None,
) -> dict[str, Any] | list[dict[str, Any]]:
    """Continue a previously interrupted run from its last checkpoint.

    Recomputes the same deterministic thread id and creates a new run with no
    new input, so the graph resumes purely from checkpointed state (LangGraph's
    standard resume idiom) instead of appending another turn.
    """
    thread_id = agent_thread_id(boundary_name, message, correlation_id)
    assessment_id = _find_text(message, "assessmentId", "assessment_id")
    workflow_run_id = _find_text(
        message,
        "workflowRunId",
        "workflow_run_id",
        "runId",
        "run_id",
        "scanJobId",
        "scan_job_id",
    )
    context = {
        "assessment_id": assessment_id,
        "workflow_run_id": workflow_run_id,
        "thread_id": thread_id,
        "snapshot_id": _find_text(message, "snapshotId", "snapshot_id"),
        "scan_job_id": _find_text(message, "scanJobId", "scan_job_id"),
        "commit_sha": _find_text(message, "commitSha", "commit_sha"),
        "correlation_id": correlation_id,
        "system_boundary_name": boundary_name,
        "system_event": message,
        "repository_path": "/",
    }
    client = get_sync_client(
        url=os.getenv("LCSP_AGENT_SERVER_URL", DEFAULT_AGENT_SERVER_URL),
        timeout=30,
    )
    run = client.runs.create(
        thread_id,
        os.getenv("LCSP_AGENT_ASSISTANT_ID", DEFAULT_ASSISTANT_ID),
        input=None,
        context=context,
        metadata={
            "lcsp_boundary_name": boundary_name,
            "correlation_id": correlation_id,
            "assessment_id": assessment_id,
        },
        multitask_strategy="enqueue",
        on_completion="keep",
    )
    run_id = _find_text(run, "run_id", "runId")
    if not run_id:
        raise AgentServerRunError(
            "AgentServerRunCreateError",
            "Agent Server did not return a run id",
        )

    observer = _ScanRunObserver(message)
    observer.emit(
        event_type="TOOL_STARTED",
        run_status="RUNNING",
        summary="LangGraph repository run resumed from checkpoint",
        output_summary={
            "runId": run_id,
            "schedulerState": _run_status(run, "pending"),
        },
    )
    return _poll_run_until_terminal(
        client,
        thread_id=thread_id,
        run_id=run_id,
        run=run,
        observer=observer,
        timeout_seconds=timeout_seconds,
    )


class _ScanRunObserver:
    """Best-effort scan scheduler progress persisted for SSE/history replay."""

    def __init__(self, message: Mapping[str, Any]) -> None:
        self.scan_job_id = _find_text(message, "scanJobId", "scan_job_id")
        self.client: WorkerApiClient | None = None
        if not self.scan_job_id:
            return
        try:
            config = load_config()
            self.client = WorkerApiClient(
                config.nestjs_api_base_url,
                config.worker_api_key,
            )
        except Exception:
            self.client = None

    def emit(
        self,
        *,
        event_type: str,
        run_status: str,
        summary: str,
        error_summary: str | None = None,
        output_summary: Mapping[str, Any] | None = None,
    ) -> None:
        if self.client is None or not self.scan_job_id:
            return
        payload: dict[str, Any] = {
            "event_type": event_type,
            "run_status": run_status,
            "stage": "SCAN",
            "tool_name": "langgraph_run",
            "summary": summary,
        }
        if error_summary:
            payload["error_summary"] = error_summary
        if output_summary:
            payload["output_summary"] = dict(output_summary)
        self.client.post_scan_runtime_event(self.scan_job_id, payload)


def _find_active_thread_run(
    client: Any,
    thread_id: str,
    boundary_name: str,
) -> Mapping[str, Any] | None:
    """Return an already-running run for this boundary so redeliveries reattach.

    RabbitMQ can redeliver the same boundary when the local poller times out even
    though the remote LangGraph run is still alive. Reusing the active run keeps
    the scan job idempotent and avoids duplicate provider runs.
    """
    try:
        runs = client.runs.list(thread_id, limit=25)
    except Exception:
        return None
    for candidate in runs:
        if not isinstance(candidate, Mapping):
            continue
        metadata = candidate.get("metadata")
        if not isinstance(metadata, Mapping):
            continue
        candidate_boundary = metadata.get("lcsp_boundary_name")
        if candidate_boundary != boundary_name:
            continue
        if _run_status(candidate, "") in _ACTIVE_RUN_STATUSES:
            return candidate
    return None


def _run_status(run: Any, default: str) -> str:
    if not isinstance(run, Mapping):
        return default
    status = run.get("status")
    if isinstance(status, str) and status.strip():
        return status.strip().lower()
    return default


def _positive_float_env(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a positive number") from exc
    if value <= 0:
        raise RuntimeError(f"{name} must be a positive number")
    return value


def _raise_for_terminal_run(status: str, state: Any) -> None:
    raw_error: Any = None
    if isinstance(state, Mapping):
        raw_error = state.get("error") or state.get("__error__")
        values = state.get("values")
        if raw_error is None and isinstance(values, Mapping):
            raw_error = values.get("__error__")
    if isinstance(raw_error, Mapping):
        raise AgentServerRunError(
            str(raw_error.get("error") or "AgentServerRunError"),
            str(
                raw_error.get("message")
                or f"Agent Server run ended with status {status}"
            ),
        )
    raise AgentServerRunError(
        "AgentServerRunError",
        f"Agent Server run ended with status {status}",
    )


def _raise_for_agent_server_error(result: Any) -> None:
    if not isinstance(result, Mapping):
        return
    raw_error = result.get("__error__")
    if not isinstance(raw_error, Mapping):
        return
    remote_error_type = raw_error.get("error")
    message = raw_error.get("message")
    raise AgentServerRunError(
        str(remote_error_type or "AgentServerRunError"),
        str(message or "Agent Server run failed"),
    )


def reconcile_stale_agent_runs(*, server_url: str | None = None) -> int:
    """Interrupt persisted busy runs that predate the current Agent Server process."""
    url = (server_url or os.getenv("LCSP_AGENT_SERVER_URL", DEFAULT_AGENT_SERVER_URL)).rstrip("/")
    process_started_at = _agent_server_process_started_at(url)
    client = get_sync_client(url=url, timeout=10)
    cancelled = 0
    for thread in client.threads.search(status="busy", limit=100):
        thread_id = thread.get("thread_id")
        if not isinstance(thread_id, str) or not thread_id:
            continue
        for run in client.runs.list(thread_id, limit=100):
            if _run_status(run, "") not in _ACTIVE_RUN_STATUSES:
                continue
            run_id = run.get("run_id")
            created_at = _parse_datetime(run.get("created_at"))
            if (
                not isinstance(run_id, str)
                or not run_id
                or created_at is None
                or created_at >= process_started_at
            ):
                continue
            client.runs.cancel(
                thread_id,
                run_id,
                wait=False,
                action="interrupt",
            )
            cancelled += 1
    return cancelled


def _agent_server_process_started_at(server_url: str) -> datetime:
    response = httpx.get(f"{server_url}/metrics", timeout=2.0)
    response.raise_for_status()
    prefix = "process_start_time_seconds "
    for line in response.text.splitlines():
        if line.startswith(prefix):
            timestamp = float(line.removeprefix(prefix).strip())
            return datetime.fromtimestamp(timestamp, tz=timezone.utc)
    raise RuntimeError("Agent Server metrics did not expose process_start_time_seconds")


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def agent_thread_id(
    boundary_name: str,
    message: Mapping[str, Any],
    correlation_id: str,
) -> str:
    """Use stable LangGraph thread/sandbox identities for runtime boundaries."""
    if boundary_name == "scan_requested":
        scan_job_id = _find_text(message, "scanJobId", "scan_job_id")
        if scan_job_id:
            return str(uuid5(_THREAD_NAMESPACE, f"scan:{scan_job_id}"))
    assessment_id = _find_text(message, "assessmentId", "assessment_id")
    if assessment_id:
        seed = f"assessment:{assessment_id}"
    else:
        workflow_run_id = _find_text(
            message,
            "workflowRunId",
            "workflow_run_id",
            "runId",
            "run_id",
            "scanJobId",
            "scan_job_id",
        )
        seed = (
            f"workflow:{workflow_run_id}"
            if workflow_run_id
            else f"event:{boundary_name}:{correlation_id}"
        )
    return str(uuid5(_THREAD_NAMESPACE, seed))


def _find_text(value: Any, *keys: str, depth: int = 5) -> str | None:
    if depth < 0:
        return None
    if isinstance(value, Mapping):
        for key in keys:
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        for nested in value.values():
            found = _find_text(nested, *keys, depth=depth - 1)
            if found:
                return found
    elif isinstance(value, (list, tuple)):
        for nested in value[:50]:
            found = _find_text(nested, *keys, depth=depth - 1)
            if found:
                return found
    return None


__all__ = [
    "DEFAULT_AGENT_SERVER_URL",
    "DEFAULT_ASSISTANT_ID",
    "AgentServerRunError",
    "agent_thread_id",
    "dispatch_agent_runtime_event",
    "interrupt_agent_runtime_run",
    "reconcile_stale_agent_runs",
    "resume_agent_runtime_run",
]
