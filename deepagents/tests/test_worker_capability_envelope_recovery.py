"""WP8 Phase B & G-06/G-07: TDD RED tests for Worker Capability Recovery Envelope & Billable Settlement.

Tightened behavioral test suite:
1. Startup key validation: missing key, missing key ID, short key, long key, retired key invalid length, and env var loader fail closed.
2. Capability token is durably encrypted in worker SQLite: inspected across .db, .db-wal, .db-shm, and all auxiliary files (0 plaintext leak).
3. Cryptographic binding via AAD (admissionId, invocationId, runId) fails closed if swapped or tampered.
4. Key rotation supports retired keys for decryption and re-encryption to active key.
5. Real middleware execution order: asserts encrypted envelope durable write occurs BEFORE consume_admission, which occurs BEFORE provider call.
6. Crash recovery with committed usage: calls real settlement (POST /internal/billing/usage/settle) with COMPLETED and 0 provider calls (guaranteed by provider spy).
7. Crash recovery without usage evidence: calls /usage/settle with OUTCOME_UNKNOWN (never fabricates receipt), 0 provider calls, and RETAINS envelope.
8. WorkerApiClient.settle_invocation_usage HTTP contract: confirms URL, method, headers, payload, and response envelope handling.
"""
from __future__ import annotations

import os
import json
import sqlite3
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock
import pytest
import httpx
from langchain_core.messages import AIMessage, HumanMessage

from tools.common.capabilities.platform.api_client import WorkerApiClient, WorkerCallbackError
from conftest import use_model_routes
from middleware.failure_policy import PaidAdmissionError
from middleware.envelope_encryption import (
    WorkerEnvelopeKeyring,
    EnvelopeCryptoStartupError,
    CorruptedEnvelopeError,
    UnknownKeyIdError,
)
from middleware.capability_recovery import (
    CapabilityRecoveryStore,
    recover_in_flight_capabilities,
)
from middleware.usage_metering import AgentRunState, UsageMeteringMiddleware, activate_agent_run_state


TEST_ACTIVE_KEY_ID = "k-2026-v1"
TEST_ACTIVE_KEY_BYTES = b"\x01" * 32
TEST_RETIRED_KEY_ID = "k-2026-v0"
TEST_RETIRED_KEY_BYTES = b"\x02" * 32


@pytest.fixture(autouse=True)
def _setup_routes(monkeypatch):
    use_model_routes(
        monkeypatch,
        (
            {
                "routes": {
                    "primary": {
                        "provider": "anthropic",
                        "protocol": "anthropic",
                        "model": "claude-sonnet-4-6",
                        "options": {"context_window_tokens": 1000000, "max_output_tokens": 65536},
                    },
                },
                "roles": {"default": "primary"},
            }
        ),
    )


def _valid_model_request(provider="anthropic", model_name="claude-sonnet-4-6"):
    model = SimpleNamespace(
        provider=provider,
        protocol="anthropic",
        model_name=model_name,
        options={"max_output_tokens": 4096},
    )
    return SimpleNamespace(
        model=model,
        messages=[HumanMessage(content="Test recovery message")],
        tools=[],
        run_id="run-recovery-test-01",
        logical_operation_id="op-recovery-test-01",
        execution_lease_token="lease-recovery-test-01",
        assessment_id="asm-recovery-test-01",
    )


def _mock_provider_response(text="provider answer"):
    return SimpleNamespace(
        content=text,
        usage_metadata={
            "input_tokens": 120,
            "output_tokens": 240,
            "total_tokens": 360,
            "input_token_details": {"cache_read": 0},
        },
        response_metadata={"id": "resp-recovery-test-1"},
    )


class MockSettlementApiClient:
    """Mock WorkerApiClient supporting real /usage/settle contract alongside admission, consume, and cancel."""

    def __init__(
        self,
        timeline: list[str] | None = None,
        capability_token: str | None = None,
        cancel_raises_409: bool = False,
    ):
        self.timeline = timeline if timeline is not None else []
        self.capability_token = (
            capability_token
            if capability_token is not None
            else "cap-secret-token-abcdef1234567890abcdef1234567890"
        )
        self.cancel_raises_409 = cancel_raises_409
        self.admission_requests = []
        self.consume_requests = []
        self.settlement_requests = []
        self.settlement_responses = []
        self.cancel_requests = []
        self.heartbeat_requests = []
        self.provider_calls = 0

    def request_invocation_admission(self, payload: dict) -> dict:
        self.timeline.append("request_admission")
        self.admission_requests.append(dict(payload))
        return {
            "admissionId": "adm-recovery-test-01",
            "invocationId": "inv-recovery-test-01",
            "admissionRequestId": payload.get("admissionRequestId", "req-1"),
            "fundingPrincipal": "CUSTOMER_WALLET",
            "state": "ADMITTED",
            "rolloutMode": "ADMISSION_REQUIRED",
            "debitMode": "OFF",
            "resolvedProvider": "anthropic",
            "resolvedModel": "claude-sonnet-4-6",
            "maximumExposureMicrocredits": "500000",
            "appliedMaxOutputTokens": 4096,
            "capabilityToken": self.capability_token,
            "admittedAt": "2026-11-28T00:00:00Z",
            "expiresAt": "2026-11-28T00:05:00Z",
        }

    def consume_invocation_admission(self, payload: dict) -> dict:
        self.timeline.append("consume_admission")
        self.consume_requests.append(dict(payload))
        return {"consumed": True, "state": "IN_FLIGHT"}

    def cancel_invocation_admission(self, payload: dict) -> dict:
        self.timeline.append("cancel_admission")
        self.cancel_requests.append(dict(payload))
        if self.cancel_raises_409:
            raise WorkerCallbackError(
                "Admission already in flight",
                status_code=409,
                error_code="admissionAlreadyInFlight",
            )
        return {
            "admissionId": payload.get("admissionId", "adm-recovery-test-01"),
            "invocationId": payload.get("invocationId", "inv-recovery-test-01"),
            "state": "CONFIRMED_NO_USAGE",
            "slotReleased": True,
        }

    def heartbeat_invocation_admission(self, payload: dict) -> dict:
        self.heartbeat_requests.append(dict(payload))
        return {"heartbeat": True, "extendedExpiresAt": "2026-11-28T00:10:00Z"}

    def settle_invocation_usage(self, payload: dict) -> dict:
        self.timeline.append("settle_invocation_usage")
        self.settlement_requests.append(dict(payload))
        state = payload.get("providerCompletionState")
        if state == "COMPLETED":
            # Why: Match the contract's microcredits-per-million-token rate unit in this test double.
            # How: Sum weighted buckets once, then apply the canonical integer divisor.
            # Invariant: A mock receipt must never treat its numerator as a microcredit charge.
            in_tok = payload.get("inputTokens") or 0
            out_tok = payload.get("outputTokens") or 0
            cached_tok = payload.get("cachedInputTokens") or 0
            write_tok = payload.get("cacheWriteTokens") or 0
            calc_mc = (
                in_tok * 10_000_000
                + cached_tok * 2_000_000
                + write_tok * 15_000_000
                + out_tok * 30_000_000
            ) // 1_000_000
            resp = {
                "settled": True,
                "state": "SETTLED",
                "rolloutMode": "ADMISSION_REQUIRED",
                "debitMode": "OFF",
                "calculatedMicrocredits": str(calc_mc),
                "debitedMicrocredits": "0",
                "shadowMicrocredits": None,
                "chargedMicrocredits": "0",
                "slotReleased": True,
                "settledAt": "2026-11-28T00:02:00Z",
            }
            self.settlement_responses.append(dict(resp))
            return resp
        elif state == "OUTCOME_UNKNOWN":
            resp = {
                "settled": False,
                "state": "OUTCOME_UNKNOWN",
                "rolloutMode": "ADMISSION_REQUIRED",
                "debitMode": "OFF",
                "calculatedMicrocredits": "0",
                "debitedMicrocredits": "0",
                "shadowMicrocredits": None,
                "chargedMicrocredits": "0",
                "slotReleased": False,
                "settledAt": None,
            }
            self.settlement_responses.append(dict(resp))
            return resp
        resp = {"settled": False, "state": state, "slotReleased": False}
        self.settlement_responses.append(dict(resp))
        return resp


