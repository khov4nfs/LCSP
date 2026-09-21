from __future__ import annotations

from threading import Event
from time import monotonic

from langchain_core.messages import AIMessageChunk, ToolMessage

from orchestration.agent_stream import (
    AgentStreamSession,
    BufferedAgentStreamEmitter,
    activate_agent_stream,
    invoke_graph_with_stream,
    invoke_with_stream,
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
