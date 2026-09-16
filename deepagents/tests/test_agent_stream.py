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
                {"langgraph_node": "model", "ls_provider": "openai"},
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
    assert "TOOL_CALL_DELTA" in types
    assert "TOOL_RESULT" in types
    assert "GRAPH_UPDATE" in types
    assert "CUSTOM_PROGRESS" in types
    assert types[-1] == "AGENT_COMPLETED"

    reasoning = next(event for event in events if event["event_type"] == "MODEL_REASONING_DELTA")
    assert reasoning["text"] == "Checked evidence"
    assert "private reasoning text" not in str(events)
    assert "super-secret-value" not in str(events)

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

