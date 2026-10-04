"""Runtime registration shared by the LCSP server and hosted LangGraph runs."""

from __future__ import annotations

from typing import Any, Mapping

from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.platform.config import load_config


def report_runtime_control(
    thread_id: str,
    run_id: str,
    context: Mapping[str, Any],
    state: str,
    *,
    checkpoint: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    assessment_id = context.get("assessment_id")
    if not assessment_id:
        return {}
    cfg = load_config()
    body = {
        "assessmentId": assessment_id,
        "targetRunId": run_id,
        "threadId": thread_id,
        "boundary": context.get("system_boundary_name"),
        "logicalRunId": context.get("logical_run_id") or run_id,
        "workflowRunId": context.get("workflow_run_id"),
        "correlationId": context.get("correlation_id") or run_id,
        "state": state,
    }
    if state == "RUNNING":
        body["context"] = {**context, "logical_run_id": body["logicalRunId"]}
    if state == "STOPPED" and checkpoint is not None:
        body["checkpoint"] = dict(checkpoint)
    return WorkerApiClient(cfg.nestjs_api_base_url, cfg.worker_api_key)._post_with_retry(
        "/internal/assessment-runtime-controls", body, redact=False
    )
