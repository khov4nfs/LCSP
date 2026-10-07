"""Bound one agent run so its ReAct loop always converges to a final answer.

Deep Agents keeps calling the model while the model keeps asking for tools. Without a
bound, an agent that never feels "done" (for example a Planner exploring a large
repository) grows its context on every step, gets slower and rate-limited, and never
returns. This middleware enforces three limits per run:

1. Context: once the estimated prompt approaches the run's input budget (the model
   profile context window), older tool results are
   replaced by a short placeholder. The newest results are always kept.
2. Finalize: after ``finalize_after`` model calls, or when trimming cannot bring the
   prompt under budget, tools are withdrawn and the model is told to return its final
   answer from the evidence already inspected.
3. Hard stop: a run that still has not finished ``grace_calls`` calls later raises
   ``AgentRunBudgetExceeded``, which the failure policy treats as terminal.
"""

from __future__ import annotations

import os
from copy import deepcopy
from typing import Annotated, Any

from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.context_editing import ClearToolUsesEdit
from langchain.agents.middleware.types import AgentState, PrivateStateAttr
from langchain_core.messages import HumanMessage, ToolMessage
from langgraph.channels.untracked_value import UntrackedValue
from typing_extensions import NotRequired

from middleware.usage_metering import (
    estimate_messages_input_tokens,
    estimate_request_metrics,
    provider_context_limit_tokens,
)
from middleware.failure_policy import AgentRunBudgetExceeded
from orchestration.agent_stream import publish_agent_stream_event


DEFAULT_FINALIZE_AFTER_MODEL_CALLS = 24
DEFAULT_GRACE_MODEL_CALLS = 3
DEFAULT_KEEP_TOOL_RESULTS = 4
# Trim before the ceiling so the next tool result still fits.
CONTEXT_TRIM_RATIO = 0.8
# Trimming could not get under this share of the budget: stop exploring.
CONTEXT_FINALIZE_RATIO = 0.95
FINALIZE_AFTER_ENV = "LCSP_AGENT_RUN_FINALIZE_AFTER_MODEL_CALLS"
GRACE_CALLS_ENV = "LCSP_AGENT_RUN_GRACE_MODEL_CALLS"
RUN_MODEL_CALL_COUNT_KEY = "lcsp_run_model_call_count"

AGENT_BUDGET_REACHED = "AGENT_BUDGET_REACHED"
AGENT_CONTEXT_TRIMMED = "AGENT_CONTEXT_TRIMMED"
AGENT_BUDGET_REASONS = {
    "model_calls": "MODEL_CALL_BUDGET",
    "context": "CONTEXT_BUDGET",
    "hard_limit": "HARD_LIMIT",
}

TRIMMED_TOOL_RESULT_PLACEHOLDER = (
    "[Earlier tool result removed to stay within the run's context budget. "
    "Rely on the conclusions you already drew from it; do not repeat the same call.]"
)
FINALIZE_INSTRUCTION = (
    "The investigation budget for this run is used up. Do not call any more tools. "
    "Return your final answer now, in the required output format, using only the "
    "evidence you have already inspected. Anything you could not verify must be "
    "reported as unresolved with a limitation instead of being guessed."
)


class AgentRunBudgetState(AgentState):
    """Run-scoped counter; UntrackedValue resets it on every new invocation."""

    lcsp_run_model_call_count: NotRequired[
        Annotated[int, UntrackedValue, PrivateStateAttr]
    ]


