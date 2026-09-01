"""Root-owned dispatch adapter for specialist invocations outside the Managed task tool.

Managed Deep Agents normally dispatches specialists through the root ``task`` tool. Some
system events enter through deterministic worker boundaries instead. Those adapters use
this dispatcher so they still share the same Root Orchestration lifecycle and do not
create agent-specific orchestrators.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from langchain.agents import create_agent

from subagents import FLOW_SUBAGENTS

from .context import LCSPRunContext
from .lifecycle import RootOrchestrationLifecycle
from .result_validation import validate_specialist_handoff


class RootSubagentDispatcher:
    """Dispatch one LCSP specialist under the shared root lifecycle."""

    def __init__(
        self,
        *,
        lifecycle: RootOrchestrationLifecycle | None = None,
        agent_factory: Callable[..., Any] = create_agent,
        root_agent: Any | None = None,
        root_agent_factory: Callable[[], Any] | None = None,
        subagents: dict[str, dict[str, Any]] | None = None,
        enable_thread_checkpointing: bool = False,
        checkpointer: Any | None = None,
        program_graph_loader: Callable[[LCSPRunContext, dict[str, Any]], Any] | None = None,
    ) -> None:
        self._lifecycle = lifecycle or RootOrchestrationLifecycle()
        self._agent_factory = agent_factory
        self._root_agent = root_agent
        self._root_agent_factory = root_agent_factory
        self._enable_thread_checkpointing = enable_thread_checkpointing
        self._checkpointer = checkpointer
        self._program_graph_loader = program_graph_loader or _load_program_graph_from_metadata
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
        program_graph: Any | None = None,
        reenter_root: bool = True,
    ) -> dict[str, Any]:
        """Run one specialist while Root Orchestration owns lifecycle transitions."""
        if reenter_root:
            return self._dispatch_via_root(
                subagent_type=subagent_type,
                instruction=instruction,
                affected_rule_ids=affected_rule_ids,
                idempotency_key=idempotency_key,
                trigger=trigger,
                metadata=metadata,
                thread_id=thread_id,
                context=context,
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

        agent_kwargs: dict[str, Any] = {
            "model": definition["model"],
            "tools": definition["tools"],
            "system_prompt": definition["system_prompt"],
            "middleware": definition["middleware"],
            "name": f"lcsp-{subagent_type}-root-dispatch",
        }
        response_format = definition.get("response_format")
        if response_format is not None:
            agent_kwargs["response_format"] = response_format
        if self._checkpointer is not None:
            agent_kwargs["checkpointer"] = self._checkpointer

        specialist = self._agent_factory(**agent_kwargs)
        config: dict[str, Any] = {"metadata": dict(metadata or {})}
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
            invocation_result = specialist.invoke(
                {"messages": [{"role": "user", "content": prompt}]},
                config=config,
                context=context,
            )
            validation_graph = program_graph
            if (
                validation_graph is None
                and subagent_type == "investigator"
                and context is not None
                and self._program_graph_loader is not None
            ):
                validation_graph = self._program_graph_loader(context, dict(metadata or {}))
            handoff = self._validated_handoff(
                subagent_type=subagent_type,
                response_format=response_format,
                invocation_result=invocation_result,
                graph=validation_graph,
                pinned_rule_ids=tuple(affected_rule_ids or ()),
                pinned_versions=dict(
                    (context.artifact_versions if context is not None else {})
                    or (metadata or {}).get("artifact_versions", {})
                ),
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

    def _dispatch_via_root(
        self,
        *,
        subagent_type: str,
        instruction: str,
        affected_rule_ids: list[str] | None,
        idempotency_key: str | None,
        trigger: str | None,
        metadata: dict[str, Any] | None,
        thread_id: str | None,
        context: LCSPRunContext | None,
    ) -> dict[str, Any]:
        root = self._root_agent or (self._root_agent_factory() if self._root_agent_factory else None)
        if root is None:
            raise RuntimeError(
                "managed root agent is required for root re-entry; "
                "call with reenter_root=False for explicit direct dispatch"
            )
        if subagent_type not in self._subagents:
            raise ValueError(f"unknown LCSP subagent type: {subagent_type}")

        root_thread_id = (
            context.workflow_run_id if context is not None and context.workflow_run_id else thread_id
        )
        config: dict[str, Any] = {"metadata": dict(metadata or {})}
        if root_thread_id:
            config["configurable"] = {"thread_id": root_thread_id}
            config["metadata"]["lcsp_thread_id"] = root_thread_id
        config["metadata"]["lcsp_system_event_subagent"] = subagent_type
        if affected_rule_ids:
            config["metadata"]["affected_rule_ids"] = list(affected_rule_ids)
        if idempotency_key:
            config["metadata"]["idempotency_key"] = idempotency_key
        if trigger:
            config["metadata"]["trigger"] = trigger

        prompt = (
            "Deterministic LCSP system event requested specialist work.\n"
            f"Target specialist: {subagent_type}\n\n"
            f"{instruction.strip()}"
        )
        result = root.invoke(
            {"messages": [{"role": "user", "content": prompt}]},
            config=config,
            context=context,
        )
        return {
            "status": "ROOT_REENTERED",
            "subagentType": subagent_type,
            "subagentStarted": False,
            "rootReentry": True,
            "checkpointing": {
                "threadId": root_thread_id,
                "enabled": bool(root_thread_id),
            },
            "result": result,
            "episode": {"captured": False},
        }

    @staticmethod
    def _validated_handoff(
        *,
        subagent_type: str,
        response_format: Any | None,
        invocation_result: Any,
        graph: Any | None = None,
        pinned_rule_ids: tuple[str, ...] = (),
        pinned_versions: dict[str, str] | None = None,
    ) -> dict[str, Any] | None:
        if response_format is None:
            return None
        if not isinstance(invocation_result, dict) or "structured_response" not in invocation_result:
            raise RuntimeError(
                f"{subagent_type} did not return a structured_response handoff"
            )
        handoff = validate_specialist_handoff(
            subagent_type,
            invocation_result["structured_response"],
            graph=graph,
            pinned_rule_ids=pinned_rule_ids,
            pinned_versions=pinned_versions or {},
        )
        return handoff.model_dump(mode="json")


def _load_program_graph_from_metadata(
    context: LCSPRunContext,
    metadata: dict[str, Any],
) -> Any | None:
    graph = metadata.get("program_graph") or metadata.get("evidence_graph")
    if graph is not None:
        return graph
    api_client = metadata.get("api_client")
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
