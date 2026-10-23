"""Offline trace integrity only; no model response or legal verdict is simulated as acceptance."""
import json
from types import SimpleNamespace

from langchain_core.messages import AIMessage, ToolMessage
from vertical.live_preparation import LiveTrace


def test_parallel_tool_results_use_callback_identity_not_last_started():
    events = []
    trace = LiveTrace(lambda event, **fields: events.append({"event": event, **fields}))
    trace.on_tool_start({"name": "get_next_review_unit"}, "", run_id="one")
    trace.on_tool_start({"name": "get_review_progress"}, "", run_id="two")
    # Same ordering as concurrent callbacks: completion order need not equal start order.
    for call_id in ("one", "two"):
        trace.on_tool_end(ToolMessage(content='{"outcome":"PASSED"}', tool_call_id=call_id), run_id=call_id)
    assert [(e["callbackRunId"], e["tool"]) for e in events if e["event"] == "tool_end"] == [
        ("one", "get_next_review_unit"), ("two", "get_review_progress"),
    ]


def test_unit_and_progress_survive_long_metadata_prefix_without_source_text():
    events = []
    trace = LiveTrace(lambda event, **fields: events.append({"event": event, **fields}))
    trace.on_tool_start({"name": "get_next_review_unit"}, "private input", run_id="unit")
    value = {"outcome": "PASSED", "sourceRevision": "a" * 64, "frontierFingerprint": "b" * 64,
             "frontierStateFingerprint": "c" * 64,
             "unit": {"sourceNodeId": "d" * 64, "node": {"content": "private source"},
                      "contentLength": 141, "contentTruncated": False},
             "progress": {"total": 12, "pending": 9, "inReview": 1, "reviewedWithClaims": 2,
                          "discoveryCompleteEligible": False, "private": "private state"}}
    trace.on_tool_end(json.dumps(value) + '\n\n[Pinned source observation metadata]\n{}', run_id="unit")
    assert events[-1]["sourceNodeId"] == "d" * 64
    assert events[-1]["progress"]["pending"] == 9 and events[-1]["contentLength"] == 141
    assert "private" not in json.dumps(events)


def test_normal_stop_and_tool_calls_are_distinguishable_without_model_text():
    events = []
    trace = LiveTrace(lambda event, **fields: events.append(fields))
    for message in [AIMessage(content="private model text", response_metadata={"stop_reason": "end_turn"}),
                    AIMessage(content="", tool_calls=[{"name": "get_next_review_unit", "args": {}, "id": "t"}],
                              response_metadata={"stop_reason": "tool_use"})]:
        trace.on_llm_end(SimpleNamespace(generations=[[SimpleNamespace(message=message)]]), run_id="model")
    assert [(e["calls"], e["toolCallCount"], e["stopReason"]) for e in events] == [(1, 0, "end_turn"), (2, 1, "tool_use")]
    assert "private" not in json.dumps(events)


def test_tool_error_does_not_retain_exception_secrets_or_other_tool_identity():
    events = []
    trace = LiveTrace(lambda event, **fields: events.append(fields))
    trace.on_tool_start({"name": "inspect_legal_node"}, "", run_id="failed")
    trace.on_tool_error(RuntimeError("private credential"), run_id="failed")
    assert events[-1]["errorType"] == "RuntimeError" and events[-1]["tool"] == "inspect_legal_node"
    assert "private" not in json.dumps(events)


def test_native_callback_and_physical_attempt_id_remain_distinct():
    from middleware.usage_metering import active_model_step_summary
    events = []
    trace = LiveTrace(lambda event, **fields: events.append(fields))
    token = active_model_step_summary.set({"settlement_invocation_id": "physical-attempt", "invocation_id": "logical-step"})
    try:
        trace.on_chat_model_start({}, [["private prompt"]], run_id="native-callback")
    finally:
        active_model_step_summary.reset(token)
    assert events == [{"callbackRunId": "native-callback", "invocationId": "physical-attempt", "messages": 1}]
