"""Server admission and local hard ceiling must agree before physical dispatch."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from langchain_core.messages import HumanMessage

from conftest import use_model_routes
from middleware.capability_recovery import CapabilityRecoveryStore
from middleware.envelope_encryption import WorkerEnvelopeKeyring
from middleware.failure_policy import PaidAdmissionError
from middleware.usage_metering import UsageMeteringMiddleware, activate_agent_run_state, activate_model_step
from tools.common.capabilities.platform.api_client import WorkerCallbackError
from test_paid_admission import native, req, request_identity, state_for, snapshot


ADMISSION_ID = "adm-local-order-1"
INVOCATION_ID = "inv-local-order-1"


@pytest.fixture(autouse=True)
def _configured_route(monkeypatch):
    # Why: Model route identity must be proven before server admission.
    # How: Register one explicit provider route for every test request.
    # Invariant: A missing route must never be silently replaced by a fallback identity.
    use_model_routes(monkeypatch, {
        "routes": {"primary": {
            "provider": "anthropic", "protocol": "anthropic", "model": "claude-sonnet-4-6",
            "options": {"context_window_tokens": 1000000, "max_output_tokens": 65536},
        }},
        "roles": {"default": "primary"},
    })


def _request():
    return SimpleNamespace(
        model=SimpleNamespace(
            provider="anthropic", protocol="anthropic", model_name="claude-sonnet-4-6",
            options={"max_output_tokens": 4096},
        ),
        messages=[HumanMessage(content="Local admission ordering")], tools=[],
        run_id="run-local-order-1", logical_operation_id="op-local-order-1",
        execution_lease_token="lease-local-order-1", assessment_id="asm-local-order-1",
    )


def _response():
    return SimpleNamespace(
        content="ok",
        usage_metadata={"input_tokens": 10, "output_tokens": 20, "total_tokens": 30},
        response_metadata={"id": "resp-local-order-1"},
    )


class _Server:
    def __init__(self, events: list[str]):
        self.events = events
        self.cancel_error: Exception | None = None
        self.cancel_response = {"state": "CONFIRMED_NO_USAGE", "slotReleased": True}
        self.consume_error: Exception | None = None

    def request_invocation_admission(self, payload):
        self.events.append("server_request")
        return {
            "admissionId": ADMISSION_ID, "invocationId": INVOCATION_ID,
            "admissionRequestId": payload["admissionRequestId"],
            "fundingPrincipal": "CUSTOMER_WALLET", "state": "ADMITTED",
            "rolloutMode": "ADMISSION_REQUIRED", "debitMode": "OFF",
            "resolvedProvider": "anthropic", "resolvedModel": "claude-sonnet-4-6",
            "maximumExposureMicrocredits": "5000000",
            "capabilityToken": "cap-token-" + "a" * 32,
            "admittedAt": "2026-11-28T00:00:00Z", "expiresAt": "2026-11-28T00:05:00Z",
        }

    def consume_invocation_admission(self, payload):
        self.events.append("server_consume")
        assert payload["invocationId"] == INVOCATION_ID
        if self.consume_error:
            raise self.consume_error
        return {"state": "IN_FLIGHT"}

    def cancel_invocation_admission(self, payload):
        self.events.append("server_cancel")
        assert payload["invocationId"] == INVOCATION_ID
        if self.cancel_error:
            raise self.cancel_error
        return self.cancel_response

    def settle_invocation_usage(self, payload):
        self.events.append("server_settle")
        return {"settled": True, "state": "SETTLED", "slotReleased": True,
                "debitMode": "OFF", "debitedMicrocredits": "0"}


def _harness(tmp_path: Path, monkeypatch):
    # Why: The cancellation tests must verify real encrypted recovery persistence.
    # How: Inject a temporary SQLite store and a controllable server boundary.
    # Invariant: No test opens a network socket or uses a production database.
    events: list[str] = []
    store = CapabilityRecoveryStore(
        tmp_path / "capabilities.sqlite3",
        WorkerEnvelopeKeyring(active_key_id="test-key", active_key_bytes=b"\x15" * 32),
    )
    server = _Server(events)
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: server,
    )
    middleware = UsageMeteringMiddleware(recovery_store=store)
    original_record = store.record_in_flight_admission

    def record(admission):
        events.append("encrypted_envelope")
        original_record(admission)

    monkeypatch.setattr(store, "record_in_flight_admission", record)
    return middleware, server, store, events


def test_local_denial_cancels_admitted_slot_and_removes_envelope_only_after_terminal_ack(tmp_path, monkeypatch):
    middleware, server, store, events = _harness(tmp_path, monkeypatch)

    def deny(_request, _invocation_id):
        events.append("local_denial")
        raise PaidAdmissionError("CALL_LIMIT", "run-local-order-1", INVOCATION_ID)

    monkeypatch.setattr(middleware, "_admit", deny)
    with pytest.raises(PaidAdmissionError) as error:
        middleware.wrap_model_call(_request(), lambda _req: events.append("provider"))
    assert error.value.reason == "CALL_LIMIT"
    assert events == ["server_request", "encrypted_envelope", "local_denial", "server_cancel"]
    assert store.get_in_flight_admission(ADMISSION_ID) is None

    # Why: A nonterminal server response cannot authorize deleting recovery evidence.
    # How: Repeat with an unconfirmed slot release and inspect the persisted envelope.
    # Invariant: Server state, never the worker's local denial, determines terminal cleanup.
    middleware, server, store, events = _harness(tmp_path / "unconfirmed", monkeypatch)
    server.cancel_response = {"state": "ADMITTED", "slotReleased": False}
    monkeypatch.setattr(middleware, "_admit", deny)
    with pytest.raises(PaidAdmissionError):
        middleware.wrap_model_call(_request(), lambda _req: events.append("provider"))
    assert store.get_in_flight_admission(ADMISSION_ID) is not None
    assert "provider" not in events and "server_consume" not in events


def test_cancel_lost_response_retains_envelope_and_never_dispatches(tmp_path, monkeypatch):
    middleware, server, store, events = _harness(tmp_path, monkeypatch)
    server.cancel_error = WorkerCallbackError(
        "lost cancel response", status_code=503, error_code="DEPENDENCY_UNAVAILABLE",
    )
    monkeypatch.setattr(middleware, "_admit", lambda _req, _id: (_ for _ in ()).throw(
        PaidAdmissionError("CALL_LIMIT", "run-local-order-1", INVOCATION_ID)
    ))
    with pytest.raises(PaidAdmissionError):
        middleware.wrap_model_call(_request(), lambda _req: events.append("provider"))
    assert events == ["server_request", "encrypted_envelope", "server_cancel"]
    assert store.get_in_flight_admission(ADMISSION_ID) is not None


def test_ambiguous_consume_and_cancel_conflict_retain_envelope_with_zero_provider_calls(tmp_path, monkeypatch):
    middleware, server, store, events = _harness(tmp_path, monkeypatch)
    monkeypatch.setattr(middleware, "_admit", lambda req, _id: req)
    server.consume_error = WorkerCallbackError(
        "consume response lost", status_code=503, error_code="DEPENDENCY_UNAVAILABLE",
    )
    server.cancel_error = WorkerCallbackError(
        "already in flight", status_code=409, error_code="BILLING_ADMISSION_ALREADY_IN_FLIGHT",
    )
    with pytest.raises(WorkerCallbackError):
        middleware.wrap_model_call(_request(), lambda _req: events.append("provider"))
    assert events == ["server_request", "encrypted_envelope", "server_consume", "server_cancel"]
    assert store.get_in_flight_admission(ADMISSION_ID) is not None


def test_terminal_cancel_releases_local_reservation_but_ambiguous_consume_keeps_it(tmp_path):
    # Why: A server-confirmed pre-consume cancellation must not leave the local hard ceiling exhausted.
    # How: Exercise the real SQLite local journal after an admitted attempt and compare terminal vs unknown paths.
    # Invariant: No worker-only claim may release exposure after an ambiguous server consume.
    state = state_for(tmp_path, native(), maximum_calls=1)
    identity = request_identity(native())
    state.admission.admit("terminal", identity)
    state.admission.transition("terminal", "IN_FLIGHT")
    state.admission.cancel_pre_dispatch("terminal")
    assert snapshot(state)["unresolvedAttempts"] == 0
    state.admission.admit("next", identity)
    state.admission.transition("next", "IN_FLIGHT")
    assert snapshot(state)["unresolvedAttempts"] == 1


@pytest.mark.parametrize("terminal", [True, False])
def test_middleware_server_cancel_ack_controls_real_local_journal_release(tmp_path, monkeypatch, terminal):
    # Why: The direct journal test alone does not prove middleware waits for server authority.
    # How: Let real local admission succeed, fail consume, then vary the mocked server's cancel receipt.
    # Invariant: Only terminal server no-usage releases local capacity and encrypted recovery evidence.
    middleware, server, store, events = _harness(tmp_path, monkeypatch)
    model = native()
    state = state_for(tmp_path, model, run_id="run-local-order-1", maximum_calls=1)
    state.preparation_run_id = "prep-local-order-1"
    state.api_client = server
    server.consume_error = WorkerCallbackError("lost consume response", status_code=503,
                                               error_code="DEPENDENCY_UNAVAILABLE")
    if not terminal:
        server.cancel_response = {"state": "ADMITTED", "slotReleased": False}

    with activate_agent_run_state(state), activate_model_step("op-local-order-1"):
        with pytest.raises(WorkerCallbackError):
            middleware.wrap_model_call(req(model, max_tokens=4096), lambda _req: events.append("provider"))
    assert "provider" not in events
    assert snapshot(state)["unresolvedAttempts"] == (0 if terminal else 1)
    assert (store.get_in_flight_admission(ADMISSION_ID) is None) is terminal


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_local_durable_admission_precedes_consume_and_provider_sync_and_async(tmp_path, monkeypatch, asynchronous):
    middleware, _server, store, events = _harness(tmp_path, monkeypatch)
    local_record = tmp_path / "local-admission.txt"

    def local_admit(req, invocation_id):
        # Why: The provider can only run after local ceiling authorization is durable.
        # How: Persist a marker before CAS and assert it at the server/provider boundaries.
        # Invariant: Both sync and async wrappers share the same ordering.
        assert invocation_id == INVOCATION_ID
        local_record.write_text(invocation_id)
        events.append("local_durable_admission")
        return req

    monkeypatch.setattr(middleware, "_admit", local_admit)
    original_consume = _server.consume_invocation_admission

    def consume(payload):
        assert local_record.read_text() == INVOCATION_ID
        assert store.get_in_flight_admission(ADMISSION_ID) is not None
        return original_consume(payload)

    monkeypatch.setattr(_server, "consume_invocation_admission", consume)
    if asynchronous:
        async def provider(_req):
            assert local_record.read_text() == INVOCATION_ID
            events.append("provider")
            return _response()

        await middleware.awrap_model_call(_request(), provider)
    else:
        def provider(_req):
            assert local_record.read_text() == INVOCATION_ID
            events.append("provider")
            return _response()

        middleware.wrap_model_call(_request(), provider)
    assert events[:5] == ["server_request", "encrypted_envelope", "local_durable_admission", "server_consume", "provider"]
