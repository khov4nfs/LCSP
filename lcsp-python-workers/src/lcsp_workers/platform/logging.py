"""Configure structured worker logging with correlation and secret redaction."""

from __future__ import annotations

import sys
from typing import TextIO

import structlog
from lcsp_workers.platform.correlation import get_correlationId
from lcsp_workers.platform.dev_unsafe_trace import unsafe_dev_trace_enabled
from lcsp_workers.platform.redaction import redact_dict


_original_open = open


class _FailOpenTraceWriter:
    """Drop trace-mode stdout backpressure instead of crashing worker logic.

    ``pnpm dev:trace 2>&1 | tee ...`` can expose worker stdout/stderr through a
    non-blocking pipe. Normal structlog events are observability-only and must
    not become scanner failures when that pipe temporarily returns EAGAIN.
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
    """Attach the active correlation identifier to a structured log event.

    Args:
        logger: Structlog logger invoking the processor.
        method_name: Logging method name supplied by structlog.
        event_dict: Mutable structured event payload.

    Returns:
        The event payload enriched with ``correlationId``.
    """
    event_dict["correlationId"] = get_correlationId()
    return event_dict


def _redact_secrets(logger, method_name, event_dict):
    """Remove configured secret values before a log event is rendered.

    ``LCSP_DEV_UNSAFE_TRACE=true`` deliberately disables this log-rendering
    redaction in non-production environments so local developers can inspect
    exact payloads. Runtime persistence/callback privacy controls are separate
    and remain active.

    Args:
        logger: Structlog logger invoking the processor.
        method_name: Logging method name supplied by structlog.
        event_dict: Structured event payload to sanitize.

    Returns:
        A redacted copy normally, or the original event in explicitly unsafe
        development tracing mode.
    """
    if unsafe_dev_trace_enabled():
        return event_dict
    return redact_dict(event_dict)


class PartitionedLogWriter:
    """Writes log output to fallback stream AND appends JSON logs to partitioned files under tmp/."""

    def __init__(self, fallback_stream: TextIO) -> None:
        self._fallback = fallback_stream
        import sys
        self._is_stdout = (fallback_stream is sys.stdout)

    def write(self, value: str) -> int:
        import os
        import sys
        
        # Determine the target stream dynamically if it is stdout/stderr
        if self._is_stdout:
            stream = sys.stdout
        elif isinstance(self._fallback, _FailOpenTraceWriter) and self._fallback._stream is sys.stdout:
            stream = _FailOpenTraceWriter(sys.stdout)
        else:
            stream = self._fallback
            
        written = stream.write(value)
        try:
            trimmed = value.strip()
            if trimmed.startswith("{") and trimmed.endswith("}"):
                import json
                data = json.loads(trimmed)

                from lcsp_workers.platform.correlation import get_user_id, get_assessment_id
                user_id = get_user_id()
                assessment_id = get_assessment_id()

                if "user_id" in data:
                    user_id = str(data["user_id"])
                elif "userId" in data:
                    user_id = str(data["userId"])
                elif "actor" in data and isinstance(data["actor"], dict) and "id" in data["actor"]:
                    user_id = str(data["actor"]["id"])

                if "assessment_id" in data:
                    assessment_id = str(data["assessment_id"])
                elif "assessmentId" in data:
                    assessment_id = str(data["assessmentId"])

                from lcsp_workers.platform.logging_path import get_partitioned_log_path

                is_orch = False
                event_name = data.get("event") or ""
                logger_name = data.get("logger") or ""
                if (
                    "intelligence" in logger_name
                    or "classification" in logger_name
                    or "reporting" in logger_name
                    or "agentic_evidence" in logger_name
                    or "resolver" in logger_name
                    or "tool_entrypoints" in logger_name
                    or "remediation" in logger_name
                    or "orchestration" in event_name.lower()
                    or "llm" in event_name.lower()
                    or "prompt" in event_name.lower()
                    or "model" in event_name.lower()
                    or "tool" in event_name.lower()
                ):
                    is_orch = True

                log_file = get_partitioned_log_path(user_id, assessment_id, is_orchestration=is_orch)
                os.makedirs(os.path.dirname(log_file), exist_ok=True)
                with _original_open(log_file, "a", encoding="utf-8") as f:
                    f.write(value)
        except Exception:
            pass
        return len(value) if written is None else written

    def flush(self) -> None:
        self._fallback.flush()


def configure_logging(level: str = "INFO") -> None:
    """Configure JSON logging for worker processes.

    Correlation enrichment and secret redaction run before log-level and
    rendering processors. Raw development tracing can explicitly disable log
    redaction but is rejected when ``NODE_ENV=production``. In that explicit
    trace mode, stdout is fail-open against EAGAIN/BrokenPipe so observability
    cannot terminate a worker while its domain handler is still healthy.

    Args:
        level: Minimum log level accepted by the bound logger.
    """
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
            getattr(structlog.stdlib.logging, level.upper(), structlog.stdlib.logging.INFO)
        ),
        logger_factory=structlog.PrintLoggerFactory(file=output),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str):
    """Return a named structlog logger.

    Args:
        name: Logical logger/component name.

    Returns:
        A structlog bound logger for the requested component.
    """
    return structlog.get_logger(name)
