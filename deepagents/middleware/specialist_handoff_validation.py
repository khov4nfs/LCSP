"""Validate LCSP specialist handoffs at the Deep Agents task boundary."""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from typing import Any

from langchain.agents.middleware import wrap_tool_call
from langchain.messages import ToolMessage
from langchain.tools.tool_node import ToolCallRequest
from langgraph.types import Command

from orchestration.context import LCSPRunContext
from orchestration.result_validation import validate_specialist_handoff
from tools.common.capabilities.platform.api_client import WorkerApiClient


@wrap_tool_call
def validate_lcsp_specialist_task_handoff(
    request: ToolCallRequest,
    handler: Callable[[ToolCallRequest], ToolMessage | Command],
) -> ToolMessage | Command:
    """Fail closed when a managed LCSP subagent returns an invalid handoff."""
    return _validate_lcsp_specialist_task_handoff(request, handler)


def _validate_lcsp_specialist_task_handoff(
    request: ToolCallRequest,
    handler: Callable[[ToolCallRequest], ToolMessage | Command],
) -> ToolMessage | Command:
    tool_call = request.tool_call
    args = tool_call.get("args")
    if tool_call.get("name") != "task" or not isinstance(args, dict):
        return handler(request)

    subagent_type = str(args.get("subagent_type") or "")
    if subagent_type not in {"interview", "planner", "investigator", "triage"}:
        return handler(request)

    result = handler(request)
    content = _task_tool_message_content(result)
    if content is None:
        raise RuntimeError(f"{subagent_type} task did not return a ToolMessage handoff")

    payload = _parse_json_handoff(subagent_type, content)
    if _is_triage_already_running_short_circuit(subagent_type, payload):
        return result

    context = _coerce_context(getattr(request.runtime, "context", None))
    metadata = _runtime_metadata(request)
    graph = None
    if subagent_type == "investigator" and context is not None:
        graph = _load_program_graph(context, metadata)

    validate_specialist_handoff(
        subagent_type,
        payload,
        graph=graph,
        pinned_rule_ids=tuple(context.engineering_rule_ids if context is not None else ()),
        pinned_versions=dict(context.artifact_versions if context is not None else {}),
    )
    _persist_targeted_interview_need(
        subagent_type=subagent_type,
        payload=payload,
        context=context,
        metadata=metadata,
        execution_id=str(tool_call.get("id") or "").strip() or None,
    )
    return result


def _persist_targeted_interview_need(
    *,
    subagent_type: str,
    payload: dict[str, Any],
    context: LCSPRunContext | None,
    metadata: dict[str, Any],
    execution_id: str | None = None,
) -> None:
    if subagent_type != "investigator" or payload.get("status") != "NEEDS_INPUT":
        return
    if context is None or not context.assessment_id or not context.user_id:
        raise RuntimeError("Targeted Interview registration requires trusted assessment/user context")
    if not execution_id:
        raise RuntimeError("Targeted Interview registration requires the original Investigator task execution id")
    if not context.workflow_run_id or not context.checkpoint_id:
        raise RuntimeError("Targeted Interview registration requires original workflow and checkpoint pins")
    affected_rule_ids = tuple(context.engineering_rule_ids)
    if not affected_rule_ids:
        raise RuntimeError("Targeted Interview registration requires pinned EngineeringRule scope")
    need = payload.get("business_context_need")
    if not isinstance(need, dict):
        raise RuntimeError("Investigator NEEDS_INPUT handoff is missing business_context_need")
    need_id = str(need.get("need_id") or "").strip()
    business_need = str(need.get("business_context_need") or "").strip()
    criteria = need.get("resolution_criteria")
    if not need_id or not business_need or not isinstance(criteria, list) or not criteria:
        raise RuntimeError("Investigator business_context_need is incomplete")
    api_client = metadata.get("api_client") or _worker_api_client_from_env()
    if api_client is None:
        raise RuntimeError("Targeted Interview registration requires WorkerApiClient")
    register = getattr(api_client, "post_interview_targeted_need", None)
    if not callable(register):
        raise RuntimeError("WorkerApiClient cannot register Targeted Interview needs")
    artifact_versions = payload.get("artifact_versions")
    if not isinstance(artifact_versions, dict) or not artifact_versions:
        raise RuntimeError("Targeted Interview registration requires validated Investigator artifact pins")
    if dict(artifact_versions) != dict(context.artifact_versions):
        raise RuntimeError("Investigator artifact pins drifted from immutable runtime context")
    originating_reference = f"investigator:{execution_id}:{need_id}"
    register(
        context.assessment_id,
        {
            "actorId": context.user_id,
            "needId": need_id,
            "businessContextNeed": business_need,
            "resolutionCriteria": [str(item) for item in criteria],
            "originatingInvestigationReference": originating_reference,
            "investigatorExecutionId": execution_id,
            "workflowRunId": context.workflow_run_id,
            "checkpointId": context.checkpoint_id,
            "affectedRuleIds": list(affected_rule_ids),
            "artifactVersions": dict(artifact_versions),
        },
    )