# ---------------------------------------------------------------------------
# Test 1: Startup Key Validation (Missing and Short Keys)
# ---------------------------------------------------------------------------
def test_startup_key_validation_fails_closed_on_missing_or_short_key(monkeypatch):
    """Test 1: Worker startup validation fails closed on missing, empty, short, or invalid key format."""
    # 1. Missing or empty active key bytes
    with pytest.raises(EnvelopeCryptoStartupError, match="bytes"):
        WorkerEnvelopeKeyring(active_key_id="v1", active_key_bytes=None)

    with pytest.raises(EnvelopeCryptoStartupError, match="32 bytes"):
        WorkerEnvelopeKeyring(active_key_id="v1", active_key_bytes=b"")

    # 2. Missing or empty active key ID
    with pytest.raises(EnvelopeCryptoStartupError, match="non-empty string"):
        WorkerEnvelopeKeyring(active_key_id=None, active_key_bytes=TEST_ACTIVE_KEY_BYTES)

    with pytest.raises(EnvelopeCryptoStartupError, match="non-empty string"):
        WorkerEnvelopeKeyring(active_key_id="", active_key_bytes=TEST_ACTIVE_KEY_BYTES)

    # 3. Short key (less than 32 bytes)
    with pytest.raises(EnvelopeCryptoStartupError, match="32 bytes"):
        WorkerEnvelopeKeyring(active_key_id="v1", active_key_bytes=b"too-short")

    with pytest.raises(EnvelopeCryptoStartupError, match="32 bytes"):
        WorkerEnvelopeKeyring(active_key_id="v1", active_key_bytes=b"\x00" * 16)

    with pytest.raises(EnvelopeCryptoStartupError, match="32 bytes"):
        WorkerEnvelopeKeyring(active_key_id="v1", active_key_bytes=b"\x00" * 31)

    # 4. Long key (greater than 32 bytes)
    with pytest.raises(EnvelopeCryptoStartupError, match="32 bytes"):
        WorkerEnvelopeKeyring(active_key_id="v1", active_key_bytes=b"\x00" * 33)

    # 5. Invalid retired key length
    with pytest.raises(EnvelopeCryptoStartupError, match="Retired key 'v0' must be exactly 32 bytes"):
        WorkerEnvelopeKeyring(
            active_key_id="v1",
            active_key_bytes=TEST_ACTIVE_KEY_BYTES,
            retired_keys={"v0": b"short"},
        )

    # 6. Environment variable loader: missing env var
    monkeypatch.delenv("WORKER_ENVELOPE_ENCRYPTION_KEY", raising=False)
    with pytest.raises(EnvelopeCryptoStartupError, match="WORKER_ENVELOPE_ENCRYPTION_KEY"):
        WorkerEnvelopeKeyring.from_env()

    # 7. Environment variable loader: short key in env var
    monkeypatch.setenv("WORKER_ENVELOPE_ENCRYPTION_KEY", "too-short")
    with pytest.raises(EnvelopeCryptoStartupError, match="32 bytes"):
        WorkerEnvelopeKeyring.from_env()

    # 8. Valid 32-byte key passes self-test
    keyring = WorkerEnvelopeKeyring(active_key_id="v1", active_key_bytes=TEST_ACTIVE_KEY_BYTES)
    assert keyring.active_key_id == "v1"

    # 9. Valid 64-hex env var passes
    monkeypatch.setenv("WORKER_ENVELOPE_ENCRYPTION_KEY", TEST_ACTIVE_KEY_BYTES.hex())
    env_keyring = WorkerEnvelopeKeyring.from_env()
    assert env_keyring.active_key_id == "v1"


# ---------------------------------------------------------------------------
# Test 2: Plaintext Leak Prevention across SQLite, WAL, and Auxiliary Files
# ---------------------------------------------------------------------------
def test_capability_token_is_persisted_in_encrypted_envelope_and_never_leaks_in_sqlite_wal_or_auxiliary_files(tmp_path):
    """Test 2: Verifies capability token is never stored in plaintext across .db, -wal, -shm or temp files."""
    db_path = tmp_path / "worker_recovery.db"
    keyring = WorkerEnvelopeKeyring(active_key_id=TEST_ACTIVE_KEY_ID, active_key_bytes=TEST_ACTIVE_KEY_BYTES)
    store = CapabilityRecoveryStore(db_path, keyring)

    raw_token = "cap-secret-token-abcdef1234567890abcdef1234567890"
    admission_data = {
        "admissionId": "adm-leak-check-01",
        "invocationId": "inv-leak-check-01",
        "runId": "run-leak-check-01",
        "attemptOrdinal": 1,
        "capabilityToken": raw_token,
        "maximumExposureMicrocredits": "500000",
        "expiresAt": "2026-11-28T00:05:00Z",
    }

    store.record_in_flight_admission(admission_data)

    # Inspect all files in tmp_path (including .db, .db-wal, .db-shm, journal, temp files)
    matched_files = list(tmp_path.glob("*"))
    assert len(matched_files) >= 1, "At least the database file must exist"

    raw_token_bytes = raw_token.encode("utf-8")
    for file_path in matched_files:
        if file_path.is_file():
            content = file_path.read_bytes()
            assert raw_token_bytes not in content, (
                f"CRITICAL SECURITY INVARIANT VIOLATION: Raw capability token found in plaintext in file {file_path.name}!"
            )

    # Inspect database rows via direct SQLite query to guarantee columns contain only ciphertext
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute("SELECT admission_id, invocation_id, run_id, encrypted_envelope FROM capability_recovery").fetchall()
        assert len(rows) == 1
        adm_id, inv_id, run_id, enc_env = rows[0]
        assert raw_token not in adm_id
        assert raw_token not in inv_id
        assert raw_token not in run_id
        assert raw_token not in enc_env

    # Decryption works correctly
    recovered = store.get_in_flight_admission("adm-leak-check-01")
    assert recovered is not None
    assert recovered["capabilityToken"] == raw_token


# ---------------------------------------------------------------------------
# Test 3: AAD Cryptographic Binding
# ---------------------------------------------------------------------------
def test_aad_cryptographic_binding_prevents_row_swapping(tmp_path):
    """Test 3: AAD binds admissionId, invocationId, and runId; row tampering fails closed."""
    db_path = tmp_path / "worker_recovery.db"
    keyring = WorkerEnvelopeKeyring(active_key_id=TEST_ACTIVE_KEY_ID, active_key_bytes=TEST_ACTIVE_KEY_BYTES)
    store = CapabilityRecoveryStore(db_path, keyring)

    store.record_in_flight_admission({
        "admissionId": "adm-legit",
        "invocationId": "inv-legit",
        "runId": "run-legit",
        "attemptOrdinal": 1,
        "capabilityToken": "cap-token-legit-00000000000000000000000",
        "maximumExposureMicrocredits": "500000",
        "expiresAt": "2026-11-28T00:05:00Z",
    })

    # Tamper with row in SQLite: swap admission_id
    with sqlite3.connect(db_path) as conn:
        conn.execute("UPDATE capability_recovery SET admission_id = 'adm-stolen' WHERE admission_id = 'adm-legit'")
        conn.commit()

    with pytest.raises(CorruptedEnvelopeError, match="AAD mismatch|tag verification failed"):
        store.get_in_flight_admission("adm-stolen")


# ---------------------------------------------------------------------------
# Test 4: Key Rotation & Re-encryption
# ---------------------------------------------------------------------------
def test_key_rotation_supports_retired_keys_for_decryption_and_re_encryption(tmp_path):
    """Test 4: Decrypts historical envelopes with retired key and upgrades to active key."""
    db_path = tmp_path / "worker_recovery.db"

    old_keyring = WorkerEnvelopeKeyring(active_key_id=TEST_RETIRED_KEY_ID, active_key_bytes=TEST_RETIRED_KEY_BYTES)
    old_store = CapabilityRecoveryStore(db_path, old_keyring)
    raw_token = "cap-token-rotate-test-111111111111111111111"
    old_store.record_in_flight_admission({
        "admissionId": "adm-rotate-1",
        "invocationId": "inv-rotate-1",
        "runId": "run-rotate-1",
        "attemptOrdinal": 1,
        "capabilityToken": raw_token,
        "maximumExposureMicrocredits": "500000",
        "expiresAt": "2026-11-28T00:05:00Z",
    })

    new_keyring = WorkerEnvelopeKeyring(
        active_key_id=TEST_ACTIVE_KEY_ID,
        active_key_bytes=TEST_ACTIVE_KEY_BYTES,
        retired_keys={TEST_RETIRED_KEY_ID: TEST_RETIRED_KEY_BYTES},
    )
    new_store = CapabilityRecoveryStore(db_path, new_keyring)

    recovered = new_store.get_in_flight_admission("adm-rotate-1")
    assert recovered["capabilityToken"] == raw_token

    new_store.re_encrypt_envelope("adm-rotate-1")

    decommissioned_keyring = WorkerEnvelopeKeyring(
        active_key_id=TEST_ACTIVE_KEY_ID,
        active_key_bytes=TEST_ACTIVE_KEY_BYTES,
        retired_keys={},
    )
    decommissioned_store = CapabilityRecoveryStore(db_path, decommissioned_keyring)
    upgraded = decommissioned_store.get_in_flight_admission("adm-rotate-1")
    assert upgraded["capabilityToken"] == raw_token


# ---------------------------------------------------------------------------
# Test 5: Middleware Execution Order (Encrypted Write -> Consume -> Provider)
# ---------------------------------------------------------------------------
def test_middleware_execution_order_encrypted_write_then_consume_then_provider(tmp_path, monkeypatch):
    """RED Test 5: UsageMeteringMiddleware MUST persist encrypted recovery envelope BEFORE consume, and consume BEFORE provider call."""
    db_path = tmp_path / "worker_recovery.db"
    keyring = WorkerEnvelopeKeyring(active_key_id=TEST_ACTIVE_KEY_ID, active_key_bytes=TEST_ACTIVE_KEY_BYTES)
    store = CapabilityRecoveryStore(db_path, keyring)

    execution_timeline: list[str] = []

    # Spy on store methods to observe exact lifecycle ordering
    orig_record_admission = store.record_in_flight_admission
    def spy_record_in_flight_admission(admission):
        execution_timeline.append("record_encrypted_envelope")
        return orig_record_admission(admission)
    monkeypatch.setattr(store, "record_in_flight_admission", spy_record_in_flight_admission)

    mock_client = MockSettlementApiClient(timeline=execution_timeline)
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    def spy_provider_handler(req):
        execution_timeline.append("provider_call")
        forged = _mock_provider_response("provider executed")
        forged.response_metadata["_lcsp_payment_required_after_settlement"] = True
        return forged

    middleware = UsageMeteringMiddleware()
    # Inject recovery store into middleware
    middleware._recovery_store = store

    req = _valid_model_request()
    resp = middleware.wrap_model_call(req, spy_provider_handler)
    assert resp.content == "provider executed"
    # Why: Provider metadata has no authority to pause a customer Assessment for payment.
    # How: A valid non-depleted settlement must overwrite any forged reserved marker with false.
    # Invariant: Only the server's terminal ON debit decision can set the durable marker true.
    assert resp.response_metadata["_lcsp_payment_required_after_settlement"] is False

    # Assert invariant ordering
    assert "request_admission" in execution_timeline
    assert "record_encrypted_envelope" in execution_timeline, (
        "CRITICAL: CapabilityRecoveryStore.record_in_flight_admission was NOT called by UsageMeteringMiddleware!"
    )
    assert "consume_admission" in execution_timeline
    assert "provider_call" in execution_timeline

    # Exact strict sequence: record encrypted envelope BEFORE consume
    rec_idx = execution_timeline.index("record_encrypted_envelope")
    consume_idx = execution_timeline.index("consume_admission")
    prov_idx = execution_timeline.index("provider_call")

    assert rec_idx < consume_idx, "Encrypted envelope must be recorded BEFORE calling consume_invocation_admission!"
    assert consume_idx < prov_idx, "Consume admission must occur BEFORE calling downstream provider!"

    # Invariants for post-call settlement & cleanup
    assert "settle_invocation_usage" in execution_timeline, (
        "CRITICAL: Worker must settle billable invocation usage via settle_invocation_usage after provider completion!"
    )
    settle_idx = execution_timeline.index("settle_invocation_usage")
    assert prov_idx < settle_idx, "Settlement must occur AFTER provider completion!"
    assert store.get_in_flight_admission("adm-recovery-test-01") is None, (
        "CRITICAL: Envelope must be removed from accessible recovery store after terminal settlement!"
    )


