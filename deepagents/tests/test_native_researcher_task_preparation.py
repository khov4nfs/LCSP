"""Offline probe for the installed Deep Agents native ``task`` contract."""

from typing import Any

import pytest
from deepagents import create_deep_agent
from deepagents.middleware.subagents import TaskToolSchema
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.tools import tool
from pydantic import Field


TASK_DESCRIPTION = "Inspect one bounded repository surface and return one report."
PARENT_SYSTEM_PRIVATE = "PARENT_SYSTEM_PRIVATE_MARKER"
PARENT_USER_PRIVATE = "PARENT_USER_PRIVATE_MARKER"
CHILD_RESULT = "CHILD_RESULT_MARKER"


def _tool_name(candidate: Any) -> str:
    if hasattr(candidate, "name"):
        return str(candidate.name)
    return str(candidate.get("function", {}).get("name", ""))


class ScriptedModel(BaseChatModel):
    """Deterministic, provider-free model used only to drive native graph turns."""

    responses: list[AIMessage] = Field(default_factory=list)
    prompts: list[list[Any]] = Field(default_factory=list)
    bound_tool_names: list[list[str]] = Field(default_factory=list)
    bound_tools: list[list[Any]] = Field(default_factory=list)

    @property
    def _llm_type(self) -> str:
        return "offline-native-task-probe"

    def bind_tools(self, tools: Any, **kwargs: Any) -> "ScriptedModel":
        bound = list(tools)
        self.bound_tools.append(bound)
        self.bound_tool_names.append([_tool_name(candidate) for candidate in bound])
        return self

    def _generate(self, messages: list[Any], **kwargs: Any) -> ChatResult:
        self.prompts.append(list(messages))
        if not self.responses:
            raise AssertionError("scripted model received an unexpected model turn")
        return ChatResult(generations=[ChatGeneration(message=self.responses.pop(0))])


def _task_call(*, description: str = TASK_DESCRIPTION) -> AIMessage:
    return AIMessage(
        content="",
        tool_calls=[
            {
                "name": "task",
                "args": {
                    "description": description,
                    "subagent_type": "repository-researcher",
                },
                "id": "task-probe-1",
            }
        ],
    )


def _agent(parent: ScriptedModel, child: ScriptedModel, *, tools: list[Any] | None = None):
    return create_deep_agent(
        model=parent,
        system_prompt=PARENT_SYSTEM_PRIVATE,
        subagents=[
            {
                "name": "repository-researcher",
                "description": "Return bounded source-grounded observations.",
                "model": child,
                "tools": tools or [],
                "system_prompt": "CHILD_ONLY_INSTRUCTIONS",
                "mode": "isolated",
            }
        ],
    )


def _message_text(messages: list[Any]) -> str:
    return "\n".join(str(getattr(message, "content", "")) for message in messages)


def _bounded_read_tool(calls: list[str]):
    @tool("bounded_read_probe")
    def bounded_read(request: str) -> str:
        """Return one bounded, read-only probe value."""

        calls.append(request)
        return "BOUNDED_READ_RESULT"

    return bounded_read


def _failing_read_tool(calls: list[str]):
    @tool("failing_read_probe")
    def failing_read(request: str) -> str:
        """Fail deterministically to expose native task error propagation."""

        calls.append(request)
        raise RuntimeError("bounded probe failure")

    return failing_read


def test_native_task_schema_and_tool_advertisement() -> None:
    parent = ScriptedModel(responses=[AIMessage(content="parent done")])
    child = ScriptedModel(responses=[AIMessage(content="unused")])

    _agent(parent, child).invoke({"messages": [{"role": "user", "content": "start"}]})

    task_tool = next(
        candidate
        for bound in parent.bound_tools
        for candidate in bound
        if _tool_name(candidate) == "task"
    )
    assert task_tool.args_schema is TaskToolSchema
    assert set(TaskToolSchema.model_fields) == {"description", "subagent_type"}
    assert "task" in {name for bound in parent.bound_tool_names for name in bound}


def test_native_task_isolates_parent_prompt_and_returns_one_child_result() -> None:
    parent = ScriptedModel(
        responses=[_task_call(), AIMessage(content="PARENT_RESULT_MARKER")]
    )
    child = ScriptedModel(responses=[AIMessage(content=CHILD_RESULT)])

    result = _agent(parent, child).invoke(
        {"messages": [{"role": "user", "content": PARENT_USER_PRIVATE}]}
    )

    child_prompt = child.prompts[0]
    assert [message.content for message in child_prompt if isinstance(message, HumanMessage)] == [
        TASK_DESCRIPTION
    ]
    assert "CHILD_ONLY_INSTRUCTIONS" in _message_text(child_prompt)
    assert PARENT_SYSTEM_PRIVATE not in _message_text(child_prompt)
    assert PARENT_USER_PRIVATE not in _message_text(child_prompt)
    assert child.bound_tool_names

    parent_tool_messages = [
        message for message in parent.prompts[1] if isinstance(message, ToolMessage)
    ]
    assert len(parent_tool_messages) == 1
    assert parent_tool_messages[0].content == CHILD_RESULT
    assert result["messages"][-1].content == "PARENT_RESULT_MARKER"
    assert len(parent.prompts) == 2
    assert len(child.prompts) == 1


def test_native_task_runs_one_bounded_read_only_child_tool() -> None:
    calls: list[str] = []
    parent = ScriptedModel(
        responses=[_task_call(), AIMessage(content="parent received child report")]
    )
    child = ScriptedModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "bounded_read_probe",
                        "args": {"request": "one bounded request"},
                        "id": "read-probe-1",
                    }
                ],
            ),
            AIMessage(content="child read report"),
        ]
    )

    _agent(parent, child, tools=[_bounded_read_tool(calls)]).invoke(
        {"messages": [{"role": "user", "content": "private parent request"}]}
    )

    advertised = {name for bound in child.bound_tool_names for name in bound}
    assert "bounded_read_probe" in advertised
    assert calls == ["one bounded request"]
    assert len(child.prompts) == 2
    assert any(
        isinstance(message, ToolMessage)
        and message.content == "BOUNDED_READ_RESULT"
        for message in child.prompts[1]
    )


def test_native_task_surfaces_child_tool_failure_without_parent_result() -> None:
    calls: list[str] = []
    parent = ScriptedModel(responses=[_task_call()])
    child = ScriptedModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "failing_read_probe",
                        "args": {"request": "fail once"},
                        "id": "failure-probe-1",
                    }
                ],
            )
        ]
    )

    with pytest.raises(RuntimeError, match="bounded probe failure"):
        _agent(parent, child, tools=[_failing_read_tool(calls)]).invoke(
            {"messages": [{"role": "user", "content": "start"}]}
        )

    assert calls == ["fail once"]
    assert len(parent.prompts) == 1
    assert len(child.prompts) == 1
