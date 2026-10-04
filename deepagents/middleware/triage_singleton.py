"""Apply Triage's singleton policy at Root Orchestration specialist dispatch."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable, Iterator
from contextlib import contextmanager
from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain.messages import ToolMessage
from langchain.tools.tool_node import ToolCallRequest
from langgraph.types import Command

from orchestration.context import LCSPRunContext
from orchestration.lifecycle import RootOrchestrationLifecycle
from orchestration.waiting_assessments import WaitingAssessmentRegistry
from tools.triage.legal_rule_triage.singleton import TriageSingletonCoordinator


class _TriageSingletonMiddleware(AgentMiddleware):
    """Keep the same reservation protocol around sync and async task tools."""

    name = "guard_triage_singleton_task"

    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        return _guard_triage_task_call(
            request, handler, coordinator=TriageSingletonCoordinator(),
            waiting_registry=WaitingAssessmentRegistry(),
        )

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        return await _aguard_triage_task_call(
            request, handler, coordinator=TriageSingletonCoordinator(),
            waiting_registry=WaitingAssessmentRegistry(),
        )


guard_triage_singleton_task = _TriageSingletonMiddleware()


def _guard_triage_task_call(
    request: ToolCallRequest,
    handler: Callable[[ToolCallRequest], ToolMessage | Command],
    *,
    coordinator: TriageSingletonCoordinator,
    waiting_registry: WaitingAssessmentRegistry | None = None,
) -> ToolMessage | Command:
    with _triage_task_scope(
        request, coordinator=coordinator, waiting_registry=waiting_registry,
    ) as guarded:
        return guarded if isinstance(guarded, ToolMessage) else handler(guarded)


async def _aguard_triage_task_call(
    request: ToolCallRequest,
    handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    *,
    coordinator: TriageSingletonCoordinator,
    waiting_registry: WaitingAssessmentRegistry | None = None,
) -> ToolMessage | Command:
    scope = _triage_task_scope(
        request, coordinator=coordinator, waiting_registry=waiting_registry,
    )
    # Reservation and completion use the existing filesystem/API lifecycle.
    # Keep that blocking work off the Agent Server event loop, and do not lose
    # a just-acquired reservation if cancellation races with its acquisition.
    entering = asyncio.create_task(asyncio.to_thread(scope.__enter__))
    try:
        guarded = await asyncio.shield(entering)
    except BaseException as error:
        await entering
        await asyncio.to_thread(scope.__exit__, type(error), error, error.__traceback__)
        raise
    try:
        result = guarded if isinstance(guarded, ToolMessage) else await handler(guarded)
    except BaseException as error:
        await asyncio.to_thread(scope.__exit__, type(error), error, error.__traceback__)
        raise
    await asyncio.to_thread(scope.__exit__, None, None, None)
    return result


@contextmanager
def _triage_task_scope(
    request: ToolCallRequest,
    *,
    coordinator: TriageSingletonCoordinator,
    waiting_registry: WaitingAssessmentRegistry | None,
) -> Iterator[ToolCallRequest | ToolMessage]:
    tool_call = request.tool_call
    args = tool_call.get("args")
    if tool_call.get("name") != "task" or not isinstance(args, dict):
        yield request
        return
    if str(args.get("subagent_type") or "") != "triage":
        yield request
        return

    context = _coerce_context(getattr(request.runtime, "context", None))
    legal_rule_ids = list(context.legal_rule_ids) if context else []
    idempotency_key = context.idempotency_key if context else None
    trigger = "ENGINEERING_RULE_NOT_READY" if idempotency_key else "SCHEDULED"
    lifecycle = RootOrchestrationLifecycle(
        triage_coordinator=coordinator,
        waiting_registry=waiting_registry or WaitingAssessmentRegistry(),
    )

    reservation = lifecycle.reserve_subagent(
        subagent_type="triage",
        affected_rule_ids=legal_rule_ids,
        idempotency_key=idempotency_key,
        trigger=trigger,
    )
    if reservation.status == "ALREADY_RUNNING":
        yield ToolMessage(
            content=json.dumps(
                {
                    "status": "ALREADY_RUNNING",
                    "triageExecutionId": reservation.execution_id,
                    "affectedLegalRuleIds": [],
                    "queueCreated": False,
                    "scopeMerged": False,
                    "subagentStarted": False,
                    "message": (
                        "Legal Rule Triage is already running. Root Orchestration did "
                        "not start a second specialist or queue, persist, or merge the "
                        "incoming LegalRule scope."
                    ),
                },
                ensure_ascii=False,
                sort_keys=True,
            ),
            tool_call_id=str(tool_call.get("id") or "triage-singleton"),
        )
        return

    if reservation.status != "OWNER" or not reservation.execution_id:
        raise RuntimeError(
            f"unexpected triage singleton reservation status: {reservation.status}"
        )

    guarded_args = dict(args)
    description = str(guarded_args.get("description") or "").strip()
    owner_instruction = lifecycle.owner_instruction(reservation)
    guarded_args["description"] = (
        f"{owner_instruction}\n\n{description}" if description else owner_instruction
    )
    guarded_call = {**tool_call, "args": guarded_args}

    try:
        yield request.override(tool_call=guarded_call)
    except Exception:
        lifecycle.fail_subagent(reservation)
        raise

    # Triage itself only finishes/releases its singleton. Once the specialist returns,
    # Root Orchestration verifies that protocol and owns all cross-agent transitions,
    # including reconciliation of Assessments waiting on EngineeringRule readiness.
    lifecycle.complete_subagent(reservation)


def _coerce_context(value: Any) -> LCSPRunContext | None:
    if isinstance(value, LCSPRunContext):
        return value
    if isinstance(value, dict):
        try:
            return LCSPRunContext(**value)
        except TypeError:
            return None
    return None