def test_terminal_settlement_depletion_signals_pause_after_receipt_without_redispatch(tmp_path, monkeypatch):
    """The final paid call must pause Root even when no later admission can return 402."""

    store = CapabilityRecoveryStore(
        tmp_path / "worker_recovery.db",
        WorkerEnvelopeKeyring(active_key_id=TEST_ACTIVE_KEY_ID, active_key_bytes=TEST_ACTIVE_KEY_BYTES),
    )
    timeline: list[str] = []

    class DepletingClient(MockSettlementApiClient):
        def request_invocation_admission(self, payload):
            return {
                **super().request_invocation_admission(payload),
                "debitMode": "ON",
                "rolloutMode": "DEBIT_ENABLED",
            }

        def settle_invocation_usage(self, payload):
            result = super().settle_invocation_usage(payload)
            return {**result, "debitMode": "ON", "rolloutMode": "DEBIT_ENABLED", "paymentRequired": True}

    client = DepletingClient(timeline=timeline)
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: client,
    )
    provider_calls = []
    middleware = UsageMeteringMiddleware(recovery_store=store)

    # Why: Throwing inside model middleware would replay the paid call when Root resumes.
    # How: Return the paid response and carry the server-owned payment decision to after_model.
    # Invariant: Terminal receipt and envelope cleanup precede the native pause; no redispatch occurs here.
    run_state = AgentRunState(run_id="run-recovery-test-01", agent_role="assessment-root", assessment_id="asm-recovery-test-01")
    provider_response = AIMessage(
        content="provider answer",
        usage_metadata={"input_tokens": 120, "output_tokens": 240, "total_tokens": 360},
        response_metadata={"_lcsp_payment_required_after_settlement": False},
    )
    with activate_agent_run_state(run_state):
        response = middleware.wrap_model_call(
            _valid_model_request(),
            lambda _: (provider_calls.append("provider"), provider_response)[1],
        )

    assert len(provider_calls) == 1
    assert len(client.settlement_requests) == 1
    assert timeline.index("settle_invocation_usage") > timeline.index("consume_admission")
    assert store.get_in_flight_admission("adm-recovery-test-01") is None
    assert response.content == "provider answer"
    assert run_state.payment_required_after_settlement is True
    assert response.response_metadata["_lcsp_payment_required_after_settlement"] is True


def test_terminal_depletion_still_signals_pause_when_envelope_cleanup_fails(tmp_path, monkeypatch):
    """A failed local cleanup must not erase the server's completed payment decision."""
    store = CapabilityRecoveryStore(
        tmp_path / "worker_recovery.db",
        WorkerEnvelopeKeyring(active_key_id=TEST_ACTIVE_KEY_ID, active_key_bytes=TEST_ACTIVE_KEY_BYTES),
    )

    class DepletingClient(MockSettlementApiClient):
        def request_invocation_admission(self, payload):
            return {
                **super().request_invocation_admission(payload),
                "debitMode": "ON",
                "rolloutMode": "DEBIT_ENABLED",
            }

        def settle_invocation_usage(self, payload):
            result = super().settle_invocation_usage(payload)
            return {**result, "debitMode": "ON", "rolloutMode": "DEBIT_ENABLED", "paymentRequired": True}

    client = DepletingClient()
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: client,
    )
    middleware = UsageMeteringMiddleware(recovery_store=store)
    provider_calls = []
    run_state = AgentRunState(run_id="run-recovery-test-01", agent_role="assessment-root", assessment_id="asm-recovery-test-01")
    provider_response = AIMessage(
        content="provider answer",
        usage_metadata={"input_tokens": 120, "output_tokens": 240, "total_tokens": 360},
        response_metadata={},
    )

    # Why: SQLite cleanup can fail after the server has already committed an ON debit.
    # How: Leave the encrypted envelope in place while making deletion raise, then inspect the trusted marker.
    # Invariant: The paid provider call is dispatched once and Root still receives a payment pause decision.
    def fail_cleanup(_admission_id):
        raise OSError("simulated SQLite cleanup failure")

    monkeypatch.setattr(store, "remove_admission_recovery", fail_cleanup)
    with activate_agent_run_state(run_state):
        response = middleware.wrap_model_call(
            _valid_model_request(),
            lambda _: (provider_calls.append("provider"), provider_response)[1],
        )

    assert len(provider_calls) == 1
    assert len(client.settlement_requests) == 1
    assert store.get_in_flight_admission("adm-recovery-test-01") is not None
    assert response.content == "provider answer"
    assert run_state.payment_required_after_settlement is True
    assert response.response_metadata["_lcsp_payment_required_after_settlement"] is True


@pytest.mark.asyncio
async def test_async_middleware_execution_order_encrypted_write_then_consume_then_provider(tmp_path, monkeypatch):
    """RED Test 5b: UsageMeteringMiddleware.awrap_model_call MUST also enforce durable write -> consume -> provider -> settle."""
    db_path = tmp_path / "worker_recovery.db"
    keyring = WorkerEnvelopeKeyring(active_key_id=TEST_ACTIVE_KEY_ID, active_key_bytes=TEST_ACTIVE_KEY_BYTES)
    store = CapabilityRecoveryStore(db_path, keyring)

    execution_timeline: list[str] = []

    orig_record_admission = store.record_in_flight_admission
    def spy_record_in_flight_admission(admission):
        execution_timeline.append("record_encrypted_envelope")
        return orig_record_admission(admission)
    monkeypatch.setattr(store, "record_in_flight_admission", spy_record_in_flight_admission)

    mock_client = MockSettlementApiClient(timeline=execution_timeline)
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    async def spy_async_provider_handler(req):
        execution_timeline.append("provider_call")
        return _mock_provider_response("async provider executed")

    middleware = UsageMeteringMiddleware()
    middleware._recovery_store = store

    req = _valid_model_request()
    resp = await middleware.awrap_model_call(req, spy_async_provider_handler)
    assert resp.content == "async provider executed"

    assert "record_encrypted_envelope" in execution_timeline, (
        "CRITICAL: awrap_model_call did not record encrypted envelope before consume!"
    )
    rec_idx = execution_timeline.index("record_encrypted_envelope")
    consume_idx = execution_timeline.index("consume_admission")
    prov_idx = execution_timeline.index("provider_call")

    assert rec_idx < consume_idx
    assert consume_idx < prov_idx
    assert "settle_invocation_usage" in execution_timeline
    assert store.get_in_flight_admission("adm-recovery-test-01") is None


# ---------------------------------------------------------------------------
# Test 6: Crash Recovery with Committed Usage (Zero Redispatch via Provider Spy)
# ---------------------------------------------------------------------------
def test_crash_recovery_with_committed_usage_calls_real_settle_with_zero_redispatch(tmp_path, monkeypatch):
    """Test 6: Crash recovery with committed usage evidence calls /usage/settle with COMPLETED and 0 provider calls."""
    db_path = tmp_path / "worker_recovery.db"
    keyring = WorkerEnvelopeKeyring(active_key_id=TEST_ACTIVE_KEY_ID, active_key_bytes=TEST_ACTIVE_KEY_BYTES)
    store = CapabilityRecoveryStore(db_path, keyring)

    raw_token = "cap-token-settle-000000000000000000000000000"
    store.record_in_flight_admission({
        "admissionId": "adm-settle-01",
        "invocationId": "inv-settle-01",
        "runId": "run-settle-01",
        "attemptOrdinal": 1,
        "capabilityToken": raw_token,
        "maximumExposureMicrocredits": "500000",
        "expiresAt": "2026-11-28T00:05:00Z",
    })
    store.record_usage_evidence("inv-settle-01", {
        "invocationId": "inv-settle-01",
        "inputTokens": 120,
        "outputTokens": 240,
        "totalTokens": 360,
    })

    # Provider spy connected directly into the model dispatch layer
    from langchain_core.language_models.chat_models import BaseChatModel
    provider_spy = MagicMock(return_value=_mock_provider_response("spy response"))
    monkeypatch.setattr(BaseChatModel, "_generate", provider_spy)
    monkeypatch.setattr(UsageMeteringMiddleware, "wrap_model_call", provider_spy)
    monkeypatch.setattr(UsageMeteringMiddleware, "awrap_model_call", provider_spy)

    # Prove spy is wired and actively catches model execution
    test_mw = UsageMeteringMiddleware()
    test_mw.wrap_model_call(_valid_model_request(), lambda r: None)
    assert provider_spy.call_count == 1
    # Reset count to 0 to verify recovery phase
    provider_spy.reset_mock()

    mock_client = MockSettlementApiClient()
    # Execute recovery sweeper
    results = recover_in_flight_capabilities(db_path, keyring, mock_client)

    # Invariant: exactly 1 settlement call
    assert len(mock_client.settlement_requests) == 1
    req = mock_client.settlement_requests[0]
    assert req["admissionId"] == "adm-settle-01"
    assert req["invocationId"] == "inv-settle-01"
    assert req["capabilityToken"] == raw_token
    assert req["providerCompletionState"] == "COMPLETED"
    assert req["inputTokens"] == 120
    assert req["outputTokens"] == 240

    # Invariant: ZERO provider redispatch guaranteed by active spy interception
    assert provider_spy.call_count == 0
    assert mock_client.provider_calls == 0

    # Invariant: envelope removed because settled: true, slotReleased: true
    assert store.get_in_flight_admission("adm-settle-01") is None


