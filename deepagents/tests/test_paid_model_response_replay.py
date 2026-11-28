"""Tests for restoring the exact paid model response without provider redispatch."""

from langchain.agents.middleware import ModelResponse
from langchain_core.messages import AIMessage
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from middleware.capability_recovery import CapabilityRecoveryStore
from middleware.envelope_encryption import WorkerEnvelopeKeyring

from middleware.usage_metering import UsageMeteringMiddleware, stamp_server_payment_decision_in_recovery_payload


def test_paid_model_response_round_trip_preserves_tool_calls_and_usage():
    # Why: A restored model node must see the exact answer and tool calls that the provider returned.
    # How: Round-trip a real LangChain ModelResponse through the bounded recovery payload.
    # Invariant: No repr-based or arbitrary-object deserialization may alter a paid response.
    response = ModelResponse(result=[AIMessage(
        content="paid answer", id="msg-1",
        tool_calls=[{"name": "lookup", "args": {"key": "value"}, "id": "call-1", "type": "tool_call"}],
        usage_metadata={"input_tokens": 3, "output_tokens": 4, "total_tokens": 7},
    )])
    payload = UsageMeteringMiddleware._serialize_model_response(response)
    recovered = UsageMeteringMiddleware._deserialize_model_response(payload)
    assert recovered.result[0].content == "paid answer"
    assert recovered.result[0].tool_calls == response.result[0].tool_calls
    assert recovered.result[0].usage_metadata == response.result[0].usage_metadata


def test_terminal_server_replay_restores_encrypted_answer_without_provider(tmp_path, monkeypatch):
    # Why: A graph replay after a paid response must use the original answer without another provider call.
    # How: Simulate a SETTLED admission replay and a matching encrypted terminal response.
    # Invariant: Server admission is still checked and the provider handler is never dispatched.
    store = CapabilityRecoveryStore(tmp_path / "recovery.db", WorkerEnvelopeKeyring("v1", b"a" * 32))
    payload = UsageMeteringMiddleware._serialize_model_response(ModelResponse(result=[AIMessage(content="paid answer")]))
    store.record_model_response(
        "adm-1", "inv-1", "run-1", "step-1", payload,
        datetime.now(timezone.utc) + timedelta(hours=24),
    )
    store.mark_model_response_terminal("adm-1")
    middleware = UsageMeteringMiddleware(recovery_store=store)
    request = SimpleNamespace(run_id="run-1", logical_operation_id="step-1", model=SimpleNamespace())
    admissions = []
    provider_calls = []

    def settled_server_replay(req, model):
        admissions.append(req.logical_operation_id)
        return {"state": "SETTLED", "admissionId": "adm-1", "invocationId": "inv-1"}

    monkeypatch.setattr(middleware, "_prepare", lambda req: (req, req.model))
    monkeypatch.setattr(middleware, "_execute_server_admission", settled_server_replay)
    answer = middleware.wrap_model_call(request, lambda req: provider_calls.append(req) or ModelResponse(result=[AIMessage(content="duplicate")]))
    assert admissions == ["step-1"]
    assert provider_calls == []
    assert answer.result[0].content == "paid answer"


def test_recovered_terminal_on_receipt_preserves_server_payment_pause():
    # Why: Startup recovery can settle after the original in-memory model response vanished.
    # How: Stamp the verified server decision into the serialized response before making it replayable.
    # Invariant: A paid replay must still pause for wallet top-up when ON settlement depleted funds.
    original = ModelResponse(result=[AIMessage(content="paid", response_metadata={"_lcsp_payment_required_after_settlement": False})])
    payload = UsageMeteringMiddleware._serialize_model_response(original)
    updated = stamp_server_payment_decision_in_recovery_payload(payload, True)
    replayed = UsageMeteringMiddleware._deserialize_model_response(updated)
    assert replayed.result[0].response_metadata["_lcsp_payment_required_after_settlement"] is True


def test_actual_admission_boundary_requires_matching_server_settled_ids(tmp_path, monkeypatch):
    # Why: A forged local terminal row must not bypass the server's current billing authority.
    # How: Exercise the real admission request path with a SETTLED server reply and matching encrypted row.
    # Invariant: No consume or provider call occurs; mismatched physical IDs fail closed.
    from test_server_issued_admission import MockWorkerApiClient, _valid_model_request
    from conftest import use_model_routes

    use_model_routes(monkeypatch, {
        "routes": {"primary": {
            "provider": "anthropic", "protocol": "anthropic", "model": "claude-sonnet-4-6",
            "options": {"context_window_tokens": 1000000, "max_output_tokens": 65536},
        }},
        "roles": {"default": "primary"},
    })

    store = CapabilityRecoveryStore(tmp_path / "recovery.db", WorkerEnvelopeKeyring("v1", b"a" * 32))
    response = ModelResponse(result=[AIMessage(content="paid answer")])
    store.record_model_response(
        "adm-1", "inv-1", "run-test-valid-1", "op-test-valid-1",
        UsageMeteringMiddleware._serialize_model_response(response),
        datetime.now(timezone.utc) + timedelta(hours=24),
    )
    store.mark_model_response_terminal("adm-1")
    client = MockWorkerApiClient()
    client.preset_admission_response = {
        **client.request_invocation_admission({}),
        "admissionId": "adm-1", "invocationId": "inv-1", "state": "SETTLED",
    }
    client.admission_requests.clear()
    monkeypatch.setattr("tools.common.capabilities.platform.api_client.WorkerApiClient", lambda *args, **kwargs: client)
    provider_calls = []
    restored = UsageMeteringMiddleware(recovery_store=store).wrap_model_call(
        _valid_model_request(), lambda req: provider_calls.append(req),
    )
    assert restored.result[0].content == "paid answer"
    assert len(client.admission_requests) == 1
    assert client.consume_requests == []
    assert provider_calls == []

    client.preset_admission_response["invocationId"] = "wrong-physical-attempt"
    from middleware.failure_policy import PaidAdmissionError
    import pytest
    with pytest.raises(PaidAdmissionError, match="ADMISSION_NOT_DISPATCHABLE"):
        UsageMeteringMiddleware(recovery_store=store).wrap_model_call(
            _valid_model_request(), lambda req: provider_calls.append(req),
        )
    assert provider_calls == []


