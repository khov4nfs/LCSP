from __future__ import annotations

import ast
import re
from pathlib import Path

import logging
from threading import Event
from time import monotonic

from langchain_core.messages import AIMessageChunk, ToolMessage

import pytest

from orchestration.agent_stream import (
    AGENT_STREAM_STAGES,
    AgentStreamInterrupted,
    AgentStreamSession,
    BufferedAgentStreamEmitter,
    active_agent_stream_cancel,
    activate_agent_stream,
    agent_stream_stage,
    invoke_graph_with_stream,
    invoke_with_stream,
    publish_agent_stream_event,
    _should_forward_stream_log,
)


class FakeAgent:
    name = "planner"

    def __init__(self):
        self.invoked = False

    def invoke(self, input_value, config=None, context=None):
        self.invoked = True
        return {"fallback": True}

    def stream(self, input_value, **kwargs):
        yield {
            "type": "values",
            "ns": ("task:investigator",),
            "data": {"nested": True},
        }
        yield {
            "type": "messages",
            "ns": (),
            "data": (
                AIMessageChunk(
                    id="msg-1",
                    content=[
                        {"type": "text", "text": "Hello "},
                        {
                            "type": "reasoning",
                            "summary": "Checked evidence",
                            "text": "private reasoning text",
                        },
                    ],
                    tool_call_chunks=[
                        {
                            "name": "lookup_rule",
                            "args": "{\"api_key\":\"super-secret-value\"}",
                            "id": "call-1",
                            "index": 0,
                        }
                    ],
                ),
                {
                    "langgraph_node": "model",
                    "ls_provider": "openai",
                    "ls_model_name": "gpt-test",
                    "finish_reason": "stop",
                },
            ),
        }
        yield {
            "type": "messages",
            "ns": (),
            "data": (
                ToolMessage(
                    content="tool result",
                    tool_call_id="call-1",
                    name="lookup_rule",
                ),
                {"langgraph_node": "tools"},
            ),
        }
        yield {
            "type": "updates",
            "ns": (),
            "data": {
                "planner": {
                    "selectedRuleIds": ["ER-1"],
                    "messages": ["private prompt"],
                    "privateContext": {"secret": "internal"},
                    "confirmed_customer_context": {"answers": {"role": "private"}},
                    "systemPrompt": "hidden system instruction",
                }
            },
        }
        yield {"type": "custom", "ns": (), "data": {"phase": "planner"}}
        yield {"type": "values", "ns": (), "data": {"result": "done"}}


class FakeGraph:
    def invoke(self, input_value, config=None):
        return {"fallback": True}

    def stream(self, input_value, **kwargs):
        yield {"type": "updates", "ns": (), "data": {"node": {"value": 1}}}
        yield {"type": "values", "ns": (), "data": {"result": "graph-done"}}


class FragmentedToolCallAgent:
    name = "planner"

    def stream(self, input_value, **kwargs):
        yield {
            "type": "messages",
            "ns": (),
            "data": (
                AIMessageChunk(
                    id="msg-fragmented",
                    content="",
                    tool_call_chunks=[
                        {
                            "name": "search_nodes",
                            "args": "{\"nodeType\":",
                            "id": "c1",
                            "index": 0,
                        }
                    ],
                ),
                {
                    "langgraph_node": "model",
                    "ls_provider": "openai",
                    "ls_model_name": "gpt-test",
                    "available_tool_names": ["search_nodes", "list_observations"],
                    "input_artifact_refs": ["artifact:input"],
                },
            ),
        }
        yield {
            "type": "messages",
            "ns": (),
            "data": (
                AIMessageChunk(
                    id="msg-fragmented",
                    content="done",
                    tool_call_chunks=[
                        {
                            "name": "",
                            "args": "\"AI_MODEL_INVOCATION\"}",
                            "id": "",
                            "index": 0,
                        }
                    ],
                ),
                {
                    "langgraph_node": "model",
                    "ls_provider": "openai",
                    "ls_model_name": "gpt-test",
                    "finish_reason": "stop",
                    "usage": {"input_tokens": 11, "output_tokens": 13},
                    "output_refs": ["artifact:output"],
                },
            ),
        }
        yield {"type": "values", "ns": (), "data": {"result": "done"}}