# ---------------------------------------------------------------------------
# Test 7: Crash Recovery without Usage Evidence (OUTCOME_UNKNOWN & Envelope Retained)
# ---------------------------------------------------------------------------
def test_crash_recovery_without_usage_evidence_reports_outcome_unknown_and_retains_envelope(tmp_path, monkeypatch):
    """Test 7: Crash before usage evidence reports OUTCOME_UNKNOWN, 0 provider calls, and retains envelope."""
    db_path = tmp_path / "worker_recovery.db"
    keyring = WorkerEnvelopeKeyring(active_key_id=TEST_ACTIVE_KEY_ID, active_key_bytes=TEST_ACTIVE_KEY_BYTES)
    store = CapabilityRecoveryStore(db_path, keyring)

    raw_token = "cap-token-outcome-unknown-00000000000000000"
    store.record_in_flight_admission({
        "admissionId": "adm-unknown-01",
        "invocationId": "inv-unknown-01",
        "runId": "run-unknown-01",
        "attemptOrdinal": 1,
        "capabilityToken": raw_token,
        "maximumExposureMicrocredits": "500000",
        "expiresAt": "2026-11-28T00:05:00Z",
    })

    from langchain_core.language_models.chat_models import BaseChatModel
    provider_spy = MagicMock(return_value=_mock_provider_response("spy response"))
    monkeypatch.setattr(BaseChatModel, "_generate", provider_spy)
    monkeypatch.setattr(UsageMeteringMiddleware, "wrap_model_call", provider_spy)
    monkeypatch.setattr(UsageMeteringMiddleware, "awrap_model_call", provider_spy)

    # Prove spy is wired
    test_mw = UsageMeteringMiddleware()
    test_mw.wrap_model_call(_valid_model_request(), lambda r: None)
    assert provider_spy.call_count == 1
    provider_spy.reset_mock()

    mock_client = MockSettlementApiClient(cancel_raises_409=True)

    recover_in_flight_capabilities(db_path, keyring, mock_client)

    assert len(mock_client.settlement_requests) == 1
    req = mock_client.settlement_requests[0]
    assert req["admissionId"] == "adm-unknown-01"
    assert req["capabilityToken"] == raw_token
    assert req["providerCompletionState"] == "OUTCOME_UNKNOWN"
    assert req.get("inputTokens") is None
    assert req.get("outputTokens") is None

    # Invariant: ZERO provider redispatch
    assert provider_spy.call_count == 0
    assert mock_client.provider_calls == 0

    # Invariant: envelope MUST BE RETAINED when response has settled: false, slotReleased: false
    retained = store.get_in_flight_admission("adm-unknown-01")
    assert retained is not None, "Envelope MUST NOT be deleted when response is OUTCOME_UNKNOWN (settled: false)!"
    assert retained["capabilityToken"] == raw_token


# ---------------------------------------------------------------------------
# Test 8: WorkerApiClient.settle_invocation_usage HTTP Contract Verification
# ---------------------------------------------------------------------------
def test_worker_api_client_settle_invocation_usage_http_contract(monkeypatch):
    """Test 8: Verifies WorkerApiClient.settle_invocation_usage HTTP method, URL, headers, and payload."""
    client = WorkerApiClient(base_url="http://127.0.0.1:3000", api_key="worker-test-api-key")

    captured_http_requests = []

    def mock_httpx_post(url, json=None, headers=None, timeout=None):
        captured_http_requests.append({
            "url": str(url),
            "headers": dict(headers or {}),
            "json": dict(json or {}),
            "timeout": timeout,
        })
        payload = json or {}
        if payload.get("providerCompletionState") == "INVALID_STATE":
            return httpx.Response(
                422,
                json={
                    "ok": False,
                    "problem": {
                        "status": 422,
                        "code": "BILLING_ADMISSION_INVALID",
                        "titleKey": "error.billing.invalid",
                    },
                },
                request=httpx.Request("POST", url),
            )
        return httpx.Response(
            200,
            json={
                "ok": True,
                "data": {
                    "settled": True,
                    "state": "SETTLED",
                    "rolloutMode": "ADMISSION_REQUIRED",
                    "debitMode": "OFF",
                    "calculatedMicrocredits": "350000",
                    "slotReleased": True,
                },
            },
            request=httpx.Request("POST", url),
        )

    # Intercept at real httpx transport boundary
    monkeypatch.setattr(httpx, "post", mock_httpx_post)

    valid_payload = {
        "admissionId": "adm-http-test-01",
        "invocationId": "inv-http-test-01",
        "capabilityToken": "cap-token-secret-abcdef1234567890abcdef1234567890",  # 48 chars (>= 32 min)
        "attemptOrdinal": 1,
        "providerCompletionState": "COMPLETED",
        "inputTokens": 100,
        "outputTokens": 200,
        "totalTokens": 300,
    }

    result = client.settle_invocation_usage(valid_payload)

    # 1. Verify exact HTTP request boundary (URL, headers, payload)
    assert len(captured_http_requests) == 1
    req = captured_http_requests[0]
    assert req["url"] == "http://127.0.0.1:3000/internal/billing/usage/settle"
    assert req["headers"]["X-Worker-Api-Key"] == "worker-test-api-key"
    assert "X-Correlation-Id" in req["headers"]
    assert req["json"] == valid_payload

    # 2. Verify response unwrap
    assert result["settled"] is True
    assert result["slotReleased"] is True
    assert result["state"] == "SETTLED"

    # 3. Verify real HTTP error parsing (422) raises WorkerCallbackError with code and status
    invalid_payload = dict(valid_payload)
    invalid_payload["providerCompletionState"] = "INVALID_STATE"
    with pytest.raises(WorkerCallbackError) as exc_info:
        client.settle_invocation_usage(invalid_payload)
    assert exc_info.value.status_code == 422
    assert exc_info.value.error_code == "BILLING_ADMISSION_INVALID"


# ---------------------------------------------------------------------------
# Test 9: Fail Closed on Missing Key (Zero Consume & Zero Provider Call)
# ---------------------------------------------------------------------------
def test_sync_wrap_model_call_fails_closed_when_key_missing_zero_consume_zero_provider(monkeypatch):
    """RED Test 9: Middleware wrap_model_call fails closed before consume if encryption key is missing."""
    monkeypatch.delenv("WORKER_ENVELOPE_ENCRYPTION_KEY", raising=False)

    execution_timeline: list[str] = []
    mock_client = MockSettlementApiClient(timeline=execution_timeline)
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    provider_spy = MagicMock(return_value=_mock_provider_response("provider executed"))

    middleware = UsageMeteringMiddleware()  # no store injected, no env key set
    req = _valid_model_request()

    with pytest.raises(PaidAdmissionError, match="CAPABILITY_RECOVERY_STORE_UNAVAILABLE"):
        middleware.wrap_model_call(req, provider_spy)

    # Invariants: 0 consume calls and 0 provider calls!
    assert "request_admission" in execution_timeline
    assert len(mock_client.consume_requests) == 0, "CRITICAL: Must NOT call consume when recovery store is unavailable!"
    assert provider_spy.call_count == 0, "CRITICAL: Must NOT call provider when recovery store is unavailable!"


# ---------------------------------------------------------------------------
# Test 10: Fail Closed on Corrupted Key (Async awrap_model_call)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_async_awrap_model_call_fails_closed_when_key_corrupt_zero_consume_zero_provider(monkeypatch):
    """RED Test 10: Middleware awrap_model_call fails closed before consume if encryption key is corrupted/too short."""
    monkeypatch.setenv("WORKER_ENVELOPE_ENCRYPTION_KEY", "corrupted-short-key")

    execution_timeline: list[str] = []
    mock_client = MockSettlementApiClient(timeline=execution_timeline)
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    provider_spy = MagicMock(return_value=_mock_provider_response("async provider executed"))

    middleware = UsageMeteringMiddleware()
    req = _valid_model_request()

    with pytest.raises(PaidAdmissionError, match="CAPABILITY_RECOVERY_STORE_UNAVAILABLE"):
        await middleware.awrap_model_call(req, provider_spy)

    assert "request_admission" in execution_timeline
    assert len(mock_client.consume_requests) == 0, "CRITICAL: Must NOT call consume when recovery key is corrupted!"
    assert provider_spy.call_count == 0, "CRITICAL: Must NOT call provider when recovery key is corrupted!"


