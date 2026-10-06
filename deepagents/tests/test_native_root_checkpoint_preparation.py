"""Offline probe for native Root interrupt/checkpoint/resume behavior."""

from typing import Any

from deepagents import create_deep_agent
from langchain_core.messages import AIMessage
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command, interrupt

from tests.test_native_researcher_task_preparation import ScriptedModel


THREAD_A = "native-root-thread-a"
THREAD_B = "native-root-thread-b"


def _tool_call(request: str, call_id: str) -> AIMessage:
    return AIMessage(
        content="",
        tool_calls=[
            {
                "name": "root_interrupt_probe",
                "args": {"request": request},
                "id": call_id,
            }
        ],
    )


def _interrupt_payloads(checkpointer: InMemorySaver, config: dict[str, Any]) -> list[Any]:
    payloads: list[Any] = []
    latest = next(checkpointer.list(config), None)
    if latest is None:
        return payloads
    for _, channel, writes in latest.pending_writes:
        if channel == "__interrupt__":
            payloads.extend(item.value for item in writes)
    return payloads


def _checkpoint_ids(checkpointer: InMemorySaver, config: dict[str, Any]) -> set[str]:
    return {
        str(saved.config["configurable"]["checkpoint_id"])
        for saved in checkpointer.list(config)
    }


def test_native_root_interrupt_resume_replays_tool_and_isolates_threads() -> None:
    tool_events: list[tuple[str, str]] = []

    @tool("root_interrupt_probe")
    def root_interrupt_probe(request: str) -> str:
        """Pause the native Root graph for one synthetic approval."""

        tool_events.append(("entered", request))
        decision = interrupt(
            {
                "kind": "ROOT_ONLY_APPROVAL",
                "thread_marker": request,
                "private_marker": f"private:{request}",
            }
        )
        tool_events.append(("resumed", request))
        return f"ROOT_TOOL_RESUMED:{request}:{decision}"

    root_model = ScriptedModel(
        responses=[
            _tool_call(THREAD_A, "root-call-a"),
            AIMessage(content="ROOT_DONE_THREAD_A"),
            _tool_call(THREAD_B, "root-call-b"),
            AIMessage(content="ROOT_DONE_THREAD_B"),
        ]
    )
    checkpointer = InMemorySaver()
    root = create_deep_agent(
        model=root_model,
        tools=[root_interrupt_probe],
        subagents=[
            {
                "name": "general-purpose",
                "description": "Unused in this Root-only probe.",
                "model": root_model,
                "tools": [],
            }
        ],
        name="native-root-checkpoint-preparation",
        checkpointer=checkpointer,
    )
    config_a = {"configurable": {"thread_id": THREAD_A}}
    config_b = {"configurable": {"thread_id": THREAD_B}}

    paused_a = root.invoke(
        {"messages": [{"role": "user", "content": "start thread A"}]},
        config_a,
    )

    assert len(paused_a["__interrupt__"]) == 1
    assert paused_a["__interrupt__"][0].value == {
        "kind": "ROOT_ONLY_APPROVAL",
        "thread_marker": THREAD_A,
        "private_marker": f"private:{THREAD_A}",
    }
    assert tool_events == [("entered", THREAD_A)]
    assert _interrupt_payloads(checkpointer, config_a) == [
        paused_a["__interrupt__"][0].value
    ]

    resumed_a = root.invoke(Command(resume={"approved": THREAD_A}), config_a)

    assert resumed_a["messages"][-1].content == "ROOT_DONE_THREAD_A"
    assert tool_events == [
        ("entered", THREAD_A),
        ("entered", THREAD_A),
        ("resumed", THREAD_A),
    ]
    assert _interrupt_payloads(checkpointer, config_a) == []

    paused_b = root.invoke(
        {"messages": [{"role": "user", "content": "start thread B"}]},
        config_b,
    )

    assert paused_b["__interrupt__"][0].value == {
        "kind": "ROOT_ONLY_APPROVAL",
        "thread_marker": THREAD_B,
        "private_marker": f"private:{THREAD_B}",
    }
    assert _interrupt_payloads(checkpointer, config_a) == []
    assert _interrupt_payloads(checkpointer, config_b) == [
        paused_b["__interrupt__"][0].value
    ]

    resumed_b = root.invoke(Command(resume={"approved": THREAD_B}), config_b)

    assert resumed_b["messages"][-1].content == "ROOT_DONE_THREAD_B"
    assert tool_events == [
        ("entered", THREAD_A),
        ("entered", THREAD_A),
        ("resumed", THREAD_A),
        ("entered", THREAD_B),
        ("entered", THREAD_B),
        ("resumed", THREAD_B),
    ]
    assert len(root_model.prompts) == 4
    assert root_model.responses == []
    assert any(
        "root_interrupt_probe" in names for names in root_model.bound_tool_names
    )

    checkpoint_ids_a = _checkpoint_ids(checkpointer, config_a)
    checkpoint_ids_b = _checkpoint_ids(checkpointer, config_b)
    assert checkpoint_ids_a
    assert checkpoint_ids_b
    assert checkpoint_ids_a.isdisjoint(checkpoint_ids_b)
    assert {
        saved.config["configurable"]["thread_id"]
        for saved in checkpointer.list(None)
    } == {THREAD_A, THREAD_B}

    state_a_text = "\n".join(
        str(message.content) for message in root.get_state(config_a).values["messages"]
    )
    state_b_text = "\n".join(
        str(message.content) for message in root.get_state(config_b).values["messages"]
    )
    assert THREAD_A in state_a_text and THREAD_B not in state_a_text
    assert THREAD_B in state_b_text and THREAD_A not in state_b_text
