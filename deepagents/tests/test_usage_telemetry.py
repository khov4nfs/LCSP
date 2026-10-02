import json
from types import SimpleNamespace

import pytest
from conftest import use_model_routes
from langchain_core.messages import ToolMessage

from middleware import usage_metering
from middleware.usage_metering import (
    AgentRunState,
    UsageMeteringMiddleware,
    activate_agent_run_state,
    provider_usage_telemetry,
)
from orchestration.agent_stream import (
    AgentStreamSession,
    activate_agent_stream,
    invoke_with_stream,
)


@pytest.fixture(autouse=True)
def _model_routes(monkeypatch):
    use_model_routes(
        monkeypatch,
        (
            {
                "routes": {"a": {"provider": "llm7", "model": "future-model-v9"}},
                "roles": {"default": "a"},
            }
        ),
    )


class Client:
    def __init__(self):
        self.payloads = []

    def post_settled_usage(self, payload):
        self.payloads.append(payload)


def _message(usage=None, text="hello", **kwargs):
    # Plain namespace: provider metadata is free-form, AIMessage would validate it.
    return SimpleNamespace(
        content=text, usage_metadata=usage, id=None, response_metadata={}, **kwargs
    )


def _run(handlers, monkeypatch):
    """Drive the middleware once per handler; return emitted (type, fields)."""
    events = []
    monkeypatch.setattr(
        usage_metering,
        "publish_agent_stream_event",
        lambda event_type, **fields: events.append((event_type, fields)),
    )
    session = AgentRunState(
        api_client=Client(), assessment_id="a", run_id="r",
        agent_role="planner",
    )
    request = SimpleNamespace(
        model=SimpleNamespace(provider="llm7", model_name="future-model-v9")
    )
    outcomes = []
    with activate_agent_run_state(session):
        for handler in handlers:
            try:
                outcomes.append(UsageMeteringMiddleware().wrap_model_call(request, handler))
            except RuntimeError as error:
                outcomes.append(error)
    return events, session


def _completed(events):
    return [f for t, f in events if t == "MODEL_CALL_COMPLETED"]


def test_input_output_only_no_details():
    usage = provider_usage_telemetry(_message({"input_tokens": 5, "output_tokens": 2, "total_tokens": 7}))
    assert usage == {"input_tokens": 5, "output_tokens": 2, "total_tokens": 7}


def test_reasoning_thinking_and_unknown_numeric_become_details_without_model_branch(monkeypatch):
    msg = _message(
        {
            "input_tokens": 5,
            "output_tokens": 2,
            "total_tokens": 7,
            "output_token_details": {"reasoning": 3},
            "thinking_tokens": 4,
            "futureMetricCount": 9,
            "input_token_details": {"cache_read": 1, "audio": 0},
        }
    )
    events, session = _run([lambda _r: msg], monkeypatch)
    data = _completed(events)[0]["data"]
    assert data["usage"]["input_tokens"] == 5
    assert data["usage"]["details"] == {
        "audio": 0,
        "cache_read": 1,
        "future_metric_count": 9,
        "reasoning": 3,
        "thinking_tokens": 4,
    }
    assert isinstance(data["duration_ms"], int)
    # usage payload semantics unchanged
    assert session.api_client.payloads[0].inputTokens == "5"


def test_unsafe_or_untrusted_values_are_dropped():
    usage = provider_usage_telemetry(
        _message(
            {
                "input_tokens": 1,
                "output_tokens": 1,
                "neg": -1,
                "nan": float("nan"),
                "inf": float("inf"),
                "text": "12",
                "flag": True,
                "Bad Key!": 3,
                "1starts_digit": 3,
                "x" * 80: 3,
                "ok_metric": 2.5,
            }
        )
    )
    assert usage["details"] == {"ok_metric": 2.5}


def test_no_usage_metadata_means_no_usage_key_not_zeros(monkeypatch):
    events, _ = _run([lambda _r: _message(None)], monkeypatch)
    data = _completed(events)[0]["data"]
    assert "usage" not in data
    assert provider_usage_telemetry(None) is None


