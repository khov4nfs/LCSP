"""Validate LCSP specialist handoffs at the Deep Agents task boundary.

Only Interview and Triage return typed handoffs. The Repository Analyst has no handoff:
it persists through the governed ``submit_rule_assessment`` tool, so nothing is validated
here for it.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain.messages import ToolMessage
from langchain.tools.tool_node import ToolCallRequest
from langgraph.types import Command

from orchestration.result_validation import validate_specialist_handoff


class _SpecialistHandoffMiddleware(AgentMiddleware):
    """Fail closed in both native execution modes with the same validation."""

    name = "validate_lcsp_specialist_task_handoff"

    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        return _validate_lcsp_specialist_task_handoff(request, handler)

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        subagent_type = _handoff_subagent_type(request)
        return _validate_task_result(subagent_type, await handler(request))


validate_lcsp_specialist_task_handoff = _SpecialistHandoffMiddleware()


def _validate_lcsp_specialist_task_handoff(
    request: ToolCallRequest,
    handler: Callable[[ToolCallRequest], ToolMessage | Command],
) -> ToolMessage | Command:
    subagent_type = _handoff_subagent_type(request)
    return _validate_task_result(subagent_type, handler(request))


def _handoff_subagent_type(request: ToolCallRequest) -> str | None:
    tool_call = request.tool_call
    args = tool_call.get("args")
    if tool_call.get("name") != "task" or not isinstance(args, dict):
        return None

    subagent_type = str(args.get("subagent_type") or "")
    return subagent_type if subagent_type in {"interview", "triage"} else None


def _validate_task_result(
    subagent_type: str | None, result: ToolMessage | Command,
) -> ToolMessage | Command:
    if subagent_type is None:
        return result

    content = _task_tool_message_content(result)
    if content is None:
        raise RuntimeError(f"{subagent_type} task did not return a ToolMessage handoff")

    payload = _parse_json_handoff(subagent_type, content)
    if _is_triage_already_running_short_circuit(subagent_type, payload):
        return result

    validate_specialist_handoff(subagent_type, payload)
    return result


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


__all__ = [
    "validate_lcsp_specialist_task_handoff",
    "_validate_lcsp_specialist_task_handoff",
]
