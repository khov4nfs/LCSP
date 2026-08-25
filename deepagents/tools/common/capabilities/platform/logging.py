"""Configure structured worker logging with correlation and secret redaction."""

from __future__ import annotations

import json
import os
import sys
from typing import TextIO

import structlog
from tools.common.capabilities.platform.correlation import get_correlationId
from tools.common.capabilities.platform.dev_unsafe_trace import (
    unsafe_dev_trace_enabled,
    unsafe_dev_unfiltered_enabled,
)
from middleware.redaction import redact_dict


_original_open = open
_SAFE_LLM_TOOL_FILE_EVENTS = frozenset(
    {
        "LLM_REQUEST",
        "LLM_RESPONSE",
        "LLM_REQUEST_FAILED",
        "ENGINEERING_INVESTIGATION_TOOL_CALL",
        "ENGINEERING_INVESTIGATION_TOOL_RESULT",
        "ENGINEERING_INVESTIGATION_FINISHED",
        "ENGINEERING_INVESTIGATION_CLAIM_REJECTED",
        "ENGINEERING_INVESTIGATION_FAILED",
        "ENGINEERING_INVESTIGATION_NO_NATIVE_TOOL_CALL",
        "ENGINEERING_INVESTIGATION_FINISH_MISSING",
    }
)


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
    )


def _is_safe_llm_tool_file_event(data: dict) -> bool:
    """Select structured telemetry allowed in the repository-level LLM debug log.

    Development raw-trace events are intentionally excluded. Native tool-result
    events are allowed because the investigator already bounds the result to the
    same observation supplied to the next LLM turn. The repository-level file is
    always redacted again before persistence, even if unsafe dev tracing is enabled.
    """
    event_name = str(data.get("event") or "")
    return event_name in _SAFE_LLM_TOOL_FILE_EVENTS


def _render_safe_root_event(data: dict) -> str:
    """Render a JSON line for ``tmp/llm-tool-calls.log``."""
    safe_data = data if unsafe_dev_unfiltered_enabled() else redact_dict(data)
    return json.dumps(safe_data, ensure_ascii=False, separators=(",", ":")) + "\n"


def _ensure_llm_tool_log_file() -> None:
    """Create the safe repository-level LLM/tool debug log eagerly.

    The file used to be created lazily on the first matching telemetry event,
    which made ``tail -f tmp/llm-tool-calls.log`` fail immediately after
    ``pnpm dev`` startup. Logging is observability-only, so creation remains
    fail-open and must never prevent a worker from starting.
    """
    try:
        from tools.common.capabilities.platform.logging_path import get_llm_tool_log_path

        log_path = get_llm_tool_log_path()
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        with _original_open(log_path, "a", encoding="utf-8"):
            pass
    except Exception:
        return


class PartitionedLogWriter:
    """Write stdout plus partitioned logs and safe root-level LLM tool telemetry."""

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
            get_llm_tool_log_path,
            get_partitioned_log_path,
        )

        user_id = get_user_id()
        assessment_id = get_assessment_id()

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

        partitioned_path = get_partitioned_log_path(
            user_id,
            assessment_id,
            is_orchestration=_is_orchestration_event(data),
        )
        os.makedirs(os.path.dirname(partitioned_path), exist_ok=True)
        with _original_open(partitioned_path, "a", encoding="utf-8") as file_handle:
            file_handle.write(rendered_value)

        if _is_safe_llm_tool_file_event(data):
            llm_tool_path = get_llm_tool_log_path()
            os.makedirs(os.path.dirname(llm_tool_path), exist_ok=True)
            with _original_open(llm_tool_path, "a", encoding="utf-8") as file_handle:
                file_handle.write(_render_safe_root_event(data))

    def flush(self) -> None:
        self._fallback.flush()


def configure_logging(level: str = "INFO") -> None:
    """Configure JSON logging for Managed Agent processes.

    Normal worker events continue to stdout and partitioned run/orchestration
    files. Safe LLM request/response plus EngineeringRule native tool input/result
    telemetry is additionally mirrored to ``<repo>/tmp/llm-tool-calls.log`` (or
    ``LCSP_LLM_TOOL_LOG_PATH`` when configured). The file is created eagerly at
    worker startup so developers can attach ``tail -f`` before the first LLM call.
    Tool results are bounded by the investigator to the exact observation forwarded
    into the next LLM turn and are secret-redacted again before root-level persistence
    unless explicitly running with ``LCSP_DEV_UNSAFE_UNFILTERED=true``. Raw development
    trace events are never mirrored into that file.
    """
    _ensure_llm_tool_log_file()
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
