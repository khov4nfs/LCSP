"""Provide orchestration debug controls and payload projection."""

from __future__ import annotations

import os
from typing import Any

from lcsp_workers.platform.dev_unsafe_trace import unsafe_dev_trace_enabled


ORCHESTRATION_LOG_EVENTS = {
    "healthCheck": "ORCH_RUNTIME_HEALTH_CHECK",
    "commandReceived": "ORCH_RUNTIME_COMMAND_RECEIVED",
    "commandCompleted": "ORCH_RUNTIME_COMMAND_COMPLETED",
    "bridgeTargetedReanalysis": "ORCH_RUNTIME_BRIDGE_TARGETED_REANALYSIS",
    "bridgeTargetedReanalysisResult": "ORCH_RUNTIME_BRIDGE_TARGETED_REANALYSIS_RESULT",
    "bridgeResumeWaitingRuns": "ORCH_RUNTIME_BRIDGE_RESUME_WAITING_RUNS",
    "bridgeResumeWaitingRunsResult": "ORCH_RUNTIME_BRIDGE_RESUME_WAITING_RUNS_RESULT",
}


def orchestration_debug_enabled() -> bool:
    """Return whether verbose orchestration diagnostics are explicitly enabled."""
    return os.getenv("ORCHESTRATION_DEBUG", "false").strip().lower() == "true"


def sanitize_orchestration_payload(value: Any) -> Any:
    """Project orchestration payloads for logs.

    Normal operation recursively redacts credential-like fields. When
    ``LCSP_DEV_UNSAFE_TRACE=true`` is explicitly enabled outside production, the
    exact payload is returned so development orchestration logs preserve API
    keys, secrets, tokens, passwords, source fragments, idempotency keys, and
    every other field verbatim.
    """
    if unsafe_dev_trace_enabled():
        return value

    if isinstance(value, list):
        return [sanitize_orchestration_payload(entry) for entry in value]
    if not isinstance(value, dict):
        return value

    sanitized: dict[str, Any] = {}
    for key, entry in value.items():
        if isinstance(key, str) and any(
            token in key.lower()
            for token in ("api_key", "secret", "token", "password")
        ):
            sanitized[key] = "[REDACTED]"
            continue
        sanitized[key] = sanitize_orchestration_payload(entry)
    return sanitized
