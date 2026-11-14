"""Cooperative Stop and durable cumulative budget pause at a native graph boundary."""
from __future__ import annotations

from typing import Any
from langchain.agents.middleware import AgentMiddleware
from langgraph.types import interrupt

from middleware.durable_budget_kernel import (
    ASSESSMENT_ROOT_SCOPE,
    NO_PROGRESS_LIMIT_EXCEEDED,
    WorkloadBudgetLimits,
    WorkloadCumulativeUsage,
    evaluate_workload_admission,
)


class RootRuntimeControl(AgentMiddleware):
    def __init__(self, client: Any, execution_id: str, run: Any = None) -> None:
        self.client = client
        self.execution_id = execution_id
        self.run = run
        self._last_case_revision: int | None = None
        self._last_facts_count: int = 0
        self._last_evidence_count: int = 0
        self._last_decisions_count: int = 0
        self._consecutive_ineffective_calls: int = 0
        self._recent_tool_signatures: list[str] = []

    def before_model(self, state, runtime):
        """Business purpose:
        Enforce runtime controls, intra-execution loop detection, and budget admission before model invocation.

        Business rules:
        - Must halt execution if server requested stop, if runaway loop is detected, or if budget/stall limits are reached.
        - Fails closed if budget state or admission authority is unavailable.

        Execution flow:
        1. Evaluate intra-execution progress against state and run revision; interrupt if runaway loop detected.
        2. Query runtime control and budget admission from server.
        3. Interrupt if stop is requested or budget is denied; otherwise continue.

        Failure cases:
        - Unavailable budget state or network failure raises native graph interrupt.

        Side effects:
        - Sends heartbeat and status telemetry; may trigger graph interrupt.
        """
        stall = self._evaluate_intra_execution_progress(state)
        if stall:
            interrupt({
                "reason": stall["reason"],
                "targetExecutionId": self.execution_id,
                "budgetDenial": True,
                "workloadScope": ASSESSMENT_ROOT_SCOPE,
            })
            return None
        return self._pause_if_requested()

    def after_model(self, state, runtime):
        """Business purpose:
        Evaluate intra-execution progress, detect repeated loops, and check stop requests after model invocation.

        Business rules:
        - Updates progress counters and verifies cooperative stop requests at boundary.
        - Preserves progress when case revision or domain entities advance.
        - Halts runaway loops without stopping productive exploration.

        Execution flow:
        1. Evaluate intra-execution progress using updated state; interrupt if runaway loop detected.
        2. Check for stop request or budget denial from server.
        3. Interrupt if stop or budget limit is triggered; otherwise continue.

        Failure cases:
        - Server budget denial, runaway loop, or stop command raises native graph interrupt.

        Side effects:
        - May interrupt native graph execution for checkpoint persistence.
        """
        stall = self._evaluate_intra_execution_progress(state)
        if stall:
            interrupt({
                "reason": stall["reason"],
                "targetExecutionId": self.execution_id,
                "budgetDenial": True,
                "workloadScope": ASSESSMENT_ROOT_SCOPE,
            })
            return None
        return self._pause_if_requested()

    def _evaluate_intra_execution_progress(self, state: Any) -> dict[str, Any] | None:
        """Business purpose: Track authoritative domain progress and detect ineffective repeated loops within a running execution.

        Business rules:
        - Authoritative work changes (case_revision bump, new accepted facts, new evidence) immediately reset ineffective turn counters.
        - Model text or reasoning alone does not constitute domain progress.
        - Repeated identical tool calls or stalled execution cycles without progress advance the ineffective turn counter.
        - Does not impose arbitrary token pauses on ordinary progressing assessments.

        Execution flow:
        1. Read current case revision and domain entities from bound run or active state.
        2. If domain progress advanced, reset the ineffective action counter and tool signature history.
        3. Otherwise, check for repeated identical tool actions from recent messages and increment ineffective action counter.
        4. Detect identical tool loops and cyclic repetitions; return stall decision if runaway loop is detected.
        5. If ineffective actions exceed configured limit, return stall decision dict.

        Failure cases:
        - Missing state or attributes does not crash the middleware; it preserves existing counter values.

        Side effects:
        - Mutates internal ineffective call counters and recent tool signature buffers.
        """
        current_rev = getattr(self.run, "case_revision", None) if self.run else None
        if current_rev is None and isinstance(state, dict):
            current_rev = state.get("case_revision") or state.get("caseRevision")

        made_progress = False

        if current_rev is not None:
            if self._last_case_revision is None:
                self._last_case_revision = current_rev
            elif current_rev > self._last_case_revision:
                made_progress = True
                self._last_case_revision = current_rev

        facts = state.get("facts", []) if isinstance(state, dict) else getattr(state, "facts", [])
        evidence = state.get("evidence", []) if isinstance(state, dict) else getattr(state, "evidence", [])
        decisions = state.get("decisions", []) if isinstance(state, dict) else getattr(state, "decisions", [])

        if facts and isinstance(facts, list) and len(facts) > self._last_facts_count:
            made_progress = True
            self._last_facts_count = len(facts)
        if evidence and isinstance(evidence, list) and len(evidence) > self._last_evidence_count:
            made_progress = True
            self._last_evidence_count = len(evidence)
        if decisions and isinstance(decisions, list) and len(decisions) > self._last_decisions_count:
            made_progress = True
            self._last_decisions_count = len(decisions)

        if made_progress:
            self._consecutive_ineffective_calls = 0
            self._recent_tool_signatures.clear()
            return None

        self._consecutive_ineffective_calls += 1

        # Inspect recent messages in state for tool calls
        messages = state.get("messages", []) if isinstance(state, dict) else getattr(state, "messages", [])
        if messages:
            last_msg = messages[-1]
            tool_calls = getattr(last_msg, "tool_calls", None) or (
                last_msg.get("tool_calls") if isinstance(last_msg, dict) else None
            )
            if tool_calls and isinstance(tool_calls, list):
                for tc in tool_calls:
                    name = tc.get("name") if isinstance(tc, dict) else getattr(tc, "name", "")
                    args_repr = str(tc.get("args") if isinstance(tc, dict) else getattr(tc, "args", ""))
                    sig = f"{name}:{args_repr}"
                    self._recent_tool_signatures.append(sig)
                    if len(self._recent_tool_signatures) > 30:
                        self._recent_tool_signatures.pop(0)

        # Behavioral runaway loop detection
        # 1. Identical tool calls in a row (>= 5 identical consecutive calls)
        if len(self._recent_tool_signatures) >= 5 and all(
            s == self._recent_tool_signatures[-1] for s in self._recent_tool_signatures[-5:]
        ):
            return {"reason": NO_PROGRESS_LIMIT_EXCEEDED, "detection": "identical_tool_loop"}

        # 2. Cyclic tool repetition (period 2, >= 6 items: A-B-A-B-A-B)
        if len(self._recent_tool_signatures) >= 6:
            s2 = self._recent_tool_signatures[-6:]
            if s2[0] == s2[2] == s2[4] and s2[1] == s2[3] == s2[5] and s2[0] != s2[1]:
                return {"reason": NO_PROGRESS_LIMIT_EXCEEDED, "detection": "cyclic_tool_loop_period_2"}

        # 3. Cyclic tool repetition (period 3, >= 9 items: A-B-C-A-B-C-A-B-C)
        if len(self._recent_tool_signatures) >= 9:
            s3 = self._recent_tool_signatures[-9:]
            if (
                s3[0] == s3[3] == s3[6]
                and s3[1] == s3[4] == s3[7]
                and s3[2] == s3[5] == s3[8]
                and len({s3[0], s3[1], s3[2]}) > 1
            ):
                return {"reason": NO_PROGRESS_LIMIT_EXCEEDED, "detection": "cyclic_tool_loop_period_3"}

        ctx = getattr(self, "_effective_context", None)
        if ctx and isinstance(ctx, dict):
            budget_state = ctx.get("budgetState") or {}
            limits = budget_state.get("limits") or {}
            no_prog_limit = limits.get("noProgressLimit")
            if no_prog_limit is not None and self._consecutive_ineffective_calls >= no_prog_limit:
                return {"reason": NO_PROGRESS_LIMIT_EXCEEDED, "detection": "ineffective_turns_limit"}

        return None

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
            consecutive_turns_without_progress=max(
                usage_data.get("consecutiveTurnsWithoutProgress", 0),
                self._consecutive_ineffective_calls,
            ),
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
        return None