class StreamingFinalEmptyAgent:
    name = "planner"

    def stream(self, input_value, **kwargs):
        yield {
            "type": "messages",
            "ns": (),
            "data": (
                AIMessageChunk(id="msg-streaming", content="Hello "),
                {
                    "langgraph_node": "model",
                    "ls_provider": "openai",
                    "ls_model_name": "gpt-test",
                },
            ),
        }
        yield {
            "type": "messages",
            "ns": (),
            "data": (
                AIMessageChunk(
                    id="msg-streaming",
                    content=[
                        {
                            "type": "reasoning",
                            "summary": "provider summary",
                            "text": "hidden raw reasoning",
                        }
                    ],
                ),
                {
                    "langgraph_node": "model",
                    "ls_provider": "openai",
                    "ls_model_name": "gpt-test",
                },
            ),
        }
        yield {
            "type": "messages",
            "ns": (),
            "data": (
                AIMessageChunk(id="msg-streaming", content="",),
                {
                    "langgraph_node": "model",
                    "ls_provider": "openai",
                    "ls_model_name": "gpt-test",
                    "finish_reason": "stop",
                },
            ),
        }
        yield {"type": "values", "ns": (), "data": {"result": "done"}}


def stream_session(events):
    return AgentStreamSession(
        assessment_id="assessment-1",
        run_id="run-1",
        correlation_id="corr-1",
        boundary_name="engineering",
        emit_payload=events.append,
    )


def test_invoke_with_stream_forwards_visible_events_and_returns_root_values():
    events = []
    with activate_agent_stream(stream_session(events)):
        result = invoke_with_stream(FakeAgent(), {"messages": []})

    assert result == {"result": "done"}
    types = [event["event_type"] for event in events]
    assert types[0] == "AGENT_STARTED"
    assert "MODEL_CONTENT_DELTA" in types
    assert "MODEL_REASONING_DELTA" in types
    assert "MODEL_REQUEST" in types
    assert "MODEL_RESULT" in types
    assert "TOOL_CALL_DELTA" in types
    assert "SEMANTIC_TOOL_CALL" in types
    assert "TOOL_RESULT" in types
    assert "SEMANTIC_TOOL_RESULT" in types
    assert "GRAPH_UPDATE" in types
    assert "CUSTOM_PROGRESS" in types
    assert types[-1] == "AGENT_COMPLETED"

    reasoning = next(event for event in events if event["event_type"] == "MODEL_REASONING_DELTA")
    assert reasoning["text"] == "Checked evidence"
    assert "private reasoning text" not in str(events)
    assert "super-secret-value" not in str(events)

    model_request = next(event for event in events if event["event_type"] == "MODEL_REQUEST")
    assert model_request["data"]["kind"] == "MODEL_REQUEST"
    assert model_request["data"]["durability"] == "DURABLE"
    assert model_request["data"]["provider"] == "openai"
    assert model_request["data"]["model"] == "gpt-test"
    assert model_request["data"]["nodeName"] == "model"

    semantic_tool_call = next(
        event for event in events if event["event_type"] == "SEMANTIC_TOOL_CALL"
    )
    assert semantic_tool_call["data"]["kind"] == "TOOL_CALL"
    assert semantic_tool_call["data"]["durability"] == "DURABLE"
    assert semantic_tool_call["data"]["toolName"] == "lookup_rule"
    assert semantic_tool_call["data"]["parameters"]["api_key"] != "super-secret-value"

    model_result = next(event for event in events if event["event_type"] == "MODEL_RESULT")
    assert model_result["data"]["kind"] == "MODEL_OUTPUT"
    assert model_result["data"]["durability"] == "DURABLE"
    assert model_result["data"]["finishReason"] == "stop"

    update = next(event for event in events if event["event_type"] == "GRAPH_UPDATE")
    assert update["data"]["selectedRuleIds"] == ["ER-1"]
    assert update["data"]["messages"] == {"hidden": "private_runtime_state"}
    assert update["data"]["privateContext"] == {"hidden": "private_runtime_state"}
    assert update["data"]["confirmed_customer_context"] == {
        "hidden": "private_runtime_state"
    }
    assert update["data"]["systemPrompt"] == {"hidden": "private_runtime_state"}
    assert "hidden system instruction" not in str(events)
    assert '"role": "private"' not in str(events)


