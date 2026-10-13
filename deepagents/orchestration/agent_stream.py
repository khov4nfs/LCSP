"""Bridge LangGraph/Deep Agents streaming events into the LCSP live chat runtime.

The bridge deliberately exposes only provider/framework-visible streaming content:
the reasoning a provider returns to the caller (reasoning summaries, or the
``reasoning_content`` channel of OpenAI-compatible reasoning routes), each tool call,
and the visible model output. It never synthesizes reasoning and never forwards the
raw thinking text of a content block that also carries a summary. All payloads are
bounded and credential-redacted before they leave the worker process.
"""

from __future__ import annotations

import logging
import math
import re
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar, copy_context
from dataclasses import dataclass, field
from datetime import UTC, datetime
from queue import Full, Queue
from threading import Event, Lock, Thread
from typing import Any
from uuid import uuid4

from middleware.redaction import redact_dict, redact_string

from orchestration.runtime_control import active_runtime_run_id

MAX_STREAM_TEXT_CHARS = 65_536
# Durable reasoning is journaled per model step; keep each entry readable.
MAX_REASONING_SUMMARY_CHARS = 8_000
MAX_STREAM_COLLECTION_ITEMS = 50
MAX_STREAM_DEPTH = 6
SEMANTIC_SCHEMA_VERSION = "AGENT_STREAM_SEMANTIC_V2"
BEST_EFFORT = "BEST_EFFORT"
DURABLE = "DURABLE"
PRIVATE_GRAPH_KEYS = frozenset(
    {
        "messages",
        "prompt",
        "systemprompt",
        "instruction",
        "privatecontext",
        "customercontext",
        "confirmedcontext",
        "confirmedcustomercontext",
        "prioranswerhistory",
        "scratchpad",
        "reasoning",
        "thought",
        "thoughts",
    }
)

NOISY_STREAM_LOGGER_PREFIXES = (
    "httpx",
    "httpcore",
    "urllib3",
    "pika",
    "langchain",
    "langgraph",
)
NOISY_STREAM_LOG_MARKERS = (
    "PIIMiddleware[",
    "[HIDDEN_PRIVATE_RUNTIME_STATE]",
    "private_runtime_state",
)


class BufferedAgentStreamEmitter:
    """Deliver stream payloads in-order off the model execution thread."""

    def __init__(
        self,
        deliver: Callable[[dict[str, Any]], None],
        *,
        max_pending: int = 4096,
        close_timeout_seconds: float = 2.0,
    ) -> None:
        self._deliver = deliver
        self._queue: Queue[dict[str, Any] | None] = Queue(maxsize=max_pending)
        self._best_effort_backlog_limit = max(1, min(max_pending - 1, 2))
        self._close_timeout_seconds = max(0.0, close_timeout_seconds)
        self._closed = False
        self._thread = Thread(
            target=self._run,
            name="lcsp-agent-stream",
            daemon=True,
        )
        self._thread.start()

    def __call__(self, payload: dict[str, Any]) -> None:
        if self._closed:
            return
        if (
            not _is_critical_stream_payload(payload)
            and self._queue.qsize() >= self._best_effort_backlog_limit
        ):
            # Token deltas and graph updates are best-effort. Do not let them
            # queue ahead of the next durable model/tool turn.
            return
        try:
            self._queue.put_nowait(payload)
        except Full:
            if _is_critical_stream_payload(payload):
                try:
                    self._queue.put(payload, timeout=self._close_timeout_seconds)
                    return
                except Full:
                    try:
                        self._deliver(payload)
                    except Exception:  # noqa: BLE001 - telemetry delivery is best effort
                        return
                    return
            # Live telemetry must never backpressure model/tool execution. If the
            # local API cannot keep up, drop the excess event instead of blocking
            # the governed assessment workflow.
            return

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            self._queue.put_nowait(None)
        except Full:
            pass
        self._thread.join(timeout=self._close_timeout_seconds)

    def _run(self) -> None:
        while True:
            payload = self._queue.get()
            try:
                if payload is None:
                    return
                try:
                    self._deliver(payload)
                except Exception:  # noqa: BLE001,S110 - telemetry must not affect execution
                    # Live telemetry is best-effort and must never fail agent execution.
                    pass
            finally:
                self._queue.task_done()
                if self._closed and self._queue.empty():
                    return  # noqa: B012 - stop after draining the closed telemetry queue


