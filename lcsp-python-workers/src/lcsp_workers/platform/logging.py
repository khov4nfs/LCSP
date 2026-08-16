"""Configure structured worker logging with correlation and secret redaction."""

from __future__ import annotations

import sys
from typing import TextIO

import structlog
from lcsp_workers.platform.correlation import get_correlationId
from lcsp_workers.platform.dev_unsafe_trace import unsafe_dev_trace_enabled
from lcsp_workers.platform.redaction import redact_dict


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
    output: TextIO = _FailOpenTraceWriter(sys.stdout) if unsafe_trace else sys.stdout
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