def test_invoke_with_stream_reconstructs_fragmented_semantic_tool_call_once():
    events = []
    with activate_agent_stream(stream_session(events)):
        result = invoke_with_stream(FragmentedToolCallAgent(), {"messages": []})

    assert result == {"result": "done"}
    model_requests = [
        event for event in events if event["event_type"] == "MODEL_REQUEST"
    ]
    semantic_tool_calls = [
        event for event in events if event["event_type"] == "SEMANTIC_TOOL_CALL"
    ]
    tool_deltas = [event for event in events if event["event_type"] == "TOOL_CALL_DELTA"]

    assert len(model_requests) == 1
    assert model_requests[0]["data"]["availableToolNames"] == [
        "search_nodes",
        "list_observations",
    ]
    assert model_requests[0]["data"]["inputArtifactRefs"] == ["artifact:input"]
    assert len(tool_deltas) == 2
    assert len(semantic_tool_calls) == 1
    assert semantic_tool_calls[0]["tool_call_id"] == "c1"
    assert semantic_tool_calls[0]["tool_name"] == "search_nodes"
    assert semantic_tool_calls[0]["data"]["parameters"] == {
        "nodeType": "AI_MODEL_INVOCATION"
    }

    model_result = next(event for event in events if event["event_type"] == "MODEL_RESULT")
    assert model_result["data"]["usage"] == {"input_tokens": 11, "output_tokens": 13}
    assert model_result["data"]["outputRefs"] == ["artifact:output"]
    assert model_result["data"]["resultSummary"] == {"text": "done"}


def test_model_result_summary_accumulates_prior_content_chunks_without_reasoning():
    events = []
    with activate_agent_stream(stream_session(events)):
        invoke_with_stream(StreamingFinalEmptyAgent(), {"messages": []})

    model_result = next(event for event in events if event["event_type"] == "MODEL_RESULT")

    assert model_result["data"]["resultSummary"] == {"text": "Hello "}
    assert "hidden raw reasoning" not in str(events)


def test_invoke_with_stream_falls_back_to_invoke_without_active_session():
    agent = FakeAgent()
    result = invoke_with_stream(agent, {"messages": []})
    assert result == {"fallback": True}
    assert agent.invoked is True


def test_invoke_graph_with_stream_emits_workflow_updates_and_returns_values():
    events = []
    with activate_agent_stream(stream_session(events)):
        result = invoke_graph_with_stream(FakeGraph(), {"input": True})

    assert result == {"result": "graph-done"}
    assert [event["event_type"] for event in events] == [
        "AGENT_STARTED",
        "GRAPH_UPDATE",
        "GRAPH_STATE",
        "AGENT_COMPLETED",
    ]


def test_buffered_emitter_preserves_order_and_flushes_on_close():
    received = []
    emitter = BufferedAgentStreamEmitter(received.append)
    emitter({"sequence": 1})
    emitter({"sequence": 2})
    emitter.close()
    assert received == [{"sequence": 1}, {"sequence": 2}]

def test_buffered_emitter_never_blocks_agent_on_backpressure():
    delivery_started = Event()
    release_delivery = Event()

    def blocked_delivery(_payload):
        delivery_started.set()
        release_delivery.wait(timeout=1.0)

    emitter = BufferedAgentStreamEmitter(
        blocked_delivery,
        max_pending=1,
        close_timeout_seconds=0.01,
    )
    emitter({"sequence": 1})
    assert delivery_started.wait(timeout=0.5)
    emitter({"sequence": 2})

    started = monotonic()
    emitter({"sequence": 3})
    elapsed = monotonic() - started
    assert elapsed < 0.05

    started = monotonic()
    emitter.close()
    elapsed = monotonic() - started
    assert elapsed < 0.1
    release_delivery.set()