# ---------------------------------------------------------------------------
# Test 11: Settlement Without Provider Usage Metadata (OUTCOME_UNKNOWN & Retain Envelope)
# ---------------------------------------------------------------------------
def test_settlement_without_provider_usage_reports_outcome_unknown_and_retains_envelope(tmp_path, monkeypatch):
    """RED Test 11: If provider does not report valid usage metadata, worker must NOT send COMPLETED with 0 tokens.

    Must send OUTCOME_UNKNOWN and retain envelope in recovery store to prevent leaking unbilled usage.
    """
    db_path = tmp_path / "worker_recovery.db"
    keyring = WorkerEnvelopeKeyring(active_key_id=TEST_ACTIVE_KEY_ID, active_key_bytes=TEST_ACTIVE_KEY_BYTES)
    store = CapabilityRecoveryStore(db_path, keyring)

    mock_client = MockSettlementApiClient()
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    # Provider returns response with NO token usage metadata!
    def mock_empty_usage_provider(req):
        return SimpleNamespace(
            content="answer with no token usage reported by provider",
            usage_metadata={},  # Empty usage metadata!
            response_metadata={},
        )

    middleware = UsageMeteringMiddleware(recovery_store=store)
    req = _valid_model_request()

    middleware.wrap_model_call(req, mock_empty_usage_provider)

    # Verify settlement request was sent with OUTCOME_UNKNOWN (NOT COMPLETED with 0 tokens)
    assert len(mock_client.settlement_requests) == 1
    req_sent = mock_client.settlement_requests[0]
    assert req_sent["providerCompletionState"] == "OUTCOME_UNKNOWN", (
        f"Expected OUTCOME_UNKNOWN when provider reported no usage, got {req_sent['providerCompletionState']}"
    )
    assert req_sent.get("inputTokens") is None
    assert req_sent.get("outputTokens") is None
    # Why: An unresolved provider result cannot be used as verdict causation evidence.
    # How: Keep tool-call IDs out of OUTCOME_UNKNOWN rather than accepting unverified identity.
    # Invariant: Only COMPLETED settlement pins the physical response's bounded tool-call list.
    assert "toolCallIds" not in req_sent

    # Invariant: Envelope MUST BE RETAINED in SQLite store for integrity audit!
    retained = store.get_in_flight_admission("adm-recovery-test-01")
    assert retained is not None, "Envelope MUST NOT be removed when usage evidence is absent/unknown!"


# ---------------------------------------------------------------------------
# Test 12: Worker Startup Recovery Hook Execution
# ---------------------------------------------------------------------------
def test_worker_startup_executes_in_flight_capability_recovery(tmp_path):
    """RED Test 12: Worker startup automatically sweeps and recovers in-flight capability envelopes."""
    try:
        from middleware.capability_recovery import sweep_and_recover_capabilities_on_startup
    except ImportError:
        pytest.fail("sweep_and_recover_capabilities_on_startup not implemented yet")

    db_path = tmp_path / "worker_recovery.db"
    keyring = WorkerEnvelopeKeyring(active_key_id=TEST_ACTIVE_KEY_ID, active_key_bytes=TEST_ACTIVE_KEY_BYTES)
    store = CapabilityRecoveryStore(db_path, keyring)

    raw_token = "cap-token-startup-test-000000000000000000000"
    store.record_in_flight_admission({
        "admissionId": "adm-startup-01",
        "invocationId": "inv-startup-01",
        "runId": "run-startup-01",
        "attemptOrdinal": 1,
        "capabilityToken": raw_token,
        "maximumExposureMicrocredits": "500000",
        "expiresAt": "2026-11-28T00:05:00Z",
    })
    store.record_usage_evidence("inv-startup-01", {
        "invocationId": "inv-startup-01",
        "inputTokens": 150,
        "outputTokens": 300,
        "totalTokens": 450,
    })

    mock_client = MockSettlementApiClient()

    # Simulate worker boot: sweep_and_recover_capabilities_on_startup runs before any task is accepted
    results = sweep_and_recover_capabilities_on_startup(
        api_client=mock_client,
        db_path=db_path,
        keyring=keyring,
    )

    assert len(mock_client.settlement_requests) == 1
    req = mock_client.settlement_requests[0]
    assert req["admissionId"] == "adm-startup-01"
    assert req["capabilityToken"] == raw_token
    assert req["providerCompletionState"] == "COMPLETED"
    assert req["inputTokens"] == 150
    assert req["outputTokens"] == 300

    # Invariant: envelope removed after terminal settlement on startup
    assert store.get_in_flight_admission("adm-startup-01") is None


# ---------------------------------------------------------------------------
# Test 13: RabbitMQ Consumer Startup Fails Closed When Recovery Fails
# ---------------------------------------------------------------------------
def test_rabbitmq_consumer_main_startup_fails_closed_when_recovery_fails(tmp_path, monkeypatch):
    """RED Test 13: rabbitmq_consumer.run_consumer() must fail closed before connecting to RabbitMQ if recovery fails."""
    from tools.common.capabilities.agent_runtime.rabbitmq_consumer import run_consumer

    # Track if consumer attempted to wait for API or connect to RabbitMQ
    reached_subsequent_startup_phases = []
    monkeypatch.setattr(
        "tools.common.capabilities.agent_runtime.rabbitmq_consumer._wait_for_api_ready",
        lambda *args, **kwargs: reached_subsequent_startup_phases.append("wait_for_api"),
    )
    monkeypatch.setattr(
        "pika.BlockingConnection",
        lambda *args, **kwargs: reached_subsequent_startup_phases.append("pika_connect"),
    )
    monkeypatch.setenv("RABBITMQ_URL", "amqp://guest:guest@127.0.0.1:5672/")

    # Setup dummy worker client
    mock_client = MockSettlementApiClient()
    monkeypatch.setattr(
        "tools.common.capabilities.agent_runtime.rabbitmq_consumer._worker_client_or_none",
        lambda: mock_client,
    )

    # Subcase A: Key is missing - run_consumer MUST fail and NOT connect or proceed
    monkeypatch.delenv("WORKER_ENVELOPE_ENCRYPTION_KEY", raising=False)
    with pytest.raises(Exception):
        run_consumer()
    assert len(reached_subsequent_startup_phases) == 0, "CRITICAL: Must not proceed to subsequent startup phases when key missing!"

    # Subcase B: Key is corrupt - run_consumer MUST fail and NOT connect or proceed
    monkeypatch.setenv("WORKER_ENVELOPE_ENCRYPTION_KEY", "corrupted-too-short-key")
    with pytest.raises(Exception):
        run_consumer()
    assert len(reached_subsequent_startup_phases) == 0, "CRITICAL: Must not proceed to subsequent startup phases when key corrupt!"


# ---------------------------------------------------------------------------
# Test 14: Fail Closed When Capability Token Missing (Zero Consume, Zero Provider)
# ---------------------------------------------------------------------------
def test_sync_wrap_model_call_fails_closed_when_capability_token_missing_in_admission_zero_consume_zero_provider(tmp_path, monkeypatch):
    """RED Test 14: wrap_model_call fails closed if admission response has missing/invalid capabilityToken."""
    db_path = tmp_path / "worker_recovery.db"
    keyring = WorkerEnvelopeKeyring(active_key_id=TEST_ACTIVE_KEY_ID, active_key_bytes=TEST_ACTIVE_KEY_BYTES)
    store = CapabilityRecoveryStore(db_path, keyring)

    execution_timeline: list[str] = []
    # Client returns admission with missing capabilityToken
    mock_client = MockSettlementApiClient(
        timeline=execution_timeline,
        capability_token="",  # Missing / empty token!
    )
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    provider_spy = MagicMock(return_value=_mock_provider_response("should not be called"))
    middleware = UsageMeteringMiddleware(recovery_store=store)
    req = _valid_model_request()

    with pytest.raises(PaidAdmissionError, match="MISSING_SERVER_CAPABILITY_TOKEN"):
        middleware.wrap_model_call(req, provider_spy)

    assert "request_admission" in execution_timeline
    assert len(mock_client.consume_requests) == 0, "CRITICAL: Must NOT call consume when capabilityToken is missing!"
    assert provider_spy.call_count == 0, "CRITICAL: Must NOT call provider when capabilityToken is missing!"


@pytest.mark.asyncio
async def test_async_awrap_model_call_fails_closed_when_capability_token_missing_in_admission_zero_consume_zero_provider(tmp_path, monkeypatch):
    """RED Test 15: awrap_model_call fails closed if admission response has missing/invalid capabilityToken."""
    db_path = tmp_path / "worker_recovery.db"
    keyring = WorkerEnvelopeKeyring(active_key_id=TEST_ACTIVE_KEY_ID, active_key_bytes=TEST_ACTIVE_KEY_BYTES)
    store = CapabilityRecoveryStore(db_path, keyring)

    execution_timeline: list[str] = []
    mock_client = MockSettlementApiClient(
        timeline=execution_timeline,
        capability_token="",  # Missing / empty token!
    )
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    provider_spy = MagicMock(return_value=_mock_provider_response("should not be called"))
    middleware = UsageMeteringMiddleware(recovery_store=store)
    req = _valid_model_request()

    with pytest.raises(PaidAdmissionError, match="MISSING_SERVER_CAPABILITY_TOKEN"):
        await middleware.awrap_model_call(req, provider_spy)

    assert "request_admission" in execution_timeline
    assert len(mock_client.consume_requests) == 0, "CRITICAL: Must NOT call consume when capabilityToken is missing!"
    assert provider_spy.call_count == 0, "CRITICAL: Must NOT call provider when capabilityToken is missing!"