def test_tool_call_ids_for_settlement_are_canonical_and_bounded():
    # Why: A domain rejection must refer to the physical response that actually emitted its tool call.
    # How: Extract only IDs from LangChain response tool_calls and canonicalize the resulting list.
    # Invariant: Duplicate, malformed, or unbounded IDs never enter immutable billing evidence.
    from middleware.usage_metering import extract_settlement_tool_call_ids

    response = ModelResponse(result=[AIMessage(content="", tool_calls=[
        {"name": "lookup", "args": {}, "id": "z-call", "type": "tool_call"},
        {"name": "lookup", "args": {}, "id": "a-call", "type": "tool_call"},
    ])])
    assert extract_settlement_tool_call_ids(response) == ["a-call", "z-call"]

    import pytest
    duplicate = ModelResponse(result=[AIMessage(content="", tool_calls=[
        {"name": "lookup", "args": {}, "id": "repeat", "type": "tool_call"},
        {"name": "lookup", "args": {}, "id": "repeat", "type": "tool_call"},
    ])])
    with pytest.raises(ValueError, match="Duplicate"):
        extract_settlement_tool_call_ids(duplicate)
    many = ModelResponse(result=[AIMessage(content="", tool_calls=[
        {"name": "lookup", "args": {}, "id": f"call-{i}", "type": "tool_call"}
        for i in range(65)
    ])])
    with pytest.raises(ValueError, match="maximum"):
        extract_settlement_tool_call_ids(many)
    whitespace = ModelResponse(result=[AIMessage(content="", tool_calls=[
        {"name": "lookup", "args": {}, "id": " altered ", "type": "tool_call"},
    ])])
    with pytest.raises(ValueError, match="Invalid"):
        extract_settlement_tool_call_ids(whitespace)
    unicode_id = ModelResponse(result=[AIMessage(content="", tool_calls=[
        {"name": "lookup", "args": {}, "id": "call-😀", "type": "tool_call"},
    ])])
    with pytest.raises(ValueError, match="Invalid"):
        extract_settlement_tool_call_ids(unicode_id)


def test_live_settlement_sends_only_current_response_tool_call_ids(tmp_path, monkeypatch):
    # Why: A verdict callback must not attach a failed retry's tool call to the paid attempt that settled.
    # How: Run the middleware with a real response and inspect the worker settlement payload.
    # Invariant: Only canonical IDs cross billing; no tool name, arguments, or answer content is sent.
    from test_worker_capability_envelope_recovery import MockSettlementApiClient, _valid_model_request
    from conftest import use_model_routes

    use_model_routes(monkeypatch, {
        "routes": {"primary": {
            "provider": "anthropic", "protocol": "anthropic", "model": "claude-sonnet-4-6",
            "options": {"context_window_tokens": 1000000, "max_output_tokens": 65536},
        }}, "roles": {"default": "primary"},
    })
    client = MockSettlementApiClient()
    monkeypatch.setattr("tools.common.capabilities.platform.api_client.WorkerApiClient", lambda *args, **kwargs: client)
    store = CapabilityRecoveryStore(tmp_path / "recovery.db", WorkerEnvelopeKeyring("v1", b"a" * 32))
    provider_response = AIMessage(
        content="private paid answer",
        tool_calls=[
            {"name": "secret_tool", "args": {"secret": "do not send"}, "id": "z-call", "type": "tool_call"},
            {"name": "lookup", "args": {}, "id": "a-call", "type": "tool_call"},
        ],
        usage_metadata={"input_tokens": 10, "output_tokens": 20, "total_tokens": 30},
    )
    UsageMeteringMiddleware(recovery_store=store).wrap_model_call(_valid_model_request(), lambda _: provider_response)
    assert len(client.settlement_requests) == 1
    payload = client.settlement_requests[0]
    assert payload["providerCompletionState"] == "COMPLETED"
    assert payload["toolCallIds"] == ["a-call", "z-call"]
    assert "private paid answer" not in str(payload)
    assert "do not send" not in str(payload)
    assert store.get_usage_evidence(payload["invocationId"])["toolCallIds"] == ["a-call", "z-call"]