def test_buffered_emitter_drops_excess_deltas_before_the_next_model_turn():
    delivery_started = Event()
    release_delivery = Event()
    delivered_turn = Event()
    received = []

    def deliver(payload):
        if payload["sequence"] == 1:
            delivery_started.set()
            release_delivery.wait(timeout=1.0)
        received.append(payload["sequence"])
        if payload["sequence"] == 4:
            delivered_turn.set()

    emitter = BufferedAgentStreamEmitter(deliver, max_pending=2)
    emitter({"sequence": 1, "event_type": "BOUNDARY_STARTED"})
    assert delivery_started.wait(timeout=0.5)
    emitter({"sequence": 2, "event_type": "MODEL_CONTENT_DELTA"})
    emitter({"sequence": 3, "event_type": "MODEL_CONTENT_DELTA"})
    emitter({"sequence": 4, "event_type": "MODEL_RESULT", "data": {"durability": "DURABLE"}})
    release_delivery.set()

    assert delivered_turn.wait(timeout=0.5)
    emitter.close()
    assert received == [1, 2, 4]


def test_buffered_emitter_keeps_pending_turn_after_bounded_close():
    delivery_started = Event()
    release_delivery = Event()
    delivered_turn = Event()

    def deliver(payload):
        if payload["sequence"] == 1:
            delivery_started.set()
            release_delivery.wait(timeout=1.0)
        if payload["sequence"] == 2:
            delivered_turn.set()

    emitter = BufferedAgentStreamEmitter(
        deliver,
        max_pending=1,
        close_timeout_seconds=0.01,
    )
    emitter({"sequence": 1, "event_type": "BOUNDARY_STARTED"})
    assert delivery_started.wait(timeout=0.5)
    emitter({"sequence": 2, "event_type": "MODEL_RESULT", "data": {"durability": "DURABLE"}})
    emitter.close()
    release_delivery.set()

    assert delivered_turn.wait(timeout=0.5)


def test_stream_log_filter_hides_framework_noise_but_keeps_failures():
    noisy_info = logging.LogRecord(
        "httpx",
        logging.INFO,
        __file__,
        1,
        "HTTP Request: POST /internal/scan-jobs",
        (),
        None,
    )
    private_info = logging.LogRecord(
        "lcsp.agent",
        logging.INFO,
        __file__,
        1,
        "PIIMiddleware[email].before_model",
        (),
        None,
    )
    useful_info = logging.LogRecord(
        "lcsp.repository",
        logging.INFO,
        __file__,
        1,
        "Repository index completed",
        (),
        None,
    )
    framework_error = logging.LogRecord(
        "httpx",
        logging.ERROR,
        __file__,
        1,
        "Provider request failed",
        (),
        None,
    )

    assert _should_forward_stream_log(noisy_info) is False
    assert _should_forward_stream_log(private_info) is False
    assert _should_forward_stream_log(useful_info) is True
    assert _should_forward_stream_log(framework_error) is True


def test_literal_agent_stream_event_types_match_shared_typescript_contract() -> None:
    """Prevent Python emitters from inventing event types the API will reject."""
    repo_root = Path(__file__).resolve().parents[2]
    contract_path = repo_root / "packages/contracts/src/evidence/assessment-runtime.ts"
    contract_text = contract_path.read_text()
    block = re.search(
        r"export const ASSESSMENT_AGENT_STREAM_EVENT_TYPES = \{(.*?)\} as const;",
        contract_text,
        re.S,
    )
    assert block is not None
    supported = set(re.findall(r':\s*"([A-Z0-9_]+)"', block.group(1)))

    emitted: set[str] = set()
    for path in (repo_root / "deepagents").rglob("*.py"):
        if ".mda" in path.parts:
            continue
        try:
            tree = ast.parse(path.read_text())
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "publish_agent_stream_event"
                and node.args
                and isinstance(node.args[0], ast.Constant)
                and isinstance(node.args[0].value, str)
            ):
                emitted.add(node.args[0].value)

    assert emitted <= supported, sorted(emitted - supported)


