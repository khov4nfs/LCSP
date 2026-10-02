from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from middleware.agent_run_budget import (
    FINALIZE_INSTRUCTION,
    AgentRunBudgetMiddleware,
)
from middleware.failure_policy import (
    AgentRunBudgetExceeded,
    is_terminal_boundary_error,
    retry_model_error,
)
from orchestration.agent_stream import AgentStreamSession, activate_agent_stream


@dataclass
class FakeRequest:
    messages: list[Any]
    tools: list[Any] = field(default_factory=lambda: ["read_file", "grep"])
    state: dict[str, Any] = field(default_factory=dict)
    model: Any = None
    system_prompt: str | None = None
    response_format: Any = None
    tool_choice: Any = None

    def override(self, **changes: Any) -> "FakeRequest":
        return replace(self, **changes)


class ProfiledModel:
    def __init__(self, max_input_tokens: int) -> None:
        self.profile = {"max_input_tokens": max_input_tokens}


def _tool_turn(index: int, payload: str) -> list[Any]:
    call_id = f"call-{index}"
    return [
        AIMessage(
            content="",
            tool_calls=[{"name": "read_file", "args": {"path": str(index)}, "id": call_id}],
        ),
        ToolMessage(content=payload, tool_call_id=call_id, name="read_file"),
    ]


def _events(session_events: list[dict[str, Any]]) -> AgentStreamSession:
    return AgentStreamSession(
        assessment_id="assessment-1",
        run_id="run-1",
        correlation_id="corr-1",
        boundary_name="engineering",
        emit_payload=session_events.append,
    )


def test_under_budget_request_is_unchanged():
    middleware = AgentRunBudgetMiddleware(finalize_after=5, grace_calls=2)
    request = FakeRequest(messages=[HumanMessage(content="plan")], state={})

    assert middleware._bounded_request(request) is request


def test_after_finalize_threshold_tools_are_withdrawn_and_answer_is_requested():
    middleware = AgentRunBudgetMiddleware(finalize_after=3, grace_calls=2)
    request = FakeRequest(
        messages=[HumanMessage(content="plan")],
        state={"lcsp_run_model_call_count": 3},
    )
    events: list[dict[str, Any]] = []

    with activate_agent_stream(_events(events)):
        bounded = middleware._bounded_request(request)

    assert bounded.tools == []
    assert bounded.messages[-1].content == FINALIZE_INSTRUCTION
    assert [event["event_type"] for event in events] == ["AGENT_BUDGET_REACHED"]
    assert events[0]["data"]["reason"] == "MODEL_CALL_BUDGET"


def test_hard_limit_is_terminal_and_never_retried():
    middleware = AgentRunBudgetMiddleware(finalize_after=3, grace_calls=2)
    request = FakeRequest(
        messages=[HumanMessage(content="plan")],
        state={"lcsp_run_model_call_count": 5},
    )

    with pytest.raises(AgentRunBudgetExceeded) as raised:
        middleware._bounded_request(request)

    assert is_terminal_boundary_error(raised.value)
    assert retry_model_error(raised.value) is False


def test_after_model_counts_calls_for_this_run():
    middleware = AgentRunBudgetMiddleware(finalize_after=3, grace_calls=2)

    assert middleware.after_model({}, None) == {"lcsp_run_model_call_count": 1}
    assert middleware.after_model({"lcsp_run_model_call_count": 4}, None) == {
        "lcsp_run_model_call_count": 5
    }


def test_context_budget_trims_old_tool_results_and_keeps_the_newest():
    middleware = AgentRunBudgetMiddleware(
        finalize_after=50, grace_calls=2, keep_tool_results=2
    )
    messages: list[Any] = [HumanMessage(content="plan")]
    for index in range(6):
        messages.extend(_tool_turn(index, "x" * 3_000))
    request = FakeRequest(
        messages=messages,
        state={"lcsp_run_model_call_count": 6},
        model=ProfiledModel(max_input_tokens=5_000),
    )
    events: list[dict[str, Any]] = []

    with activate_agent_stream(_events(events)):
        bounded = middleware._bounded_request(request)

    tool_results = [message for message in bounded.messages if isinstance(message, ToolMessage)]
    assert [message.content == "x" * 3_000 for message in tool_results] == [
        False,
        False,
        False,
        False,
        True,
        True,
    ]
    # The original state is never edited; only this request is trimmed.
    assert all(
        message.content == "x" * 3_000
        for message in messages
        if isinstance(message, ToolMessage)
    )
    assert events[0]["event_type"] == "AGENT_CONTEXT_TRIMMED"
    assert events[0]["data"]["cleared_tool_results"] == 4
    assert bounded.tools == ["read_file", "grep"]


def test_context_that_cannot_be_trimmed_under_budget_finalizes():
    middleware = AgentRunBudgetMiddleware(
        finalize_after=50, grace_calls=2, keep_tool_results=2
    )
    messages: list[Any] = [HumanMessage(content="p" * 30_000)]
    messages.extend(_tool_turn(0, "small"))
    request = FakeRequest(
        messages=messages,
        state={"lcsp_run_model_call_count": 1},
        model=ProfiledModel(max_input_tokens=5_000),
    )

    bounded = middleware._bounded_request(request)

    assert bounded.tools == []
    assert bounded.messages[-1].content == FINALIZE_INSTRUCTION


def test_real_agent_loop_that_never_stops_calling_tools_is_bounded():
    """Assessment 7976a135 regression: a Planner looped for 15 minutes (56 calls)."""
    from langchain.agents import create_agent
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.outputs import ChatGeneration, ChatResult
    from langchain_core.tools import tool

    calls: list[int] = []

    @tool
    def read_file(path: str) -> str:
        """Read one repository file."""
        return f"contents of {path}"

    class AlwaysExploringModel(BaseChatModel):
        tools_bound: bool = False

        @property
        def _llm_type(self) -> str:
            return "always-exploring"

        def bind_tools(self, tools, **kwargs):
            return self.model_copy(update={"tools_bound": bool(tools)})

        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            calls.append(len(messages))
            if self.tools_bound:
                message = AIMessage(
                    content="Let me read one more file.",
                    tool_calls=[
                        {
                            "name": "read_file",
                            "args": {"path": f"file-{len(calls)}.py"},
                            "id": f"call-{len(calls)}",
                        }
                    ],
                )
            else:
                message = AIMessage(content="Final answer from inspected evidence.")
            return ChatResult(generations=[ChatGeneration(message=message)])

    agent = create_agent(
        AlwaysExploringModel(),
        tools=[read_file],
        middleware=[AgentRunBudgetMiddleware(finalize_after=4, grace_calls=2)],
    )

    result = agent.invoke({"messages": [HumanMessage(content="plan the rules")]})

    assert len(calls) == 5
    assert result["messages"][-1].content == "Final answer from inspected evidence."


def test_budget_event_types_exist_in_shared_typescript_contract():
    """The API rejects stream events whose type the shared contract does not list."""
    import re
    from pathlib import Path

    from middleware.agent_run_budget import AGENT_BUDGET_REACHED, AGENT_CONTEXT_TRIMMED

    contract = (
        Path(__file__).resolve().parents[2]
        / "packages/contracts/src/evidence/assessment-runtime.ts"
    ).read_text()
    block = re.search(
        r"export const ASSESSMENT_AGENT_STREAM_EVENT_TYPES = \{(.*?)\} as const;",
        contract,
        re.S,
    )
    assert block is not None
    supported = set(re.findall(r':\s*"([A-Z0-9_]+)"', block.group(1)))
    assert {AGENT_BUDGET_REACHED, AGENT_CONTEXT_TRIMMED} <= supported
