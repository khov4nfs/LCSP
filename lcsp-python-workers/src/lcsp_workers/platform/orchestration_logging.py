from __future__ import annotations

import os
from typing import Any


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
    return os.getenv("ORCHESTRATION_DEBUG", "false").strip().lower() == "true"


def sanitize_orchestration_payload(value: Any) -> Any:
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