class AgentRunBudgetMiddleware(AgentMiddleware):
    """Trim, then finalize, then stop one agent run."""

    state_schema = AgentRunBudgetState

    def __init__(
        self,
        *,
        finalize_after: int | None = None,
        grace_calls: int | None = None,
        keep_tool_results: int = DEFAULT_KEEP_TOOL_RESULTS,
        finalize_tools: frozenset[str] = frozenset(),
    ) -> None:
        super().__init__()
        # Governed completion tools stay callable at finalize.
        self.finalize_tools = frozenset(finalize_tools)
        self.finalize_after = max(
            1,
            finalize_after
            if finalize_after is not None
            else _positive_env(FINALIZE_AFTER_ENV, DEFAULT_FINALIZE_AFTER_MODEL_CALLS),
        )
        self.grace_calls = max(
            1,
            grace_calls
            if grace_calls is not None
            else _positive_env(GRACE_CALLS_ENV, DEFAULT_GRACE_MODEL_CALLS),
        )
        self.keep_tool_results = max(1, keep_tool_results)

    def _finalize_instruction(self) -> str:
        if not self.finalize_tools:
            return FINALIZE_INSTRUCTION
        names = ", ".join(sorted(self.finalize_tools))
        return (
            "The investigation budget for this run is used up. Do not investigate further. "
            f"Call {names} now with only what you have already verified; report anything "
            "you could not establish as unresolved with a limitation instead of guessing."
        )

    @property
    def max_model_calls(self) -> int:
        return self.finalize_after + self.grace_calls

    def after_model(self, state, runtime) -> dict[str, Any] | None:
        return {RUN_MODEL_CALL_COUNT_KEY: _run_model_calls(state) + 1}

    async def aafter_model(self, state, runtime) -> dict[str, Any] | None:
        return self.after_model(state, runtime)

    def wrap_model_call(self, request, handler):
        return handler(self._bounded_request(request))

    async def awrap_model_call(self, request, handler):
        return await handler(self._bounded_request(request))

    def _bounded_request(self, request):
        calls = _run_model_calls(getattr(request, "state", None))
        if calls >= self.max_model_calls:
            publish_agent_stream_event(
                AGENT_BUDGET_REACHED,
                status="FAILED",
                text="agent run budget exhausted",
                data=self._budget_data(calls, AGENT_BUDGET_REASONS["hard_limit"]),
            )
            raise AgentRunBudgetExceeded(
                f"Agent run did not finish within {self.max_model_calls} model calls"
            )

        limit = _context_budget_tokens(request)
        overhead = _prompt_overhead_tokens(request)
        messages = list(getattr(request, "messages", None) or [])
        tokens = overhead + estimate_messages_input_tokens(messages)
        if limit is not None and tokens > int(limit * CONTEXT_TRIM_RATIO):
            trimmed, cleared = self._trim_tool_results(
                messages,
                trigger=int(limit * CONTEXT_TRIM_RATIO),
                overhead=overhead,
            )
            if cleared:
                trimmed_tokens = overhead + estimate_messages_input_tokens(trimmed)
                publish_agent_stream_event(
                    AGENT_CONTEXT_TRIMMED,
                    status="COMPLETED",
                    text="older tool results trimmed from the model context",
                    data={
                        "cleared_tool_results": cleared,
                        "kept_tool_results": self.keep_tool_results,
                        "estimated_input_tokens_before": tokens,
                        "estimated_input_tokens_after": trimmed_tokens,
                        "context_budget_tokens": limit,
                        "model_calls": calls,
                    },
                )
                messages = trimmed
                tokens = trimmed_tokens
                request = request.override(messages=messages)

        reason: str | None = None
        if calls >= self.finalize_after:
            reason = AGENT_BUDGET_REASONS["model_calls"]
        elif (
            calls > 0
            and limit is not None
            and tokens > int(limit * CONTEXT_FINALIZE_RATIO)
        ):
            reason = AGENT_BUDGET_REASONS["context"]
        if reason is None:
            return request

        publish_agent_stream_event(
            AGENT_BUDGET_REACHED,
            status="RUNNING",
            text="agent asked to finish with the evidence already inspected",
            data=self._budget_data(calls, reason),
        )
        return request.override(
            tools=[
                tool
                for tool in getattr(request, "tools", None) or []
                if _tool_name(tool) in self.finalize_tools
            ],
            messages=[*messages, HumanMessage(content=self._finalize_instruction())],
        )

    def _trim_tool_results(
        self,
        messages: list[Any],
        *,
        trigger: int,
        overhead: int,
    ) -> tuple[list[Any], int]:
        edited = deepcopy(messages)
        before = _cleared_tool_results(edited)
        ClearToolUsesEdit(
            trigger=trigger,
            keep=self.keep_tool_results,
            placeholder=TRIMMED_TOOL_RESULT_PLACEHOLDER,
        ).apply(
            edited,
            count_tokens=lambda items: overhead + estimate_messages_input_tokens(items),
        )
        return edited, _cleared_tool_results(edited) - before

    def _budget_data(self, calls: int, reason: str) -> dict[str, Any]:
        return {
            "reason": reason,
            "model_calls": calls,
            "finalize_after_model_calls": self.finalize_after,
            "max_model_calls": self.max_model_calls,
        }


def _run_model_calls(state: Any) -> int:
    if not isinstance(state, dict):
        return 0
    value = state.get(RUN_MODEL_CALL_COUNT_KEY, 0)
    return value if isinstance(value, int) and value > 0 else 0


def _context_budget_tokens(request: Any) -> int | None:
    """The model profile's input window (route option ``context_window_tokens``), if declared."""
    return provider_context_limit_tokens(getattr(request, "model", None))


def _prompt_overhead_tokens(request: Any) -> int:
    """System prompt, tool schemas and response format: everything but messages."""
    try:
        metrics = estimate_request_metrics(request, getattr(request, "model", None))
    except Exception:
        return 0
    messages_only = estimate_messages_input_tokens(getattr(request, "messages", None))
    return max(0, metrics.estimated_input_tokens - messages_only)


def _cleared_tool_results(messages: list[Any]) -> int:
    return sum(
        1
        for message in messages
        if isinstance(message, ToolMessage)
        and message.response_metadata.get("context_editing", {}).get("cleared")
    )


def _positive_env(name: str, default: int) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as error:
        raise RuntimeError(f"{name} must be a positive integer") from error
    if value <= 0:
        raise RuntimeError(f"{name} must be a positive integer")
    return value


__all__ = [
    "AGENT_BUDGET_REACHED",
    "AGENT_BUDGET_REASONS",
    "AGENT_CONTEXT_TRIMMED",
    "AgentRunBudgetMiddleware",
    "FINALIZE_INSTRUCTION",
]


def _tool_name(tool: Any) -> str | None:
    return getattr(tool, "name", None) or (tool.get("name") if isinstance(tool, dict) else None)
