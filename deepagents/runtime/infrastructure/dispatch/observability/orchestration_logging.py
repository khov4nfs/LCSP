"""Provide orchestration debug controls and payload projection."""

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
    """Return whether verbose orchestration diagnostics are explicitly enabled."""
    return os.getenv("ORCHESTRATION_DEBUG", "false").strip().lower() == "true"


def sanitize_orchestration_payload(value: Any) -> Any:
    """Return orchestration payloads unchanged for local runtime logs."""
    return value