# ---------------------------------------------------------------------------
# Test 16: Settlement with Partial Usage Evidence (OUTCOME_UNKNOWN & Retain Envelope)
# ---------------------------------------------------------------------------
def test_settlement_with_partial_usage_bucket_reports_outcome_unknown_and_retains_envelope(tmp_path, monkeypatch):
    """RED Test 16: If provider reports only input_tokens (missing output_tokens), must send OUTCOME_UNKNOWN and retain envelope."""
    db_path = tmp_path / "worker_recovery.db"
    keyring = WorkerEnvelopeKeyring(active_key_id=TEST_ACTIVE_KEY_ID, active_key_bytes=TEST_ACTIVE_KEY_BYTES)
    store = CapabilityRecoveryStore(db_path, keyring)

    mock_client = MockSettlementApiClient()
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    # Provider reports ONLY input_tokens, output_tokens is completely omitted!
    def mock_partial_usage_provider(req):
        return SimpleNamespace(
            content="partial token usage reported by provider",
            usage_metadata={"input_tokens": 500},  # Missing output_tokens!
            response_metadata={},
        )

    middleware = UsageMeteringMiddleware(recovery_store=store)
    req = _valid_model_request()

    middleware.wrap_model_call(req, mock_partial_usage_provider)

    assert len(mock_client.settlement_requests) == 1
    req_sent = mock_client.settlement_requests[0]
    assert req_sent["providerCompletionState"] == "OUTCOME_UNKNOWN", (
        f"Must report OUTCOME_UNKNOWN for partial usage evidence, got {req_sent['providerCompletionState']}"
    )
    # Envelope must be retained
    retained = store.get_in_flight_admission("adm-recovery-test-01")
    assert retained is not None, "Envelope MUST NOT be removed when token evidence is incomplete!"


# ---------------------------------------------------------------------------
# Test 17: Crash Recovery with Partial/Corrupted Stored Usage Reports OUTCOME_UNKNOWN
# ---------------------------------------------------------------------------
def test_crash_recovery_with_partial_stored_usage_reports_outcome_unknown_and_retains_envelope(tmp_path):
    """RED Test 17: In-flight crash recovery with incomplete usage evidence reports OUTCOME_UNKNOWN and retains envelope."""
    from middleware.capability_recovery import recover_in_flight_capabilities

    db_path = tmp_path / "worker_recovery.db"
    keyring = WorkerEnvelopeKeyring(active_key_id=TEST_ACTIVE_KEY_ID, active_key_bytes=TEST_ACTIVE_KEY_BYTES)
    store = CapabilityRecoveryStore(db_path, keyring)

    raw_token = "cap-token-partial-recovery-00000000000000000"
    store.record_in_flight_admission({
        "admissionId": "adm-partial-rec-01",
        "invocationId": "inv-partial-rec-01",
        "runId": "run-partial-rec-01",
        "attemptOrdinal": 1,
        "capabilityToken": raw_token,
        "maximumExposureMicrocredits": "500000",
        "expiresAt": "2026-11-28T00:05:00Z",
    })

    # Store partial usage evidence (missing outputTokens!)
    store.record_usage_evidence("inv-partial-rec-01", {
        "invocationId": "inv-partial-rec-01",
        "inputTokens": 300,
        # outputTokens is MISSING!
    })

    mock_client = MockSettlementApiClient()

    results = recover_in_flight_capabilities(db_path, keyring, mock_client)

    assert len(mock_client.settlement_requests) == 1
    req = mock_client.settlement_requests[0]
    assert req["admissionId"] == "adm-partial-rec-01"
    assert req["providerCompletionState"] == "OUTCOME_UNKNOWN", (
        f"Must report OUTCOME_UNKNOWN when stored evidence is incomplete, got {req['providerCompletionState']}"
    )

    # Invariant: Envelope MUST BE RETAINED because settlement response is settled: false, slotReleased: false
    retained = store.get_in_flight_admission("adm-partial-rec-01")
    assert retained is not None, "Envelope must be retained when outcome is unknown!"


# ---------------------------------------------------------------------------
# Test 18: Recovery of ADMITTED Envelope Without Usage (Cancels Cleanly & Deletes Envelope)
# ---------------------------------------------------------------------------
def test_recovery_of_admitted_envelope_without_usage_cancels_cleanly_and_deletes_envelope(tmp_path):
    """RED Test 18: Crash between envelope write and consume leaves admission ADMITTED.

    Recovery must first call POST /internal/billing/admission/cancel.
    When cancel returns 200 (CONFIRMED_NO_USAGE, slotReleased: true), the recovery envelope
    must be removed from SQLite without attempting /usage/settle, preventing boot crash loops.
    """
    # Business purpose: Verify clean resolution of crashed pre-consume admissions without calling settlement endpoint.
    # Rationale ("Why"): Calling /usage/settle on ADMITTED admissions throws 422 admissionInvalidState.
    # Mechanism ("How"): Sweeper detects absence of usage evidence, attempts cancellation first; on 200, deletes envelope.
    # Invariants & Constraints: 0 provider redispatches; slot released cleanly on server; envelope deleted from SQLite.
    db_path = tmp_path / "worker_recovery.db"
    keyring = WorkerEnvelopeKeyring(active_key_id=TEST_ACTIVE_KEY_ID, active_key_bytes=TEST_ACTIVE_KEY_BYTES)
    store = CapabilityRecoveryStore(db_path, keyring)

    raw_token = "cap-token-admitted-pre-consume-0000000000000000"
    store.record_in_flight_admission({
        "admissionId": "adm-admitted-01",
        "invocationId": "inv-admitted-01",
        "runId": "run-admitted-01",
        "attemptOrdinal": 1,
        "capabilityToken": raw_token,
        "maximumExposureMicrocredits": "500000",
        "expiresAt": "2026-11-28T00:05:00Z",
    })
    # Zero usage evidence recorded (crash happened before consume or provider call)

    mock_client = MockSettlementApiClient(cancel_raises_409=False)

    results = recover_in_flight_capabilities(db_path, keyring, mock_client)

    # 1. Assert cancellation was called with exact contract
    assert len(mock_client.cancel_requests) == 1
    cancel_req = mock_client.cancel_requests[0]
    assert cancel_req["admissionId"] == "adm-admitted-01"
    assert cancel_req["invocationId"] == "inv-admitted-01"
    assert cancel_req["capabilityToken"] == raw_token
    assert cancel_req.get("cancellationReason") is not None

    # 2. Settlement must NOT be called for clean cancellation
    assert len(mock_client.settlement_requests) == 0

    # 3. Envelope must be removed from SQLite store
    assert store.get_in_flight_admission("adm-admitted-01") is None


# ---------------------------------------------------------------------------
# Test 19: Recovery of IN_FLIGHT Envelope Without Usage (409 Conflict -> OUTCOME_UNKNOWN Fallback)
# ---------------------------------------------------------------------------
def test_recovery_of_inflight_envelope_without_usage_falls_back_to_outcome_unknown_and_retains_envelope(tmp_path):
    """RED Test 19: Crash after consume (IN_FLIGHT) without usage evidence.

    When cancel returns 409 Conflict (admissionAlreadyInFlight), recovery must fall back
    to /usage/settle with OUTCOME_UNKNOWN, retaining the envelope in SQLite for reconciliation.
    """
    # Business purpose: Resolve race between consume and recovery when worker crashed during model execution.
    # Rationale ("Why"): Cancellation fails with 409 if consume succeeded; settlement with OUTCOME_UNKNOWN marks audit trail.
    # Mechanism ("How"): Sweeper catches 409 from cancel and calls settle_invocation_usage(OUTCOME_UNKNOWN).
    # Invariants & Constraints: Envelope is RETAINED (settled: false); concurrency slot preserved until admin reconciliation.
    db_path = tmp_path / "worker_recovery.db"
    keyring = WorkerEnvelopeKeyring(active_key_id=TEST_ACTIVE_KEY_ID, active_key_bytes=TEST_ACTIVE_KEY_BYTES)
    store = CapabilityRecoveryStore(db_path, keyring)

    raw_token = "cap-token-inflight-409-fallback-0000000000000000"
    store.record_in_flight_admission({
        "admissionId": "adm-inflight-01",
        "invocationId": "inv-inflight-01",
        "runId": "run-inflight-01",
        "attemptOrdinal": 1,
        "capabilityToken": raw_token,
        "maximumExposureMicrocredits": "500000",
        "expiresAt": "2026-11-28T00:05:00Z",
    })

    mock_client = MockSettlementApiClient(cancel_raises_409=True)

    results = recover_in_flight_capabilities(db_path, keyring, mock_client)

    # 1. Assert cancel was attempted first
    assert len(mock_client.cancel_requests) == 1
    assert mock_client.cancel_requests[0]["admissionId"] == "adm-inflight-01"

    # 2. Assert fallback to settlement with OUTCOME_UNKNOWN
    assert len(mock_client.settlement_requests) == 1
    settle_req = mock_client.settlement_requests[0]
    assert settle_req["admissionId"] == "adm-inflight-01"
    assert settle_req["providerCompletionState"] == "OUTCOME_UNKNOWN"

    # 3. Invariant: Envelope MUST BE RETAINED for reconciliation because settled is false
    retained = store.get_in_flight_admission("adm-inflight-01")
    assert retained is not None, "Envelope must be retained when outcome is unknown!"