@dataclass
class AgentStreamSession:
    """Per-boundary live-stream context bound to one customer-visible run."""

    assessment_id: str | None
    run_id: str
    correlation_id: str
    boundary_name: str
    emit_payload: Callable[[dict[str, Any]], None]
    boundary_type: str = "ASSESSMENT"
    boundary_id: str | None = None
    preparation_run_id: str | None = None
    sequence: int = field(default=0, init=False)
    _sequence_lock: Lock = field(default_factory=Lock, init=False, repr=False)
    def emit(self, event_type: str, **fields: Any) -> None:
        cancel = active_agent_stream_cancel.get()
        if cancel is not None and cancel.is_set() and event_type != "MODEL_CALL_CANCELLED":
            return
        runtime_run_id = active_runtime_run_id.get()
        if runtime_run_id:
            fields = {**fields, "data": {**(fields.get("data") or {}), "runtimeRunId": runtime_run_id}}
        step_id = active_model_step.get() or _MESSAGE_MODEL_STEPS.get(
            str(fields.get("message_id") or "")
        )
        data = fields.get("data")
        if step_id and (data is None or isinstance(data, dict)) and "model_step_id" not in (data or {}):
            fields = {**fields, "data": {**(data or {}), "model_step_id": step_id}}
        with self._sequence_lock:
            self.sequence += 1
            sequence = self.sequence
        payload = {
            "event_id": str(uuid4()),
            "client_sequence": sequence,
            "emitted_at": datetime.now(UTC).isoformat(),
            "assessment_id": self.assessment_id,
            "boundary_type": self.boundary_type,
            "boundary_id": self.boundary_id or self.assessment_id or self.run_id,
            "preparation_run_id": self.preparation_run_id,
            "run_id": self.run_id,
            "correlation_id": self.correlation_id,
            "event_type": event_type,
            "source": self.boundary_name,
            **fields,
        }
        self.emit_payload(_sanitize_payload(payload))


# Canonical logical-model-turn identity. Set around one model step (retries,
# credential rotation and provider fallback included); stamped on every event
# emitted inside it. Events emitted later by the stream consumer (MODEL_REQUEST,
# deltas) find it through the response message id remembered at completion.
active_model_step: ContextVar[str | None] = ContextVar("active_model_step_id", default=None)
# Scalar routing summary of the active model step (provider/credential attempts).
# Routing transitions are infrastructure: they are counted here and logged, never
# published as assessment events.
active_model_step_summary: ContextVar[dict[str, Any] | None] = ContextVar(
    "active_model_step_summary", default=None
)


def note_model_step(counter: str, amount: int = 1) -> None:
    summary = active_model_step_summary.get()
    if summary is not None:
        summary[counter] = summary.get(counter, 0) + amount


_MESSAGE_MODEL_STEPS: dict[str, str] = {}
_MESSAGE_MODEL_STEPS_CAP = 4096


def remember_message_model_step(message_id: Any, step_id: str | None) -> None:
    if not step_id or not isinstance(message_id, str) or not message_id:
        return
    _MESSAGE_MODEL_STEPS[message_id] = step_id
    while len(_MESSAGE_MODEL_STEPS) > _MESSAGE_MODEL_STEPS_CAP:
        _MESSAGE_MODEL_STEPS.pop(next(iter(_MESSAGE_MODEL_STEPS)))


active_agent_stream: ContextVar[AgentStreamSession | None] = ContextVar(
    "active_agent_stream", default=None
)
_emitting_stream_event: ContextVar[bool] = ContextVar(
    "emitting_agent_stream_event", default=False
)
# Set by the Agent Server run loop (local_server.py) around graph.stream(...) so a
# currently iterating its own model/tool stream, however deep the boundary handler
# call stack goes, without threading a cancel parameter through every call site.
active_agent_stream_cancel: ContextVar[Event | None] = ContextVar(
    "active_agent_stream_cancel", default=None
)


