"""Submit broker events into the local LangGraph Agent Server."""

from __future__ import annotations

import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Mapping
from urllib.parse import urlsplit
from uuid import UUID, uuid5

import httpx
from langgraph_sdk import get_sync_client

from tools.common.capabilities.agent_runtime.boundary import (
    NonRetryableAgentBoundaryError,
    RetryableAgentBoundaryError,
)
from tools.common.capabilities.agent_runtime.root_capacity import (
    CAPACITY_UNAVAILABLE,
    ROOT_BOUNDARY,
    ROOT_COMMAND_OBSOLETE,
    RootCapacityUnavailable,
    RootCommandObsolete,
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


# Run status LangGraph reports after ``runs.cancel(action="interrupt")``.
_INTERRUPTED_RUN_STATUS = "interrupted"


def _create_bounded_run(client, *args, **kwargs):
    """Business purpose: Preserve admission refusal as queue backpressure rather than failed Assessment work.

    Business rules:
    - Only the server's exact operational capacity refusal becomes durable broker deferral.
    Execution flow:
    1. Create the native request, translating its typed 429 capacity response when present.
    Failure cases:
    - Other HTTP/provider/transport errors retain their existing failure handling.
    Side effects:
    - May create a native request; refusal schedules no native work or model call.
    """
    try:
        return client.runs.create(*args, **kwargs)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in {409, 429}:
            try:
                problem = exc.response.json()
                if isinstance(problem, dict) and problem.get("error") == CAPACITY_UNAVAILABLE:
                    raise RootCapacityUnavailable() from exc
                if isinstance(problem, dict) and problem.get("error") == ROOT_COMMAND_OBSOLETE:
                    raise RootCommandObsolete() from exc
            except ValueError:
                pass
        raise


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
    """Business purpose: Dispatch a durable boundary through one bounded native transport request.

    Business rules:
    - Only the same Root command can reattach active work; a new Continue waits for the preceding execution to quiesce.
    - Global capacity refusal defers delivery without failing the Assessment.
    - No deadline exists unless the existing boundary explicitly configures one.
    Execution flow:
    1. Resolve deterministic transport identity and immutable event context.
    2. Reattach or create a bounded run, then poll through terminal execution.
    Failure cases:
    - Typed capacity refusal propagates for durable broker deferral; existing timeout/terminal errors retain their policy.
    Side effects:
    - Creates/polls native transport work and established telemetry; RabbitMQ settlement stays on its connection thread.
    """
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

    from orchestration.context import resolve_response_language

    response_language = resolve_response_language(
        _find_text(message, "responseLanguage", "response_language", "locale", "language", "lcsp_locale")
        or (message.get("user") or {}).get("locale")
        or (message.get("metadata") or {}).get("locale")
        or (message.get("metadata") or {}).get("responseLanguage")
        or (message.get("runtimeContext") or {}).get("response_language")
        or (message.get("runtimeContext") or {}).get("responseLanguage")
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
        "response_language": response_language,
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
    command_key = _find_text(message, "idempotencyKey")
    if run is not None and boundary_name == ROOT_BOUNDARY and (
        not command_key or (run.get("metadata") or {}).get("lcsp_root_command_key") != command_key
    ):
        raise RootCapacityUnavailable()
    if run is None:
        run = _create_bounded_run(client,
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
                **({"lcsp_root_command_key": command_key} if boundary_name == ROOT_BOUNDARY else {}),
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


    return _poll_run_until_terminal(
        client,
        thread_id=thread_id,
        run_id=run_id,
        run=run,
        timeout_seconds=(
            max(0.001, budget - (time.monotonic() - started_at))
            if budget is not None
            else None
        ),
        boundary_name=boundary_name,
    )




def _poll_run_until_terminal(
    client: Any,
    *,
    thread_id: str,
    run_id: str,
    run: Mapping[str, Any],
    timeout_seconds: float | None,
    boundary_name: str | None = None,
) -> Any:
    """Poll one dispatched Agent Server run and preserve the dispatcher's retry authority.

    Business purpose:
    - Wait for a created or reattached Agent Server run and translate its terminal state for broker settlement.

    Business rules:
    - Only the canonical boundary supplied by the dispatcher may authorize boundary-specific remote error retry.
    - Run metadata and remote error text are diagnostic data, not authority.
    - Interrupted runs return their status without manufacturing a retryable failure.

    Execution flow:
    1. Poll the run until it reaches a terminal status or the trusted deadline expires.
    2. Read terminal state and classify errors with the supplied canonical boundary identity.
    3. Return result values only after terminal error validation succeeds.

    Failure cases:
    - Transport, timeout, malformed state, and terminal task failures preserve their existing typed settlement behavior.

    Side effects:
    - Performs bounded Agent Server status/state reads; it does not create a new run or alter broker settlement directly.
    """
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
            raise AgentServerRunError(
                "AgentServerRunTimeout",
                f"Agent Server run exceeded {deadline_seconds:.1f}s deadline",
            )

        if now >= next_heartbeat_at:
            next_heartbeat_at = now + pending_heartbeat_seconds

        time.sleep(poll_seconds)
        try:
            run = client.runs.get(thread_id, run_id)
        except httpx.TimeoutException:
            timeout_at = time.monotonic()
            if timeout_at >= next_heartbeat_at:
                next_heartbeat_at = timeout_at + pending_heartbeat_seconds
            continue
        current_status = _run_status(run, last_status)
        last_status = current_status

    if last_status == _INTERRUPTED_RUN_STATUS:
        # A customer stop, not a failure: settle the delivery without a retry
        # so the stopped work does not restart until the customer continues.
        return {"status": "INTERRUPTED", "runId": run_id}
    state = client.threads.get_state(thread_id)
    if last_status != "success":
        _raise_for_terminal_run(last_status, state, boundary_name=boundary_name)
    result = state.get("values", state) if isinstance(state, Mapping) else state
    _raise_for_agent_server_error(result, boundary_name=boundary_name)
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
    """Business purpose: Continue the existing canonical workflow through bounded native re-admission.

    Business rules:
    - Keep the deterministic thread, frozen event and checkpoint; duplicate request IDs reuse their saved request.
    - Continue competes for physical/global capacity and never creates another decision-owning Root.
    Execution flow:
    1. Reconstruct the authoritative continuation context and find a previously published request.
    2. Reuse or create its bounded native request with no repeated input, then poll to terminal state.
    Failure cases:
    - Admission refusal durably defers; invalid checkpoint/transport/terminal failures retain existing handling.
    Side effects:
    - May create one native continuation request; preserves existing checkpoint ancestry and settlement authority.
    """
    thread_id = _find_text(message, "threadId") or agent_thread_id(boundary_name, message, correlation_id)
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
    from orchestration.context import resolve_response_language

    response_language = resolve_response_language(
        _find_text(message, "responseLanguage", "response_language", "locale", "language", "lcsp_locale")
        or (message.get("user") or {}).get("locale")
        or (message.get("metadata") or {}).get("locale")
        or (message.get("metadata") or {}).get("responseLanguage")
        or (message.get("runtimeContext") or {}).get("response_language")
        or (message.get("runtimeContext") or {}).get("responseLanguage")
        or (message.get("runtimeContext") or {}).get("locale")
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
        "response_language": response_language,
    }
    original_context = message.get("runtimeContext")
    if isinstance(original_context, Mapping):
        # Resume the frozen event and repository pins, with a fresh cancellation
        # generation. Never reinterpret the resume command as an Interview answer.
        context = dict(original_context)
        context["response_language"] = response_language
        context["logical_run_id"] = _find_text(message, "logicalRunId")
        stopped_at = _find_text(message, "stoppedAt")
        deadline_at = context.get("system_deadline_at")
        if stopped_at and isinstance(deadline_at, (float, int)):
            from datetime import datetime
            stopped_timestamp = datetime.fromisoformat(stopped_at.replace("Z", "+00:00")).timestamp()
            # Paused wall time must not consume the boundary's execution budget.
            # Keep the original remaining budget and the frozen workflow input.
            context["system_deadline_at"] = deadline_at + max(0, time.time() - stopped_timestamp)
    client = get_sync_client(
        url=os.getenv("LCSP_AGENT_SERVER_URL", DEFAULT_AGENT_SERVER_URL),
        timeout=30,
    )
    request_id = _find_text(message, "requestId")
    run = None
    if request_id:
        # Redelivery reattaches even a completed generation of this request.
        run = next((candidate for candidate in client.runs.list(thread_id)
                    if isinstance(candidate, Mapping) and
                    (candidate.get("metadata") or {}).get("lcsp_resume_request_id") == request_id), None)
    active = _find_active_thread_run(client, thread_id, boundary_name)
    if run is None and active is not None:
        if original_context:
            raise AgentServerRunError("RuntimeAlreadyRunning", "Another native generation owns the thread")
        run = active
    if run is None:
        run = _create_bounded_run(client,
        thread_id,
        os.getenv("LCSP_AGENT_ASSISTANT_ID", DEFAULT_ASSISTANT_ID),
        input=None,
        context=context,
        metadata={
            "lcsp_boundary_name": boundary_name,
            "correlation_id": correlation_id,
            "assessment_id": assessment_id,
            "lcsp_resume_request_id": _find_text(message, "requestId"),
        },
        multitask_strategy="reject" if original_context else "enqueue",
        on_completion="keep",
        **({"checkpoint_id": message["checkpoint"]["checkpoint_id"]} if isinstance(message.get("checkpoint"), Mapping) and message["checkpoint"].get("checkpoint_id") else {}),
        )
    run_id = _find_text(run, "run_id", "runId")
    if not run_id:
        raise AgentServerRunError(
            "AgentServerRunCreateError",
            "Agent Server did not return a run id",
        )

    return _poll_run_until_terminal(
        client,
        thread_id=thread_id,
        run_id=run_id,
        run=run,
        timeout_seconds=timeout_seconds,
        boundary_name=boundary_name,
    )




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


MANAGED_DOCUMENT_INGEST_BOUNDARIES: frozenset[str] = frozenset({
    "managed_document_ingest_requested",
})


def _retryable_remote_task_error(
    raw_error: Any,
    boundary_name: str | None = None,
) -> str | None:
    """Classify safe transient Agent Server task failures for broker retry.

    Business purpose:
    - Preserve bounded broker recovery for transient API and transport failures.

    Business rules:
    - Retry authority is strictly bound to authorized managed-document ingestion boundaries.
    - Assessment Root and Rule Set Preparation boundaries must NEVER acquire managed-document retry authority.
    - Remote task error strings are diagnostic evidence only, never standalone authorization.
    - Retry only explicit transient markers, managed-document 429/5xx, or allowlisted HTTP transport errors.
    - Keep permanent API responses (401, 403, 404, 422), malformed errors, and unknown Agent Server errors terminal.

    Execution flow:
    1. Verify the originating boundary is authorized for managed document ingestion retry.
    2. Parse only the remote error type and managed-document HTTP status.
    3. Return a sanitized reason for an allowlisted transient failure.

    Failure cases:
    - Unbound boundaries, missing, malformed, permanent, and unrecognized errors return None.

    Side effects:
    - None; this helper does not log or expose the remote error message.
    """
    if boundary_name not in MANAGED_DOCUMENT_INGEST_BOUNDARIES:
        return None
    if not isinstance(raw_error, str):
        return None
    error_prefix = raw_error.split("(", 1)[0].split(":", 1)[0].strip()
    error_type = error_prefix.rsplit(".", 1)[-1]
    if error_type == "RetryableAgentBoundaryError":
        return "Agent Server reported a retryable boundary dependency failure"
    if error_type == "IngestionApiError":
        status_match = re.search(r"\((\d{3})\)\W*$", raw_error)
        if status_match:
            status = int(status_match.group(1))
            if status == 429 or 500 <= status <= 599:
                return f"managed document API returned retryable HTTP status {status}"
        return None
    retryable_transport_errors = {
        "ConnectError",
        "ConnectTimeout",
        "NetworkError",
        "PoolTimeout",
        "ReadError",
        "ReadTimeout",
        "RemoteProtocolError",
        "TimeoutException",
        "WriteError",
        "WriteTimeout",
    }
    if error_type in retryable_transport_errors:
        return "Agent Server reported a retryable API transport failure"
    return None


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


def _raise_for_terminal_run(
    status: str,
    state: Any,
    *,
    boundary_name: str | None = None,
) -> None:
    """Map a terminal Agent Server state to the correct broker settlement.

    Business purpose:
    - Preserve retry authority for transient managed-document task failures.

    Business rules:
    - Allowlisted transient remote failures remain retryable; unknown and permanent failures are terminal.

    Execution flow:
    1. Inspect task errors for a bounded retryable classification.
    2. Raise the corresponding retryable or terminal boundary exception.

    Failure cases:
    - Malformed state and unrecognized errors settle as terminal Agent Server failures.

    Side effects:
    - None; the caller owns broker settlement.
    """
    raw_error: Any = None
    # Retry authority must come from the canonical dispatcher, never serialized run state.
    effective_boundary = boundary_name
    if isinstance(state, Mapping):
        tasks = state.get("tasks")
        if isinstance(tasks, (list, tuple)):
            for task in tasks:
                if not isinstance(task, Mapping):
                    continue
                retry_reason = _retryable_remote_task_error(
                    task.get("error"),
                    boundary_name=effective_boundary,
                )
                if retry_reason:
                    raise RetryableAgentBoundaryError(retry_reason)
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


def _raise_for_agent_server_error(
    result: Any,
    *,
    boundary_name: str | None = None,
) -> None:
    """Translate Agent Server request errors into boundary settlement authority.

    Business purpose:
    - Keep transient transport and managed-document failures eligible for bounded retry.

    Business rules:
    - Retry only allowlisted transient errors; permanent and unknown errors remain terminal.

    Execution flow:
    1. Read the structured Agent Server error envelope.
    2. Classify transient failures or raise a terminal run error.

    Failure cases:
    - Missing error envelopes are ignored; malformed or unknown error types remain terminal.

    Side effects:
    - None; no remote error body is logged or exposed here.
    """
    if not isinstance(result, Mapping):
        return
    raw_error = result.get("__error__")
    if not isinstance(raw_error, Mapping):
        return
    remote_error_type = raw_error.get("error")
    message = raw_error.get("message")
    # Result metadata is diagnostic; only the canonical dispatcher can authorize retry.
    effective_boundary = boundary_name
    retry_reason = _retryable_remote_task_error(
        f"{remote_error_type}({message})" if remote_error_type else message,
        boundary_name=effective_boundary,
    )
    if retry_reason:
        raise RetryableAgentBoundaryError(retry_reason)
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
    """Business purpose: Establish the safe cutoff used to distinguish current Agent Server runs from stale persisted runs.

    Business rules:
    - The Agent Server process start metric is authoritative when available.
    - The generation timestamp fallback is accepted only for the exact launcher-owned loopback server in a non-production runtime and only when it is not in the future.
    - Production or remote servers without the metric cannot use a local launcher timestamp.

    Execution flow:
    1. Request `/metrics` and require a successful HTTP response.
    2. Parse `process_start_time_seconds` when the server exposes it.
    3. Otherwise validate the guarded local generation URL and timestamp fallback.

    Failure cases:
    - HTTP, network, or metrics parsing failures propagate; missing metrics without an eligible fallback raises RuntimeError.

    Side effects:
    - Performs one read-only HTTP request to the Agent Server metrics endpoint; it does not change run state.
    """
    response = httpx.get(f"{server_url}/metrics", timeout=2.0)
    response.raise_for_status()
    prefix = "process_start_time_seconds "
    for line in response.text.splitlines():
        if line.startswith(prefix):
            timestamp = float(line.removeprefix(prefix).strip())
            return datetime.fromtimestamp(timestamp, tz=timezone.utc)
    # Older dev servers omit process metrics; the owning launcher supplies a safe pre-spawn cutoff.
    generation = _parse_datetime(os.getenv("LCSP_AGENT_SERVER_GENERATION_STARTED_AT"))
    production = any(os.getenv(key, "").strip().lower() == "production" for key in ("NODE_ENV", "LCSP_AGENT_RUNTIME_MODE"))
    if (not production and urlsplit(server_url).hostname in {"127.0.0.1", "localhost", "::1"}
            and server_url == os.getenv("LCSP_AGENT_SERVER_GENERATION_URL")
            and generation is not None and generation <= datetime.now(timezone.utc)):
        return generation
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
