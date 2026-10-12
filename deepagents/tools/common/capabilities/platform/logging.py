"""Configure structured worker logging with correlation and secret redaction."""

from __future__ import annotations

import json
import logging
import os
import sys
import warnings
from typing import TextIO

import structlog
from tools.common.capabilities.platform.correlation import get_correlationId
from tools.common.capabilities.platform.dev_unsafe_trace import (
    unsafe_dev_trace_enabled,
)
from middleware.redaction import redact_dict


_original_open = open
_NOISY_LANGGRAPH_INFO_LOGGERS = (
    "langgraph_api.metrics_collector",
    "langgraph_runtime_inmem.queue",
)


class _FailOpenTraceWriter:
    """Drop trace-mode stdout backpressure instead of crashing worker logic.

    ``pnpm dev:trace 2>&1 | tee ...`` can expose worker stdout/stderr through a
    non-blocking pipe. Normal structlog events are observability-only and must
    not become runtime failures when that pipe temporarily returns EAGAIN.
    """

    def __init__(self, stream: TextIO) -> None:
        self._stream = stream

    def write(self, value: str) -> int:
        try:
            written = self._stream.write(value)
            return len(value) if written is None else written
        except (BlockingIOError, BrokenPipeError):
            return len(value)

    def flush(self) -> None:
        try:
            self._stream.flush()
        except (BlockingIOError, BrokenPipeError):
            return


def _inject_correlationId(logger, method_name, event_dict):
    """Attach the active correlation identifier to a structured log event."""
    event_dict["correlationId"] = get_correlationId()
    return event_dict


def _redact_secrets(logger, method_name, event_dict):
    """Remove configured secret values before a normal log event is rendered."""
    if unsafe_dev_trace_enabled():
        return event_dict
    return redact_dict(event_dict)


def _is_orchestration_event(data: dict) -> bool:
    """Return whether an event belongs in the partitioned orchestration log."""
    event_name = str(data.get("event") or "")
    logger_name = str(data.get("logger") or "")
    return bool(
        "reporting" in logger_name
        or "tool_entrypoints" in logger_name
        or "orchestration" in event_name.lower()
        or "llm" in event_name.lower()
        or "prompt" in event_name.lower()
        or "model" in event_name.lower()
        or "tool" in event_name.lower()
    )


class PartitionedLogWriter:
    """Write canonical structured activity to stdout and assessment-private logs."""

    def __init__(self, fallback_stream: TextIO) -> None:
        self._fallback = fallback_stream
        self._is_stdout = fallback_stream is sys.stdout

    def write(self, value: str) -> int:
        if self._is_stdout:
            stream: TextIO = sys.stdout
        elif (
            isinstance(self._fallback, _FailOpenTraceWriter)
            and self._fallback._stream is sys.stdout
        ):
            stream = _FailOpenTraceWriter(sys.stdout)
        else:
            stream = self._fallback

        written = stream.write(value)
        try:
            trimmed = value.strip()
            if trimmed.startswith("{") and trimmed.endswith("}"):
                data = json.loads(trimmed)
                if isinstance(data, dict):
                    self._persist_structured_event(data, value)
        except Exception:
            # Logging persistence is observability only and must never fail a worker.
            pass
        return len(value) if written is None else written

    @staticmethod
    def _persist_structured_event(data: dict, rendered_value: str) -> None:
        from tools.common.capabilities.platform.correlation import get_assessment_id, get_user_id
        from tools.common.capabilities.platform.logging_path import (
            get_partitioned_log_path,
        )

        user_id = get_user_id()
        assessment_id = get_assessment_id()

        try:
            from orchestration.agent_stream import publish_agent_stream_event

            publish_agent_stream_event(
                "LOG",
                text=str(data.get("event") or data.get("message") or "log"),
                data=data,
                status=str(data.get("level") or "INFO").upper(),
            )
        except Exception:
            pass

        if "user_id" in data:
            user_id = str(data["user_id"])
        elif "userId" in data:
            user_id = str(data["userId"])
        elif (
            "actor" in data
            and isinstance(data["actor"], dict)
            and "id" in data["actor"]
        ):
            user_id = str(data["actor"]["id"])

        if "assessment_id" in data:
            assessment_id = str(data["assessment_id"])
        elif "assessmentId" in data:
            assessment_id = str(data["assessmentId"])

        from orchestration.agent_stream import active_agent_stream

        session = active_agent_stream.get()
        if session is not None:
            assessment_id = session.assessment_id
        # Shared, unattributed private files cannot be erased by assessment DELETE.
        if not assessment_id or assessment_id == "unknown_assessment":
            return

        partitioned_path = get_partitioned_log_path(
            user_id,
            assessment_id,
            is_orchestration=_is_orchestration_event(data),
        )
        os.makedirs(os.path.dirname(partitioned_path), exist_ok=True)
        with _original_open(partitioned_path, "a", encoding="utf-8") as file_handle:
            file_handle.write(rendered_value)

    def flush(self) -> None:
        self._fallback.flush()


def configure_logging(level: str = "INFO") -> None:
    """Configure structured activity with redaction and assessment-private logging."""
    suppress_langgraph_heartbeat_logs()
    unsafe_trace = unsafe_dev_trace_enabled()
    raw_output: TextIO = _FailOpenTraceWriter(sys.stdout) if unsafe_trace else sys.stdout
    output = PartitionedLogWriter(raw_output)
    structlog.configure(
        processors=[
            _inject_correlationId,
            _redact_secrets,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(
                structlog.stdlib.logging,
                level.upper(),
                structlog.stdlib.logging.INFO,
            )
        ),
        logger_factory=structlog.PrintLoggerFactory(file=output),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str):
    """Return a named structlog logger for the requested component."""
    return structlog.get_logger(name)


def suppress_langgraph_heartbeat_logs() -> None:
    """Hide periodic LangGraph local-dev queue heartbeat logs from LCSP consoles.

    Warnings and errors from these components still surface. The suppressed INFO
    records only report idle queue/worker counters such as ``Worker stats`` and
    ``Queue stats``.

    LangGraph's own console formatter also chains ``format_exc_info`` before
    structlog's ConsoleRenderer, so every logged run error is preceded by a
    structlog UserWarning about pretty exceptions. The traceback is still
    rendered; only that advisory is ignored.
    """
    for logger_name in _NOISY_LANGGRAPH_INFO_LOGGERS:
        logging.getLogger(logger_name).setLevel(logging.WARNING)
    warnings.filterwarnings(
        "ignore",
        message=r"Remove `format_exc_info` from your processor chain",
        category=UserWarning,
    )