class AgentStreamInterrupted(BaseException):
    """Cooperative stop requested mid-stream; not a failure.

    Subclasses BaseException so it is never swallowed by an ``except Exception`` handler in a
    boundary handler and reaches the Agent Server run loop that owns run status.
    """


def check_agent_execution_active() -> None:
    """Stop nested work before another provider call after run cancellation."""
    cancel_event = active_agent_stream_cancel.get()
    if cancel_event is not None and cancel_event.is_set():
        raise AgentStreamInterrupted("agent execution deadline or cancellation reached")


@contextmanager
def activate_agent_stream(session: AgentStreamSession | None) -> Iterator[None]:
    """Bind a live-stream session to the current boundary execution context."""
    token = active_agent_stream.set(session)
    try:
        yield
    finally:
        try:
            closer = getattr(session.emit_payload, "close", None) if session is not None else None
            if callable(closer):
                closer()
        finally:
            active_agent_stream.reset(token)


MODEL_WAIT_HEARTBEAT_SECONDS = 10.0


@contextmanager
def model_wait_heartbeat(
    text: str,
    *,
    interval_seconds: float | None = None,
) -> Iterator[None]:
    """Keep the run visibly alive while a model call waits outside a provider attempt.

    Credential-cooldown waits happen between provider attempts, where the per-call
    heartbeat is not running. The API treats the latest runtime event as liveness.
    """
    interval = MODEL_WAIT_HEARTBEAT_SECONDS if interval_seconds is None else interval_seconds
    stop = Event()
    context = copy_context()

    def beat() -> None:
        while not stop.wait(interval):
            context.run(
                publish_agent_stream_event,
                "MODEL_CALL_HEARTBEAT",
                status="RUNNING",
                text=text,
            )

    thread = Thread(target=beat, name="lcsp-model-wait-heartbeat", daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=0.25)


def publish_agent_stream_event(event_type: str, **fields: Any) -> None:
    """Publish one safe live event when the current boundary has a stream session."""
    session = active_agent_stream.get()
    if session is None or _emitting_stream_event.get():
        return
    token = _emitting_stream_event.set(True)
    try:
        session.emit(event_type, **fields)
    finally:
        _emitting_stream_event.reset(token)


_RESULT_ITEM_KEYS = ("items", "results", "matches", "files", "entries", "nodes")
_RESULT_PARSE_MAX_BYTES = 1_000_000


def _safe_value(value: Any, *, depth: int = MAX_STREAM_DEPTH) -> Any:
    if depth <= 0:
        return {"truncated": "max_depth"}
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return redact_string(value)[:MAX_STREAM_TEXT_CHARS]
    if isinstance(value, dict):
        items = list(value.items())[:MAX_STREAM_COLLECTION_ITEMS]
        return {
            str(key): _safe_value(item, depth=depth - 1)
            for key, item in items
        }
    if isinstance(value, (list, tuple)):
        return [
            _safe_value(item, depth=depth - 1)
            for item in value[:MAX_STREAM_COLLECTION_ITEMS]
        ]
    if hasattr(value, "model_dump"):
        try:
            return _safe_value(value.model_dump(), depth=depth - 1)
        except Exception:  # noqa: BLE001,S110 - malformed diagnostic values are ignored
            pass
    if hasattr(value, "content"):
        return {
            "type": type(value).__name__,
            "content": _safe_value(getattr(value, "content", None), depth=depth - 1),
        }
    return redact_string(str(value))[:MAX_STREAM_TEXT_CHARS]


def _sanitize_payload(payload: dict[str, Any]) -> dict[str, Any]:
    safe = _safe_value(payload)
    redacted = redact_dict(safe)
    # redact_dict blanks any key with a "token" segment (reasoning_tokens, ...).
    # Provider usage counters are numeric-only, so restore them after re-validation.
    data = safe.get("data") if isinstance(safe, dict) else None
    # Only the model-call completion event carries trusted provider usage; graph/tool
    # authored `usage` keys on any other event are ordinary (redacted) data.
    usage = (
        _trusted_usage(data.get("usage"))
        if isinstance(data, dict) and safe.get("event_type") == "MODEL_CALL_COMPLETED"
        else None
    )
    if usage is not None and isinstance(redacted.get("data"), dict):
        redacted["data"]["usage"] = usage
    return redacted