# ---------------------------------------------------------------------------
# Test 20: Full Parity Settlement & Recovery for Priced Cache and Reasoning Token Buckets
# ---------------------------------------------------------------------------
def test_settlement_and_recovery_parity_for_priced_cache_and_reasoning_token_buckets(tmp_path, monkeypatch):
    """RED Test 20: Normal settlement and crash recovery must extract, persist, and send all priced token buckets:

    cachedInputTokens, cacheWriteTokens, reasoningTokens alongside inputTokens, outputTokens, totalTokens.
    """
    # Business purpose: Guarantee accurate billing for models with prompt caching and extended reasoning.
    # Rationale ("Why"): Tariffs charge distinct rates for cache read, cache write, and reasoning tokens.
    # Mechanism ("How"): Extracts all buckets from provider response/metadata, stores in SQLite, and forwards to settlement.
    # Invariants & Constraints: 100% parity between live execution settlement and crash recovery settlement.
    db_path = tmp_path / "worker_recovery.db"
    keyring = WorkerEnvelopeKeyring(active_key_id=TEST_ACTIVE_KEY_ID, active_key_bytes=TEST_ACTIVE_KEY_BYTES)
    store = CapabilityRecoveryStore(db_path, keyring)

    mock_client = MockSettlementApiClient()
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    # Provider reports standard tokens + cache read + cache creation + reasoning
    def mock_priced_buckets_provider(req):
        return SimpleNamespace(
            content="priced tokens provider response",
            usage_metadata={
                "input_tokens": 1000,
                "output_tokens": 500,
                "total_tokens": 1500,
                "input_token_details": {
                    "cache_read": 800,
                    "cache_creation": 200,
                },
                "output_token_details": {
                    "reasoning": 150,
                },
            },
            response_metadata={"id": "resp-priced-buckets-1"},
        )

    middleware = UsageMeteringMiddleware(recovery_store=store)
    req = _valid_model_request()

    # 1. LIVE EXECUTION: wrap_model_call settles immediately
    middleware.wrap_model_call(req, mock_priced_buckets_provider)

    assert len(mock_client.settlement_requests) == 1
    live_req = mock_client.settlement_requests[0]
    assert live_req["providerCompletionState"] == "COMPLETED"
    # P1: Non-overlapping input tokens (inclusive input 1000 - cache_read 800 - cache_creation 200 = 0)
    assert live_req["inputTokens"] == 0, (
        f"Expected non-overlapping inputTokens 0 (1000 - 800 - 200), got {live_req['inputTokens']}"
    )
    assert live_req["outputTokens"] == 500
    assert live_req["totalTokens"] == 1500
    assert live_req["cachedInputTokens"] == 800
    assert live_req["cacheWriteTokens"] == 200
    assert live_req["reasoningTokens"] == 150

    # Verify calculated microcredits: 0*10 + 800*2 + 200*15 + 500*30 = 19600 (NO double-counting of cache!)
    stored_evidence = store.get_usage_evidence(live_req["invocationId"])
    assert stored_evidence is not None
    assert stored_evidence["inputTokens"] == 0
    assert stored_evidence["cachedInputTokens"] == 800
    assert stored_evidence["cacheWriteTokens"] == 200
    assert stored_evidence["reasoningTokens"] == 150

    # 2. CRASH RECOVERY PARITY:
    # Clear settlement requests to test recovery in isolation
    mock_client.settlement_requests.clear()

    # Simulate another in-flight admission that crashed right after storing evidence
    raw_token = "cap-token-recovery-priced-parity-0000000000000000"
    store.record_in_flight_admission({
        "admissionId": "adm-recovery-priced-01",
        "invocationId": "inv-recovery-priced-01",
        "runId": "run-recovery-priced-01",
        "attemptOrdinal": 1,
        "capabilityToken": raw_token,
        "maximumExposureMicrocredits": "500000",
        "expiresAt": "2026-11-28T00:05:00Z",
    })
    store.record_usage_evidence("inv-recovery-priced-01", {
        "invocationId": "inv-recovery-priced-01",
        "inputTokens": 0,
        "outputTokens": 500,
        "totalTokens": 1500,
        "cachedInputTokens": 800,
        "cacheWriteTokens": 200,
        "reasoningTokens": 150,
    })

    # Execute crash recovery
    results = recover_in_flight_capabilities(db_path, keyring, mock_client)

    assert len(mock_client.settlement_requests) == 1
    rec_req = mock_client.settlement_requests[0]
    assert rec_req["admissionId"] == "adm-recovery-priced-01"
    assert rec_req["providerCompletionState"] == "COMPLETED"
    assert rec_req["inputTokens"] == 0
    assert rec_req["outputTokens"] == 500
    assert rec_req["totalTokens"] == 1500
    assert rec_req["cachedInputTokens"] == 800
    assert rec_req["cacheWriteTokens"] == 200
    assert rec_req["reasoningTokens"] == 150

    # Invariant: Server calculatedMicrocredits must be exactly 19600
    assert results[0]["calculatedMicrocredits"] == "19600"

    # Envelope cleaned up after terminal settlement
    assert store.get_in_flight_admission("adm-recovery-priced-01") is None


# ---------------------------------------------------------------------------
# Test 21: WorkerApiClient.cancel_invocation_admission HTTP Contract Verification
# ---------------------------------------------------------------------------
def test_worker_api_client_cancel_invocation_admission_http_contract(monkeypatch):
    """RED Test 21: Verifies WorkerApiClient.cancel_invocation_admission HTTP method, URL, headers, and error handling."""
    # Business purpose: Assert HTTP transport contract for admission cancellation endpoint.
    # Rationale ("Why"): Worker must communicate with /internal/billing/admission/cancel securely and parse errors properly.
    # Mechanism ("How"): Mock httpx at transport layer, check method, path, headers, and payload unwrap.
    # Invariants & Constraints: 409 Conflict translates to WorkerCallbackError with status_code=409.
    client = WorkerApiClient(base_url="http://127.0.0.1:3000", api_key="worker-test-api-key")

    captured_http_requests = []

    def mock_httpx_post(url, json=None, headers=None, timeout=None):
        captured_http_requests.append({
            "url": str(url),
            "headers": dict(headers or {}),
            "json": dict(json or {}),
            "timeout": timeout,
        })
        payload = json or {}
        if payload.get("cancellationReason") == "TRIGGER_409_CONFLICT":
            return httpx.Response(
                409,
                json={
                    "ok": False,
                    "problem": {
                        "status": 409,
                        "code": "BILLING_ADMISSION_ALREADY_IN_FLIGHT",
                        "titleKey": "error.billing.in_flight",
                    },
                },
                request=httpx.Request("POST", url),
            )
        return httpx.Response(
            200,
            json={
                "ok": True,
                "data": {
                    "admissionId": payload.get("admissionId"),
                    "invocationId": payload.get("invocationId"),
                    "state": "CONFIRMED_NO_USAGE",
                    "slotReleased": True,
                },
            },
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx, "post", mock_httpx_post)

    valid_cancel_payload = {
        "admissionId": "adm-cancel-http-01",
        "invocationId": "inv-cancel-http-01",
        "capabilityToken": "cap-token-cancel-abcdef1234567890abcdef1234567890",
        "cancellationReason": "WORKER_CRASH_RECOVERY_NO_USAGE",
    }

    result = client.cancel_invocation_admission(valid_cancel_payload)

    # 1. Verify HTTP boundary
    assert len(captured_http_requests) == 1
    req = captured_http_requests[0]
    assert req["url"] == "http://127.0.0.1:3000/internal/billing/admission/cancel"
    assert req["headers"]["X-Worker-Api-Key"] == "worker-test-api-key"
    assert "X-Correlation-Id" in req["headers"]
    assert req["json"] == valid_cancel_payload

    # 2. Verify response
    assert result["state"] == "CONFIRMED_NO_USAGE"
    assert result["slotReleased"] is True

    # 3. Verify 409 Conflict handling
    conflict_payload = dict(valid_cancel_payload)
    conflict_payload["cancellationReason"] = "TRIGGER_409_CONFLICT"
    with pytest.raises(WorkerCallbackError) as exc_info:
        client.cancel_invocation_admission(conflict_payload)
    assert exc_info.value.status_code == 409


def canonical_tariff_microcredit_calculator(
    input_tokens: int,
    output_tokens: int,
    cached_input_tokens: int = 0,
    cache_write_tokens: int = 0,
    rates: dict[str, int] | None = None,
) -> int:
    """Canonical tariff calculation matching packages/contracts/src/billing/microcredit-pricing.ts:

    totalCharge = (inputTokens * inputRate + cachedInputTokens * cachedRate + cacheWriteTokens * writeRate + outputTokens * outputRate) // 1_000_000
    """
    # Why: Cross-runtime fixtures must use the contract's microcredits-per-million-token rate unit.
    # How: Apply a single integer division after summing all priced buckets.
    # Invariant: The Python fixture mirrors the TS calculator's unit conversion, not server authority.
    tariff = rates or {"input": 10_000_000, "cachedInput": 2_000_000, "cacheWrite": 15_000_000, "output": 30_000_000}
    return (
        input_tokens * tariff["input"]
        + cached_input_tokens * tariff["cachedInput"]
        + cache_write_tokens * tariff["cacheWrite"]
        + output_tokens * tariff["output"]
    ) // 1_000_000


def test_tariff_fixture_applies_per_million_token_unit():
    """Business purpose: Catch a test fixture that reports weighted token numerators as settled microcredits.

    Business rules: Tariff rates are microcredits per million tokens, so the weighted sum must be divided once by one million.
    Execution flow: 1. Calculate a small priced usage sample. 2. Assert its canonical unit conversion.
    Failure cases: An unscaled mock calculator fails this reproducer before it can validate billing assertions.
    Side effects: Pure test calculation; no provider or database access.
    """
    # Why: A mock that omits the per-million conversion can agree with itself while masking a wrong receipt amount.
    # How: Lock a low-rate example whose canonical result is zero microcredits after integer division.
    # Invariant: The fixture follows the same rate unit as packages/contracts/src/billing/microcredit-pricing.ts.
    assert canonical_tariff_microcredit_calculator(
        200,
        500,
        cached_input_tokens=800,
        rates={"input": 10, "cachedInput": 2, "cacheWrite": 15, "output": 30},
    ) == 0