def test_invoke_with_stream_returns_final_values_when_nested_in_a_parent_graph_node():
    """Assessment 7976a135 regression: dispatcher specialists run inside a parent node.

    LangGraph prefixes every chunk of a graph invoked from a parent node with the
    parent task namespace, so the invoked graph's own final state is never at the
    empty namespace. The Interview specialist completed but its handoff was rejected.
    """
    from typing import TypedDict

    from langgraph.graph import END, START, StateGraph

    class State(TypedDict, total=False):
        steps: list[str]

    inner_builder = StateGraph(State)
    inner_builder.add_node("inner_step", lambda state: {"steps": [*state.get("steps", []), "inner"]})
    inner_builder.add_edge(START, "inner_step")
    inner_builder.add_edge("inner_step", END)
    inner = inner_builder.compile()

    child_builder = StateGraph(State)
    child_builder.add_node("delegate", inner)
    child_builder.add_node("finish", lambda state: {"steps": [*state["steps"], "child-final"]})
    child_builder.add_edge(START, "delegate")
    child_builder.add_edge("delegate", "finish")
    child_builder.add_edge("finish", END)
    child = child_builder.compile(name="specialist")

    returned: dict[str, object] = {}

    def parent_node(state):
        returned["value"] = invoke_with_stream(child, {"steps": []})
        return {}

    parent_builder = StateGraph(State)
    parent_builder.add_node("dispatch", parent_node)
    parent_builder.add_edge(START, "dispatch")
    parent_builder.add_edge("dispatch", END)
    parent = parent_builder.compile()

    events = []
    with activate_agent_stream(stream_session(events)):
        parent.invoke({"steps": []})

    assert returned["value"] == {"steps": ["inner", "child-final"]}


def test_invoke_with_stream_tags_every_event_with_its_pipeline_stage():
    """Interview, Planner and Investigate stream on their own timeline, like Scanner."""
    events = []
    with activate_agent_stream(stream_session(events)):
        invoke_with_stream(
            FakeAgent(),
            {"messages": []},
            stage=AGENT_STREAM_STAGES["rule_analysis"],
        )
        planner_count = len(events)
        invoke_with_stream(FakeAgent(), {"messages": []})

    assert planner_count
    assert {event.get("stage") for event in events[:planner_count]} == {"RULE_ANALYSIS"}
    assert events[planner_count:]
    assert all("stage" not in event for event in events[planner_count:])


def test_nested_stage_wins_over_session_default_and_enclosing_stage():
    events = []
    session = stream_session(events)
    session.stage = AGENT_STREAM_STAGES["scanner"]
    boundaries = []
    with activate_agent_stream(session):
        with agent_stream_stage(AGENT_STREAM_STAGES["rule_analysis"]):
            invoke_with_stream(
                FakeAgent(),
                {"messages": []},
                stage=AGENT_STREAM_STAGES["interview"],
            )
            boundaries.append(len(events))
            invoke_with_stream(FakeAgent(), {"messages": []})
            boundaries.append(len(events))
        invoke_with_stream(FakeAgent(), {"messages": []})

    stages = [event["stage"] for event in events]
    first, second = boundaries
    assert set(stages[:first]) == {"INTERVIEW"}
    assert set(stages[first:second]) == {"RULE_ANALYSIS"}
    assert set(stages[second:]) == {"SCANNER"}