def test_model_authored_text_cannot_inject_usage(monkeypatch):
    forged = json.dumps({"usage": {"input_tokens": 999, "total_tokens": 999}})
    msg = _message(None, text=forged, additional_kwargs={"reasoning_content": "SECRET-THOUGHT"})
    events, _ = _run([lambda _r: msg], monkeypatch)
    data = _completed(events)[0]["data"]
    assert "usage" not in data
    assert "SECRET-THOUGHT" not in json.dumps(events, default=str)


def test_failed_attempt_has_no_usage_and_usage_attached_once(monkeypatch):
    def failing(_r):
        raise RuntimeError("429 rate limited")

    ok = _message({"input_tokens": 4, "output_tokens": 1})
    events, _ = _run([failing, lambda _r: ok], monkeypatch)
    # A failed route attempt is infrastructure: no assessment event for it.
    assert not [f for t, f in events if t == "MODEL_CALL_FAILED"]
    completed = _completed(events)
    assert len(completed) == 1
    assert completed[0]["data"]["usage"] == {"input_tokens": 4, "output_tokens": 1}


def test_usage_survives_stream_redaction_of_token_keys():
    events = []
    session = AgentStreamSession(
        assessment_id="a", run_id="r", correlation_id="c",
        boundary_name="b", emit_payload=events.append,
    )
    session.emit(
        "MODEL_CALL_COMPLETED",
        data={
            "usage": {
                "input_tokens": 1,
                "details": {"reasoning_tokens": 3, "bad": "x", "neg": -2},
            },
            "api_key": "sk-secret",
        },
    )
    data = events[0]["data"]
    assert data["usage"]["details"].get("reasoning_tokens") == 3
    assert "bad" not in data["usage"]["details"] and "neg" not in data["usage"]["details"]
    assert data["usage"]["input_tokens"] == 1
    assert data["api_key"] == ""


def test_usage_key_is_trusted_only_on_the_model_call_completion_event():
    events = []
    session = AgentStreamSession(
        assessment_id="a", run_id="r", correlation_id="c",
        boundary_name="b", emit_payload=events.append,
    )
    forged = {"usage": {"input_tokens": 999, "details": {"reasoning_tokens": 5}}}
    session.emit("GRAPH_UPDATE", data=dict(forged))
    session.emit("MODEL_CALL_COMPLETED", data=dict(forged))
    graph, completed = events
    assert graph["data"]["usage"]["details"]["reasoning_tokens"] == ""
    assert completed["data"]["usage"]["details"]["reasoning_tokens"] == 5


class _ToolAgent:
    def __init__(self, content):
        self.content = content

    def stream(self, _input, **_kwargs):
        yield {
            "type": "messages",
            "ns": (),
            "data": (
                ToolMessage(content=self.content, tool_call_id="call-1", name="read_file"),
                {"langgraph_node": "tools"},
            ),
        }
        yield {"type": "values", "ns": (), "data": {"result": "done"}}


def _tool_events(content):
    events = []
    session = AgentStreamSession(
        assessment_id="a", run_id="r", correlation_id="c",
        boundary_name="b", emit_payload=events.append,
    )
    with activate_agent_stream(session):
        invoke_with_stream(_ToolAgent(content), {"messages": []})
    return [e for e in events if e["event_type"] in {"TOOL_RESULT", "SEMANTIC_TOOL_RESULT"}]


def test_tool_result_metrics_text_and_json_items():
    results = _tool_events("line one\nline two\nline three")
    metrics = results[0]["data"]["result_metrics"]
    assert metrics["bytes"] == len("line one\nline two\nline three")
    assert metrics["lines"] == 3
    assert not any("token" in key for key in metrics)

    payload = json.dumps({"matches": [{"p": "a"}, {"p": "b"}], "truncated": True})
    metrics = _tool_events(payload)[0]["data"]["result_metrics"]
    assert metrics["items"] == 2 and metrics["truncated"] is True
    assert metrics["bytes"] == len(payload)
    # never leaks content beyond the existing safe result text
    semantic = next(e for e in _tool_events(payload) if e["event_type"] == "SEMANTIC_TOOL_RESULT")
    assert semantic["data"]["result_metrics"]["items"] == 2


