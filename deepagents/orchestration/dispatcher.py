"""Direct dispatch of one specialist Deep Agent from a deterministic worker boundary.

Boundaries (the per-rule assessment loop, Interview, Triage) own eligibility, persistence
and gating in Python; each specialist call shares the Root Orchestration lifecycle,
billing and stream, and never re-enters the root model.
"""

from __future__ import annotations

from collections.abc import Callable
import json
import logging
from typing import Any

from deepagents import create_deep_agent

from orchestration.agent_stream import (
    AGENT_STREAM_STAGES,
    invoke_with_stream,
    publish_agent_stream_event,
)
from model_policy import resolve_agent_model
from subagents import FLOW_SUBAGENTS
from tools.common.capabilities.platform.repository_sandbox import current_repository_backend

from .context import LCSPRunContext
from .lifecycle import RootOrchestrationLifecycle
from .result_validation import (
    SpecialistHandoffValidationError,
    repair_targeted_interview_frontier,
    validate_specialist_handoff,
)


logger = logging.getLogger(__name__)


class RootSubagentDispatcher:
    """Dispatch one LCSP specialist under the shared root lifecycle."""

    def __init__(
        self,
        *,
        lifecycle: RootOrchestrationLifecycle | None = None,
        agent_factory: Callable[..., Any] = create_deep_agent,
        subagents: dict[str, dict[str, Any]] | None = None,
        enable_thread_checkpointing: bool = False,
        checkpointer: Any | None = None,
    ) -> None:
        self._lifecycle = lifecycle or RootOrchestrationLifecycle()
        self._agent_factory = agent_factory
        self._enable_thread_checkpointing = enable_thread_checkpointing
        self._checkpointer = checkpointer
        self._subagents = subagents or {
            str(item["name"]): item for item in FLOW_SUBAGENTS
        }

    def dispatch(
        self,
        *,
        subagent_type: str,
        instruction: str,
        affected_rule_ids: list[str] | None = None,
        idempotency_key: str | None = None,
        trigger: str | None = None,
        metadata: dict[str, Any] | None = None,
        thread_id: str | None = None,
        context: LCSPRunContext | None = None,
    ) -> dict[str, Any]:
        """Run one specialist while Root Orchestration owns lifecycle transitions."""
        selected_stage = _stream_stage_for_subagent(subagent_type)
        publish_agent_stream_event(
            "SUBAGENT_SELECTED",
            subagent_name=subagent_type,
            status="RUNNING",
            **({"stage": selected_stage} if selected_stage else {}),
            data={
                "trigger": trigger,
                "affected_rule_ids": affected_rule_ids or [],
            },
        )
        reservation = self._lifecycle.reserve_subagent(
            subagent_type=subagent_type,
            affected_rule_ids=affected_rule_ids,
            idempotency_key=idempotency_key,
            trigger=trigger,
        )
        if reservation.status == "ALREADY_RUNNING":
            return {
                "status": "ALREADY_RUNNING",
                "subagentType": subagent_type,
                "executionId": reservation.execution_id,
                "subagentStarted": False,
            }
        if reservation.status not in {"OWNER", "READY"}:
            raise RuntimeError(
                "unexpected root subagent reservation status: "
                f"{reservation.status}"
            )

        definition = self._subagents.get(subagent_type)
        if definition is None:
            self._lifecycle.fail_subagent(reservation)
            raise ValueError(f"unknown LCSP subagent type: {subagent_type}")

        owner_instruction = self._lifecycle.owner_instruction(reservation)
        prompt = str(instruction or "").strip()
        if owner_instruction:
            prompt = f"{owner_instruction}\n\n{prompt}" if prompt else owner_instruction

        # The role's model is resolved here, at construction time, from the model routes YAML.
        agent_kwargs: dict[str, Any] = {
            "model": definition.get("model") or resolve_agent_model(subagent_type),
            "backend": current_repository_backend(),
            "tools": definition["tools"],
            "system_prompt": definition["system_prompt"],
            "middleware": definition["middleware"],
            "name": f"lcsp-{subagent_type}-dispatch",
            # Governed tools (submit_rule_assessment, cite_repository_source) read the
            # trusted LCSPRunContext from ToolRuntime.
            "context_schema": LCSPRunContext,
        }
        response_format = definition.get("response_format")
        if response_format is not None:
            agent_kwargs["response_format"] = response_format
        if self._checkpointer is not None:
            agent_kwargs["checkpointer"] = self._checkpointer

        specialist = self._agent_factory(**agent_kwargs)
        config: dict[str, Any] = {"metadata": dict(metadata or {})}
        from .interview_progress import active_progress
        progress = active_progress.get()
        if progress is not None:
            config["callbacks"] = [progress]
        if thread_id:
            config["metadata"]["lcsp_thread_id"] = thread_id
            config["metadata"]["lcsp_thread_checkpointing"] = (
                "enabled" if self._enable_thread_checkpointing else "disabled"
            )
        if thread_id and self._enable_thread_checkpointing:
            if self._checkpointer is None:
                self._lifecycle.fail_subagent(reservation)
                raise RuntimeError(
                    "direct dispatcher checkpointing requires an explicit checkpointer"
                )
            config["configurable"] = {"thread_id": thread_id}

        try:
            invocation_result = invoke_with_stream(specialist,
                {"messages": [{"role": "user", "content": prompt}]},
                config=config,
                context=context,
                stage=_stream_stage_for_subagent(subagent_type),
            )
            handoff = self._validated_handoff(
                subagent_type=subagent_type,
                response_format=response_format,
                invocation_result=invocation_result,
                metadata=dict(metadata or {}),
            )
        except Exception:
            self._lifecycle.fail_subagent(reservation)
            raise

        completion = self._lifecycle.complete_subagent(reservation)
        return {
            "status": "COMPLETED",
            "subagentType": subagent_type,
            "executionId": reservation.execution_id,
            "subagentStarted": True,
            "orchestration": completion,
            "handoff": handoff,
            "checkpointing": {
                "threadId": thread_id,
                "enabled": bool(thread_id and self._enable_thread_checkpointing),
            },
            "episode": {"captured": False},
        }

    @staticmethod
    def _validated_handoff(
        *,
        subagent_type: str,
        response_format: Any | None,
        invocation_result: Any,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        if response_format is None:
            return None
        payload = (
            invocation_result.get("structured_response")
            if isinstance(invocation_result, dict)
            else None
        )
        if payload is None:
            # Tool-strategy providers (e.g. llm7) sometimes answer with the handoff
            # JSON as plain text instead of calling the structured-output tool. The
            # recovered object still goes through the same strict validation below.
            payload = _final_message_json_object(invocation_result)
            if payload is not None:
                logger.warning(
                    "SPECIALIST_HANDOFF_RECOVERED_FROM_TEXT subagent_type=%s",
                    subagent_type,
                )
        if payload is None:
            # A missing typed handoff is a candidate-shape failure like any other schema
            # violation, so boundaries with a bounded self-correction can repair it.
            raise SpecialistHandoffValidationError(
                f"{subagent_type} did not return a structured_response handoff"
            )
        if subagent_type == "interview":
            payload = repair_targeted_interview_frontier(
                payload,
                targeted_need=(metadata or {}).get("targeted_need"),
            )
        handoff = validate_specialist_handoff(subagent_type, payload)
        return handoff.model_dump(mode="json")


def _final_message_json_object(invocation_result: Any) -> dict[str, Any] | None:
    """Return the JSON object a final text-only AI message carries, if any."""
    if not isinstance(invocation_result, dict):
        return None
    messages = invocation_result.get("messages")
    if not isinstance(messages, list) or not messages:
        return None
    final = messages[-1]
    if getattr(final, "type", None) != "ai" or getattr(final, "tool_calls", None):
        return None
    content = getattr(final, "content", None)
    if isinstance(content, list):
        content = "".join(
            block.get("text", "") if isinstance(block, dict) else str(block)
            for block in content
        )
    if not isinstance(content, str):
        return None
    start, end = content.find("{"), content.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        payload = json.loads(content[start : end + 1])
    except ValueError:
        return None
    return payload if isinstance(payload, dict) else None


def _stream_stage_for_subagent(subagent_type: str) -> str | None:
    """Customer-visible live-stream stage for one specialist dispatch."""
    normalized = subagent_type.strip().lower()
    if normalized == "repository-analyst":
        return AGENT_STREAM_STAGES["rule_analysis"]
    if normalized == "interview":
        return AGENT_STREAM_STAGES["interview"]
    return None
