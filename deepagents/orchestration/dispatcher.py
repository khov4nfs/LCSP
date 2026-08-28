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

from .lifecycle import RootOrchestrationLifecycle


class RootSubagentDispatcher:
    """Dispatch one LCSP specialist under the shared root lifecycle."""

    def __init__(
        self,
        *,
        lifecycle: RootOrchestrationLifecycle | None = None,
        agent_factory: Callable[..., Any] = create_agent,
        subagents: dict[str, dict[str, Any]] | None = None,
    ) -> None:
        self._lifecycle = lifecycle or RootOrchestrationLifecycle()
        self._agent_factory = agent_factory
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
    ) -> dict[str, Any]:
        """Run one specialist while Root Orchestration owns lifecycle transitions."""
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

        specialist = self._agent_factory(
            model=definition["model"],
            tools=definition["tools"],
            system_prompt=definition["system_prompt"],
            middleware=definition["middleware"],
            name=f"lcsp-{subagent_type}-root-dispatch",
        )
        config: dict[str, Any] = {"metadata": dict(metadata or {})}
        if thread_id:
            config["configurable"] = {"thread_id": thread_id}

        try:
            specialist.invoke(
                {"messages": [{"role": "user", "content": prompt}]},
                config=config,
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
        }
