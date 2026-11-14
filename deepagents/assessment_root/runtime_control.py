"""Cooperative Stop and durable cumulative budget pause at a native graph boundary."""
from __future__ import annotations

from typing import Any
from langchain.agents.middleware import AgentMiddleware
from langgraph.types import interrupt

from middleware.durable_budget_kernel import (
    ASSESSMENT_ROOT_SCOPE,
    WorkloadBudgetLimits,
    WorkloadCumulativeUsage,
    evaluate_workload_admission,
)


class RootRuntimeControl(AgentMiddleware):
    def __init__(self, client: Any, execution_id: str) -> None:
        self.client = client
        self.execution_id = execution_id

    def before_model(self, state, runtime):
        return self._pause_if_requested()

    def after_model(self, state, runtime):
        return self._pause_if_requested()

    def _pause_if_requested(self):
        """Business purpose: Honor a server-requested cooperative Stop or budget denial at a checkpointable Assessment Root boundary.

        Business rules:
        - Only STOP_REQUESTED targeting this execution or an exhausted cumulative budget may interrupt it.
        - Foreign controls or unexhausted budgets must not pause this Root execution.
        - If context or budget state is unavailable from the server, fail closed immediately with BUDGET_UNAVAILABLE.

        Execution flow:
        1. Attempt a heartbeat and fetch the current Root control, interrupting if stop was requested for this execution.
        2. Read authoritative context and cumulative budget state from server; if unavailable or error occurs, fail closed by interrupting with BUDGET_UNAVAILABLE.
        3. Check server-evaluated budget admission status (EXHAUSTED or NO_PROGRESS) and evaluate local limits, interrupting with budget denial reason if limits are exceeded.
        4. Return None to allow model execution when admission is granted.

        Failure cases:
        - Network failures, server errors, or missing budget state fail safely by interrupting with BUDGET_UNAVAILABLE instead of executing without limits.

        Side effects:
        - Calls heartbeat/control/context endpoints and may create a native graph interrupt for checkpoint persistence.
        """
        try:
            self.client.heartbeat()
        except Exception:
            pass
        control = None
        try:
            control = self.client.root_control()
        except Exception:
            control = None
        if control and control.get("targetRunId") == self.execution_id and control.get("state") == "STOP_REQUESTED":
            interrupt({"controlRequestId": control["requestId"], "targetExecutionId": self.execution_id})

        ctx = None
        try:
            ctx = self.client.context()
        except Exception:
            ctx = None

        if not ctx or not ctx.get("budgetState"):
            interrupt({
                "reason": "BUDGET_UNAVAILABLE",
                "targetExecutionId": self.execution_id,
                "budgetDenial": True,
                "workloadScope": ASSESSMENT_ROOT_SCOPE,
            })
            return None

        budget_state = ctx["budgetState"]
        status = budget_state.get("status")
        if status == "NO_PROGRESS":
            interrupt({
                "reason": "NO_PROGRESS_LIMIT_EXCEEDED",
                "targetExecutionId": self.execution_id,
                "budgetDenial": True,
                "workloadScope": ASSESSMENT_ROOT_SCOPE,
            })
            return None
        if status == "EXHAUSTED":
            interrupt({
                "reason": "AGENT_BUDGET_REACHED",
                "targetExecutionId": self.execution_id,
                "budgetDenial": True,
                "workloadScope": ASSESSMENT_ROOT_SCOPE,
            })
            return None

        limits_data = budget_state.get("limits") or {}
        usage_data = budget_state.get("cumulativeUsage") or {}
        limits = WorkloadBudgetLimits(
            max_model_calls=limits_data.get("maxModelCalls"),
            max_input_tokens=limits_data.get("maxInputTokens"),
            max_output_tokens=limits_data.get("maxOutputTokens"),
            max_total_tokens=limits_data.get("maxTotalTokens"),
            no_progress_limit=limits_data.get("noProgressLimit"),
        )
        usage = WorkloadCumulativeUsage(
            model_calls=usage_data.get("modelCalls", 0),
            input_tokens=usage_data.get("inputTokens", 0),
            output_tokens=usage_data.get("outputTokens", 0),
            total_tokens=usage_data.get("totalTokens", 0),
            consecutive_turns_without_progress=usage_data.get("consecutiveTurnsWithoutProgress", 0),
        )
        admitted, reason = evaluate_workload_admission(limits, usage)
        if not admitted and reason:
            interrupt({
                "reason": reason,
                "targetExecutionId": self.execution_id,
                "budgetDenial": True,
                "workloadScope": ASSESSMENT_ROOT_SCOPE,
            })
        return None