def test_new_boundary_session_does_not_inherit_scanner_stage_and_restores_parent():
    events = []
    scanner = stream_session(events)
    scanner.stage = AGENT_STREAM_STAGES["scanner"]
    interview = stream_session(events)
    interview.stage = AGENT_STREAM_STAGES["interview"]
    engineering = stream_session(events)
    with activate_agent_stream(scanner):
        with agent_stream_stage(AGENT_STREAM_STAGES["scanner"]):
            with activate_agent_stream(interview):
                publish_agent_stream_event("BOUNDARY_STARTED")
                invoke_with_stream(FakeAgent(), {"messages": []})
                publish_agent_stream_event("BOUNDARY_COMPLETED")
            interview_end = len(events)
            with activate_agent_stream(engineering):
                publish_agent_stream_event("BOUNDARY_STARTED")
                invoke_with_stream(FakeAgent(), {"messages": []}, stage=AGENT_STREAM_STAGES["rule_analysis"])
            publish_agent_stream_event("BOUNDARY_COMPLETED")
    assert {event.get("stage") for event in events[:interview_end]} == {"INTERVIEW"}
    assert "stage" not in events[interview_end]
    assert {event.get("stage") for event in events[interview_end + 1:-1]} == {"RULE_ANALYSIS"}
    assert events[-1]["stage"] == "SCANNER"


def test_agent_stream_stages_match_shared_typescript_contract() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    contract_text = (
        repo_root / "packages/contracts/src/evidence/assessment-runtime.ts"
    ).read_text()
    block = re.search(
        r"export const ASSESSMENT_AGENT_STREAM_STAGES = \{(.*?)\} as const;",
        contract_text,
        re.S,
    )
    assert block is not None
    assert set(re.findall(r':\s*"([A-Z0-9_]+)"', block.group(1))) == set(
        AGENT_STREAM_STAGES.values()
    )


class NonStreamingToolCallAgent:
    """A provider called with stream=False yields one complete AIMessage per step."""

    name = "planner"

    def stream(self, input_value, **kwargs):
        from langchain_core.messages import AIMessage

        yield {
            "type": "messages",
            "ns": (),
            "data": (
                AIMessage(
                    id="msg-complete",
                    content="I will read the auth module to check token validation.",
                    additional_kwargs={
                        "reasoning_content": "Token validation lives in auth/."
                    },
                    tool_calls=[
                        {
                            "name": "read_file",
                            "args": {"file_path": "/auth/tokens.py"},
                            "id": "call-read",
                        }
                    ],
                    response_metadata={"finish_reason": "tool_calls"},
                ),
                {
                    "langgraph_node": "model",
                    "ls_provider": "openai",
                    "ls_model_name": "gpt-test",
                },
            ),
        }
        yield {"type": "values", "ns": (), "data": {"result": "done"}}


def test_non_streaming_model_step_surfaces_reasoning_tool_calls_and_output():
    events = []
    with activate_agent_stream(stream_session(events)):
        invoke_with_stream(NonStreamingToolCallAgent(), {"messages": []})

    kinds = [
        (event["event_type"], (event.get("data") or {}).get("kind"))
        for event in events
    ]
    assert ("MODEL_REQUEST", "MODEL_REQUEST") in kinds
    assert ("CUSTOM_PROGRESS", "REASONING_SUMMARY") in kinds
    assert ("SEMANTIC_TOOL_CALL", "TOOL_CALL") in kinds
    assert ("MODEL_RESULT", "MODEL_OUTPUT") in kinds

    reasoning = next(
        event
        for event in events
        if (event.get("data") or {}).get("kind") == "REASONING_SUMMARY"
    )
    assert reasoning["data"]["resultSummary"] == {
        "summary": "Token validation lives in auth/."
    }
    assert reasoning["data"]["durability"] == "DURABLE"

    tool_call = next(
        event for event in events if event["event_type"] == "SEMANTIC_TOOL_CALL"
    )
    assert tool_call["tool_call_id"] == "call-read"
    assert tool_call["data"]["parameters"] == {"file_path": "/auth/tokens.py"}

    result = next(event for event in events if event["event_type"] == "MODEL_RESULT")
    assert result["data"]["finishReason"] == "tool_calls"
    assert result["data"]["resultSummary"] == {
        "text": "I will read the auth module to check token validation."
    }


def test_streamed_reasoning_is_one_summary_per_step_not_one_per_token():
    events = []
    with activate_agent_stream(stream_session(events)):
        invoke_with_stream(StreamingFinalEmptyAgent(), {"messages": []})

    summaries = [
        event
        for event in events
        if (event.get("data") or {}).get("kind") == "REASONING_SUMMARY"
    ]
    assert len(summaries) == 1
    assert summaries[0]["data"]["resultSummary"] == {"summary": "provider summary"}