_USAGE_METRIC_KEY = re.compile(r"^[a-z][a-z0-9_]{0,47}$")


def _usage_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value >= 0
    )


def _trusted_usage(usage: Any) -> dict[str, Any] | None:
    if not isinstance(usage, dict):
        return None
    out: dict[str, Any] = {}
    for key in ("input_tokens", "output_tokens", "total_tokens"):
        if _usage_number(usage.get(key)):
            out[key] = usage[key]
    details = usage.get("details")
    if isinstance(details, dict):
        clean = {
            k: v
            for k, v in list(details.items())[:24]
            if isinstance(k, str) and _USAGE_METRIC_KEY.match(k) and _usage_number(v)
        }
        if clean:
            out["details"] = clean
    return out or None


def _is_durable_stream_payload(payload: dict[str, Any]) -> bool:
    data = payload.get("data")
    return isinstance(data, dict) and data.get("durability") == DURABLE


CRITICAL_STREAM_EVENT_TYPES = frozenset(
    {
        "BOUNDARY_STARTED",
        "BOUNDARY_COMPLETED",
        "BOUNDARY_FAILED",
        "BOUNDARY_PAUSED",
        "AGENT_STARTED",
        "AGENT_COMPLETED",
        "AGENT_FAILED",
        "MODEL_CALL_STARTED",
        "MODEL_CALL_COMPLETED",
        "MODEL_CALL_CANCELLED",
        "MODEL_CALL_FAILED",
        "MODEL_CALL_TIMEOUT",
        "PROVIDER_FALLBACK",
        "CREDENTIAL_ROTATION",
    }
)


def _is_critical_stream_payload(payload: dict[str, Any]) -> bool:
    return _is_durable_stream_payload(payload) or payload.get(
        "event_type"
    ) in CRITICAL_STREAM_EVENT_TYPES


def _should_forward_stream_log(record: logging.LogRecord) -> bool:
    """Keep customer-visible runtime logs high signal without hiding failures."""
    message = record.getMessage()
    if any(marker in message for marker in NOISY_STREAM_LOG_MARKERS):
        return False
    if record.levelno >= logging.WARNING:
        return True
    if record.levelno < logging.INFO:
        return False
    logger_name = record.name.lower()
    return not any(
        logger_name == prefix or logger_name.startswith(f"{prefix}.")
        for prefix in NOISY_STREAM_LOGGER_PREFIXES
    )


class AgentStreamLogHandler(logging.Handler):
    """Forward high-signal Python logs emitted inside an active agent boundary."""

    def emit(self, record: logging.LogRecord) -> None:
        if active_agent_stream.get() is None or _emitting_stream_event.get():
            return
        if not _should_forward_stream_log(record):
            return
        try:
            publish_agent_stream_event(
                "LOG",
                text=redact_string(record.getMessage())[:MAX_STREAM_TEXT_CHARS],
                data={
                    "level": record.levelname,
                    "logger": record.name,
                },
                status=(
                    "FAILED"
                    if record.levelno >= logging.ERROR
                    else "RUNNING"
                ),
            )
        except Exception:  # noqa: BLE001 - logging must never change runtime semantics
            # Logging must never change agent runtime semantics.
            return


def install_agent_stream_log_handler() -> None:
    """Install one process-wide ContextVar-aware log bridge."""
    root = logging.getLogger()
    if any(isinstance(handler, AgentStreamLogHandler) for handler in root.handlers):
        return
    root.addHandler(AgentStreamLogHandler())


__all__ = [
    "AgentStreamInterrupted",
    "AgentStreamSession",
    "BufferedAgentStreamEmitter",
    "activate_agent_stream",
    "active_agent_stream",
    "active_agent_stream_cancel",
    "install_agent_stream_log_handler",
    "publish_agent_stream_event",
]