def _task_tool_message_content(result: ToolMessage | Command) -> str | None:
    if isinstance(result, ToolMessage):
        return str(result.content)
    update = result.update if isinstance(result, Command) else None
    if not isinstance(update, dict):
        return None
    messages = update.get("messages")
    if not isinstance(messages, list):
        return None
    for message in reversed(messages):
        if isinstance(message, ToolMessage):
            return str(message.content)
    return None


def _parse_json_handoff(subagent_type: str, content: str) -> dict[str, Any]:
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{subagent_type} task handoff was not valid JSON") from exc
    if not isinstance(payload, dict):
        raise RuntimeError(f"{subagent_type} task handoff must be a JSON object")
    return payload


def _is_triage_already_running_short_circuit(
    subagent_type: str,
    payload: dict[str, Any],
) -> bool:
    return (
        subagent_type == "triage"
        and payload.get("status") == "ALREADY_RUNNING"
        and payload.get("subagentStarted") is False
    )


def _coerce_context(value: Any) -> LCSPRunContext | None:
    if isinstance(value, LCSPRunContext):
        return value
    if isinstance(value, dict):
        try:
            return LCSPRunContext(**value)
        except TypeError:
            return None
    return None


def _runtime_metadata(request: ToolCallRequest) -> dict[str, Any]:
    config = getattr(request.runtime, "config", None)
    if not isinstance(config, dict):
        return {}
    metadata = config.get("metadata")
    return dict(metadata) if isinstance(metadata, dict) else {}


def _load_program_graph(
    context: LCSPRunContext,
    metadata: dict[str, Any],
) -> Any | None:
    graph = metadata.get("program_graph") or metadata.get("evidence_graph")
    if graph is not None:
        return graph
    api_client = metadata.get("api_client") or _worker_api_client_from_env()
    report_id = context.artifact_versions.get("technicalEvidenceReportId")
    if api_client is None or not report_id:
        return None
    getter = getattr(api_client, "get_accepted_technical_evidence_report", None)
    if not callable(getter):
        return None
    report = getter(report_id)
    if not isinstance(report, dict):
        return None
    payload = report.get("evidence_payload") or report.get("evidencePayload")
    if not isinstance(payload, dict):
        return None
    return payload.get("evidence_graph") or payload.get("evidenceGraph")


def _worker_api_client_from_env() -> WorkerApiClient | None:
    base_url = (os.environ.get("NESTJS_API_BASE_URL") or "").strip()
    api_key = (os.environ.get("WORKER_API_KEY") or "").strip()
    if not base_url or not api_key:
        return None
    return WorkerApiClient(base_url, api_key)


__all__ = [
    "validate_lcsp_specialist_task_handoff",
    "_validate_lcsp_specialist_task_handoff",
]