# ---------------------------------------------------------------------------
# Test 22: Settlement With Usage Only In response_metadata / details Calculates Correct Charge (P2)
# ---------------------------------------------------------------------------
def test_settlement_with_usage_only_in_response_metadata_and_details_calculates_correct_charge(tmp_path, monkeypatch):
    """RED Test 22: Provider response with usage metadata ONLY in response_metadata (usage_metadata is None)

    containing prompt_tokens_details (cache) and completion_tokens_details (reasoning) must NOT drop
    priced buckets and must calculate the exact expected financial charge using canonical calculator.
    """
    # Business purpose: Prevent silent dropping of cache and reasoning token pricing when usage is in response_metadata.
    # Rationale ("Why"): Providers like OpenAI place usage in response_metadata["token_usage"]. Dropping them underbills/overbills.
    # Mechanism ("How"): Middleware unpacks response_metadata and nested details, normalizes non-overlapping buckets, and settles.
    # Invariants & Constraints: Exact microcredit charge matching non-overlapping tariff rates; never drops cache or reasoning.
    db_path = tmp_path / "worker_recovery.db"
    keyring = WorkerEnvelopeKeyring(active_key_id=TEST_ACTIVE_KEY_ID, active_key_bytes=TEST_ACTIVE_KEY_BYTES)
    store = CapabilityRecoveryStore(db_path, keyring)

    mock_client = MockSettlementApiClient()
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    # Provider response with usage_metadata=None, all usage located inside response_metadata["token_usage"]
    def mock_response_metadata_only_provider(req):
        return SimpleNamespace(
            content="response_metadata only provider response",
            usage_metadata=None,  # explicitly None!
            response_metadata={
                "id": "resp-meta-only-01",
                "token_usage": {
                    "prompt_tokens": 1000,
                    "completion_tokens": 500,
                    "total_tokens": 1500,
                    "prompt_tokens_details": {
                        "cached_tokens": 800,
                    },
                    "completion_tokens_details": {
                        "reasoning_tokens": 150,
                    },
                },
            },
        )

    middleware = UsageMeteringMiddleware(recovery_store=store)
    req = _valid_model_request()

    middleware.wrap_model_call(req, mock_response_metadata_only_provider)

    assert len(mock_client.settlement_requests) == 1
    req_sent = mock_client.settlement_requests[0]
    assert req_sent["providerCompletionState"] == "COMPLETED"

    # Non-overlapping inputTokens: 1000 inclusive - 800 cached = 200 uncached!
    assert req_sent["inputTokens"] == 200
    assert req_sent["cachedInputTokens"] == 800
    assert req_sent["outputTokens"] == 500
    assert req_sent["reasoningTokens"] == 150
    assert req_sent["totalTokens"] == 1500

    # Why: The tariff uses per-million-token rates; the expected settled amount is 18,600 microcredits.
    # How: Check the mock receipt against the normalized buckets and scaled fixture rates.
    # Invariant: This Python check validates the worker payload; the TS contract test validates authoritative arithmetic.
    expected_charge = canonical_tariff_microcredit_calculator(
        input_tokens=req_sent["inputTokens"],
        output_tokens=req_sent["outputTokens"],
        cached_input_tokens=req_sent.get("cachedInputTokens", 0),
        cache_write_tokens=req_sent.get("cacheWriteTokens", 0),
    )
    assert expected_charge == 18600
    assert len(mock_client.settlement_responses) == 1
    assert mock_client.settlement_responses[0]["calculatedMicrocredits"] == str(expected_charge)

    stored_evidence = store.get_usage_evidence(req_sent["invocationId"])
    assert stored_evidence is not None
    assert stored_evidence["inputTokens"] == 200
    assert stored_evidence["cachedInputTokens"] == 800
    assert stored_evidence["reasoningTokens"] == 150


# ---------------------------------------------------------------------------
# Test 23: Recovery Fails Closed on 409 Non-In-Flight Error Code
# ---------------------------------------------------------------------------
def test_recovery_fails_closed_when_cancellation_error_is_409_with_non_in_flight_code(tmp_path):
    """RED Test 23: Recovery cancellation must ONLY treat BILLING_ADMISSION_ALREADY_IN_FLIGHT as valid in-flight race.

    Any other HTTP 409 error code (e.g. BILLING_CONCURRENCY_LIMIT_REACHED) must fail closed and re-raise.
    """
    # Business purpose: Guarantee recovery sweeper only falls back to OUTCOME_UNKNOWN on genuine consume races.
    # Rationale ("Why"): Arbitrary 409 errors (concurrency limit, quota conflict) must not be masked as in-flight admissions.
    # Mechanism ("How"): Sweeper checks error_code explicitly against BILLING_ADMISSION_ALREADY_IN_FLIGHT.
    # Invariants & Constraints: Non-in-flight 409 errors re-raise; never falls back to settlement.
    db_path = tmp_path / "worker_recovery.db"
    keyring = WorkerEnvelopeKeyring(active_key_id=TEST_ACTIVE_KEY_ID, active_key_bytes=TEST_ACTIVE_KEY_BYTES)
    store = CapabilityRecoveryStore(db_path, keyring)

    raw_token = "cap-token-non-flight-409-0000000000000000"
    store.record_in_flight_admission({
        "admissionId": "adm-conflict-01",
        "invocationId": "inv-conflict-01",
        "runId": "run-conflict-01",
        "attemptOrdinal": 1,
        "capabilityToken": raw_token,
        "maximumExposureMicrocredits": "500000",
        "expiresAt": "2026-11-28T00:05:00Z",
    })

    # Mock client where cancel returns 409 but with a NON-in-flight error code
    mock_client = MockSettlementApiClient()

    def mock_cancel_other_409(payload):
        raise WorkerCallbackError(
            "Concurrency limit conflict",
            status_code=409,
            error_code="BILLING_CONCURRENCY_LIMIT_REACHED",  # Not admissionAlreadyInFlight!
        )

    mock_client.cancel_invocation_admission = mock_cancel_other_409

    # Recovery MUST FAIL CLOSED (re-raise WorkerCallbackError)
    with pytest.raises(WorkerCallbackError) as exc_info:
        recover_in_flight_capabilities(db_path, keyring, mock_client)

    assert exc_info.value.status_code == 409
    assert exc_info.value.error_code == "BILLING_CONCURRENCY_LIMIT_REACHED"
    assert len(mock_client.settlement_requests) == 0, "CRITICAL: Must not call settlement when cancel failed with unknown 409!"


# ---------------------------------------------------------------------------
# Test 24: Contradictory Usage Buckets (Input < Cached) Rejects COMPLETED and Routes to OUTCOME_UNKNOWN
# ---------------------------------------------------------------------------
def test_contradictory_usage_buckets_rejects_completed_settlement_and_reports_outcome_unknown(tmp_path, monkeypatch):
    """RED Test 24: When provider reports contradictory token usage (input=100, cached=200 in inclusive accounting),

    settlement must NOT fallback to raw un-normalized usage to send COMPLETED.
    It must report OUTCOME_UNKNOWN, and retain the envelope and concurrency slot for reconciliation.
    """
    # Business purpose: Prevent billing corruption when provider returns mathematically impossible/contradictory token buckets.
    # Rationale ("Why"): Falling back to raw un-normalized usage bypasses cache-discount verification and double-counting protection.
    # Mechanism ("How"): extract_provider_usage returns None on negative derived uncached input; middleware must NOT fallback to raw usage.
    # Invariants & Constraints: State must be OUTCOME_UNKNOWN; envelope and slot must remain retained.
    db_path = tmp_path / "worker_recovery.db"
    keyring = WorkerEnvelopeKeyring(active_key_id=TEST_ACTIVE_KEY_ID, active_key_bytes=TEST_ACTIVE_KEY_BYTES)
    store = CapabilityRecoveryStore(db_path, keyring)

    mock_client = MockSettlementApiClient()
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    # Provider reports contradictory usage: prompt_tokens=100, but cached_tokens=200
    # In inclusive accounting, uncached = 100 - 200 = -100 (< 0)!
    def mock_contradictory_provider(req):
        return SimpleNamespace(
            content="contradictory provider response",
            usage_metadata={
                "input_tokens": 100,
                "output_tokens": 50,
                "total_tokens": 150,
                "input_token_details": {
                    "cache_read": 200,  # 200 > 100! Contradictory under inclusive accounting!
                },
            },
            response_metadata={"id": "resp-contradictory-1"},
        )

    middleware = UsageMeteringMiddleware(recovery_store=store)
    req = _valid_model_request()

    middleware.wrap_model_call(req, mock_contradictory_provider)

    assert len(mock_client.settlement_requests) == 1
    req_sent = mock_client.settlement_requests[0]

    # Invariant 1: Must NEVER settle as COMPLETED with contradictory/invalid usage
    assert req_sent["providerCompletionState"] != "COMPLETED", (
        "CRITICAL: Contradictory usage (input=100, cached=200) must NEVER be settled as COMPLETED!"
    )
    # Invariant 2: Must report OUTCOME_UNKNOWN to server
    assert req_sent["providerCompletionState"] == "OUTCOME_UNKNOWN"

    # Invariant 3: Envelope and slot must be retained for integrity review / reconciliation
    retained = store.get_in_flight_admission("adm-recovery-test-01")
    assert retained is not None, "Envelope must be retained when usage is contradictory!"