def test_rule_scope_attributes_activity_and_reports_the_reasoning_result():
    from orchestration.agent_stream import agent_stream_rule_scope, publish_agent_stream_event

    events = []
    with activate_agent_stream(stream_session(events)):
        with agent_stream_rule_scope(
            "ER-7",
            concept="Token validation",
            required_evidence=("Tokens are validated",),
        ) as rule_stream:
            publish_agent_stream_event("LOG", text="inside rule")
            rule_stream.complete(
                [
                    {
                        "claim_type": "RULE_REQUIREMENT_MET",
                        "criterion": "Tokens are validated",
                        "confidence": 0.9,
                        "source_locations": [
                            {"path": "auth/tokens.py", "start_line": 3, "end_line": 9}
                        ],
                    }
                ]
            )
        publish_agent_stream_event("LOG", text="after rule")

    started, activity, completed, after = events
    assert started["event_type"] == "ENGINEERING_RULE"
    assert started["status"] == "RUNNING"
    assert started["data"]["concept"] == "Token validation"
    assert activity["engineering_rule_id"] == "ER-7"
    assert completed["status"] == "COMPLETED"
    assert completed["data"]["decision"] == "RULE_REQUIREMENT_MET"
    assert completed["data"]["resultSummary"]["claims"] == [
        {
            "claimType": "RULE_REQUIREMENT_MET",
            "criterion": "Tokens are validated",
            "confidence": 0.9,
            "sourceLocations": "auth/tokens.py#L3-L9",
        }
    ]
    assert "engineering_rule_id" not in after


def test_rule_scope_reports_failed_and_waiting_rules():
    from orchestration.agent_stream import agent_stream_rule_scope

    class Pending(BaseException):
        """Like TargetedInterviewPending: an intentional pause, not a failure."""

    events = []
    with activate_agent_stream(stream_session(events)):
        for error in (RuntimeError("boom"), Pending("needs input")):
            try:
                with agent_stream_rule_scope("ER-9", waiting_on=(Pending,)):
                    raise error
            except BaseException:
                pass

    statuses = [event["status"] for event in events]
    assert statuses == ["RUNNING", "FAILED", "RUNNING", "WAITING"]


def test_invoke_with_stream_raises_agent_stream_interrupted_when_cancel_is_set():
    """A nested boundary call stops cooperatively, not with a generic failure.

    local_server.py binds active_agent_stream_cancel around its own
    graph.stream(...) loop so this reaches whichever invoke_with_stream call is
    actually iterating the real per-turn reasoning loop, however deep it is.
    """
    cancel_event = Event()
    cancel_event.set()
    events = []
    with activate_agent_stream(stream_session(events)):
        token = active_agent_stream_cancel.set(cancel_event)
        try:
            with pytest.raises(AgentStreamInterrupted):
                invoke_with_stream(FakeAgent(), {"messages": []})
        finally:
            active_agent_stream_cancel.reset(token)

    # Cancellation is not an agent failure; the owning runtime emits STOPPED.
    assert events == []


def test_invoke_with_stream_ignores_an_unset_cancel_event():
    cancel_event = Event()
    events = []
    with activate_agent_stream(stream_session(events)):
        token = active_agent_stream_cancel.set(cancel_event)
        try:
            result = invoke_with_stream(FakeAgent(), {"messages": []})
        finally:
            active_agent_stream_cancel.reset(token)

    assert result == {"result": "done"}


def test_invoke_graph_with_stream_raises_agent_stream_interrupted_when_cancel_is_set():
    cancel_event = Event()
    cancel_event.set()
    events = []
    with activate_agent_stream(stream_session(events)):
        token = active_agent_stream_cancel.set(cancel_event)
        try:
            with pytest.raises(AgentStreamInterrupted):
                invoke_graph_with_stream(FakeGraph(), {"input": True})
        finally:
            active_agent_stream_cancel.reset(token)

    assert events == []