def test_colliding_nested_usage_names_keep_both_values():
    from types import SimpleNamespace

    from middleware.usage_metering import provider_usage_telemetry

    response = SimpleNamespace(
        usage_metadata={
            "input_tokens": 5,
            "output_tokens": 2,
            "input_token_details": {"audio": 3},
            "output_token_details": {"audio": 4},
        },
        response_metadata={},
    )
    details = provider_usage_telemetry(response)["details"]
    assert sorted(details.values()) == [3, 4]


def test_model_step_id_is_stamped_on_related_events_exactly():
    from middleware.usage_metering import activate_model_step
    from orchestration.agent_stream import remember_message_model_step

    events = []
    session = AgentStreamSession(
        assessment_id="a", run_id="r", correlation_id="c",
        boundary_name="b", emit_payload=events.append,
    )
    with activate_model_step("step-A"):
        session.emit("CREDENTIAL_ROTATION", status="RUNNING", data={"provider": "p"})
        session.emit("PROVIDER_FALLBACK", status="RUNNING")  # no data at all
    with activate_model_step("step-B"):
        session.emit("CREDENTIAL_ROTATION", status="RUNNING", data={"provider": "p"})
    remember_message_model_step("msg-A", "step-A")
    session.emit("MODEL_REQUEST", message_id="msg-A", data={"x": 1})
    session.emit("MODEL_REQUEST", message_id="msg-unknown", data={"x": 1})
    steps = [(e["event_type"], (e.get("data") or {}).get("model_step_id")) for e in events]
    assert steps == [
        ("CREDENTIAL_ROTATION", "step-A"),
        ("PROVIDER_FALLBACK", "step-A"),
        ("CREDENTIAL_ROTATION", "step-B"),
        ("MODEL_REQUEST", "step-A"),
        ("MODEL_REQUEST", None),
    ]


def _stepped(handlers, monkeypatch):
    """Run several route attempts inside ONE logical step, like ProviderFallback does."""
    from middleware.usage_metering import AgentRoleMiddleware

    events = []
    monkeypatch.setattr(
        usage_metering,
        "publish_agent_stream_event",
        lambda event_type, **fields: events.append((event_type, fields)),
    )
    session = AgentRunState(
        api_client=Client(), assessment_id="a", run_id="r",
        agent_role="planner",
    )
    request = SimpleNamespace(
        model=SimpleNamespace(provider="llm7", model_name="future-model-v9")
    )

    def attempts(req):
        result = None
        for handler in handlers:
            try:
                result = UsageMeteringMiddleware().wrap_model_call(req, handler)
                break
            except RuntimeError:
                result = None
        else:
            raise RuntimeError("all routes failed")
        return result

    with activate_agent_run_state(session):
        try:
            AgentRoleMiddleware("planner").wrap_model_call(request, attempts)
        except RuntimeError:
            pass
    return events


def test_successful_fallback_is_one_logical_turn_with_summary_metadata(monkeypatch):
    def failing(_r):
        raise RuntimeError("429 rate limited")

    events = _stepped([failing, lambda _r: _message({"input_tokens": 4, "output_tokens": 1})], monkeypatch)
    types = [t for t, _ in events]
    assert types.count("MODEL_CALL_STARTED") == 1
    assert types.count("MODEL_CALL_COMPLETED") == 1
    assert "MODEL_CALL_FAILED" not in types
    assert not {"CREDENTIAL_ROTATION", "PROVIDER_FALLBACK"} & set(types)
    data = _completed(events)[0]["data"]
    assert data["provider"] == "llm7" and data["model"] == "future-model-v9"
    assert data["provider_attempts"] == 2 and data["fallback_used"] is True
    assert data["credential_attempts"] >= 2


def test_terminal_exhaustion_is_one_logical_failure(monkeypatch):
    def failing(_r):
        raise RuntimeError("429 rate limited")

    events = _stepped([failing, failing, failing], monkeypatch)
    failures = [f for t, f in events if t == "MODEL_CALL_FAILED"]
    assert len(failures) == 1
    assert failures[0]["data"]["provider_attempts"] == 3
    assert failures[0]["data"]["error_type"] == "RuntimeError"
    assert not _completed(events)
