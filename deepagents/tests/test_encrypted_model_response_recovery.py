"""Regression tests for durable, encrypted model response handoff."""

import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

from middleware.capability_recovery import CapabilityRecoveryStore
from middleware.capability_recovery import recover_in_flight_capabilities
from middleware.envelope_encryption import CorruptedEnvelopeError, WorkerEnvelopeKeyring


def test_model_response_is_encrypted_bound_and_expires(tmp_path):
    # Why: A paid answer can be lost before LangGraph commits its model node.
    # How: Persist one response under the physical admission and read it only with matching identities.
    # Invariant: No answer text appears in SQLite, and expired answers are unavailable.
    database = tmp_path / "recovery.db"
    store = CapabilityRecoveryStore(database, WorkerEnvelopeKeyring("v1", b"a" * 32))
    expiry = datetime.now(timezone.utc) + timedelta(minutes=5)
    store.record_model_response("admission-1", "invocation-1", "run-1", "step-1", {"content": "private paid answer"}, expiry)

    assert store.get_model_response("admission-1", "invocation-1", "run-1", "step-1") == {"content": "private paid answer"}
    assert store.get_model_response("admission-1", "invocation-1", "run-1", "wrong-step") is None
    with sqlite3.connect(database) as connection:
        stored = connection.execute("SELECT encrypted_response FROM model_response_recovery").fetchone()[0]
    assert "private paid answer" not in stored

    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE model_response_recovery SET run_id = 'other-run'")
    with pytest.raises(CorruptedEnvelopeError):
        store.get_model_response("admission-1", "invocation-1", "other-run", "step-1")


def test_expired_model_response_is_not_replayed(tmp_path):
    # Why: Temporary paid outputs must not remain recoverable indefinitely.
    # How: Reject reads after the persisted expiry boundary.
    # Invariant: Expiry does not authorize a second provider dispatch.
    store = CapabilityRecoveryStore(tmp_path / "recovery.db", WorkerEnvelopeKeyring("v1", b"a" * 32))
    store.record_model_response(
        "admission-1", "invocation-1", "run-1", "step-1", {"content": "expired"},
        datetime.now(timezone.utc) - timedelta(seconds=1),
    )
    assert store.get_model_response("admission-1", "invocation-1", "run-1", "step-1") is None


def test_replay_requires_terminal_server_ack_and_exact_step(tmp_path):
    # Why: A provider response may exist before settlement commits; replaying it early would bypass billing authority.
    # How: Lookup by stable graph step becomes available only after a terminal server acknowledgement.
    # Invariant: A different run or step cannot recover the paid output.
    store = CapabilityRecoveryStore(tmp_path / "recovery.db", WorkerEnvelopeKeyring("v1", b"a" * 32))
    store.record_model_response(
        "admission-1", "invocation-1", "run-1", "step-1", {"content": "paid answer"},
        datetime.now(timezone.utc) + timedelta(minutes=5),
    )
    assert store.get_terminal_model_response("run-1", "step-1") is None
    store.mark_model_response_terminal("admission-1")
    assert store.get_terminal_model_response("run-1", "step-1") == {"content": "paid answer"}
    assert store.get_terminal_model_response_record("run-1", "step-1") == {
        "admissionId": "admission-1", "invocationId": "invocation-1", "response": {"content": "paid answer"},
    }
    assert store.get_terminal_model_response("other-run", "step-1") is None
    assert store.get_terminal_model_response("run-1", "other-step") is None


def test_terminal_response_is_deleted_after_checkpoint_and_expired_rows_are_purged(tmp_path):
    # Why: A replay cache must not become a permanent store of customer model outputs.
    # How: Delete after checkpoint acknowledgement and sweep expired ciphertext independently.
    # Invariant: Cleanup never authorizes a repeat provider dispatch.
    store = CapabilityRecoveryStore(tmp_path / "recovery.db", WorkerEnvelopeKeyring("v1", b"a" * 32))
    store.record_model_response(
        "admission-1", "invocation-1", "run-1", "step-1", {"content": "paid answer"},
        datetime.now(timezone.utc) + timedelta(minutes=5),
    )
    store.mark_model_response_terminal("admission-1")
    store.delete_model_response("admission-1")
    assert store.get_terminal_model_response("run-1", "step-1") is None
    store.record_model_response(
        "admission-2", "invocation-2", "run-2", "step-2", {"content": "expired"},
        datetime.now(timezone.utc) - timedelta(seconds=1),
    )
    assert store.purge_expired_model_responses() == 1
    with sqlite3.connect(store.db_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM model_response_recovery").fetchone()[0] == 0


def test_second_admission_cannot_replace_first_paid_step(tmp_path):
    # Why: A crash replay can accidentally issue a second admission for one logical step.
    # How: Preserve the first encrypted response and reject a conflicting insert.
    # Invariant: A later invocation cannot overwrite an already paid answer.
    store = CapabilityRecoveryStore(tmp_path / "recovery.db", WorkerEnvelopeKeyring("v1", b"a" * 32))
    expiry = datetime.now(timezone.utc) + timedelta(minutes=5)
    store.record_model_response("admission-1", "invocation-1", "run-1", "step-1", {"content": "first"}, expiry)
    with pytest.raises(sqlite3.IntegrityError):
        store.record_model_response("admission-2", "invocation-2", "run-1", "step-1", {"content": "second"}, expiry)
    assert store.get_model_response("admission-1", "invocation-1", "run-1", "step-1") == {"content": "first"}


def test_same_admission_can_stamp_terminal_payment_before_ack_only(tmp_path):
    # Why: A server-owned payment pause arrives after settlement and must survive graph replay.
    # How: Replace only the same admission's ciphertext while it is still locally pending.
    # Invariant: No other invocation can rewrite a paid response and terminal rows are immutable.
    store = CapabilityRecoveryStore(tmp_path / "recovery.db", WorkerEnvelopeKeyring("v1", b"a" * 32))
    expiry = datetime.now(timezone.utc) + timedelta(minutes=5)
    store.record_model_response("admission-1", "invocation-1", "run-1", "step-1", {"payment": False}, expiry)
    store.update_model_response_before_terminal(
        "admission-1", "invocation-1", "run-1", "step-1", {"payment": True},
    )
    assert store.get_model_response("admission-1", "invocation-1", "run-1", "step-1") == {"payment": True}
    store.mark_model_response_terminal("admission-1")
    with pytest.raises(ValueError):
        store.update_model_response_before_terminal(
            "admission-1", "invocation-1", "run-1", "step-1", {"payment": False},
        )


def test_crash_sweeper_marks_paid_response_replayable_after_server_settlement(tmp_path):
    # Why: A crash can happen after encrypted answer and usage are durable but before settlement acknowledgement.
    # How: Let the startup sweeper settle usage and promote only the matching answer on terminal server success.
    # Invariant: Recovery never redispatches the provider or loses the already paid response.
    keyring = WorkerEnvelopeKeyring("v1", b"a" * 32)
    database = tmp_path / "recovery.db"
    store = CapabilityRecoveryStore(database, keyring)
    store.record_in_flight_admission({
        "admissionId": "admission-1", "invocationId": "invocation-1", "runId": "run-1",
        "capabilityToken": "a" * 48, "attemptOrdinal": 1,
    })
    store.record_model_response(
        "admission-1", "invocation-1", "run-1", "step-1", {"content": "paid answer"},
        datetime.now(timezone.utc) + timedelta(minutes=5),
    )
    store.record_usage_evidence("invocation-1", {
        "inputTokens": 1, "outputTokens": 1, "totalTokens": 2,
        "toolCallIds": ["call-a", "call-b"],
    })

    class TerminalClient:
        calls = 0
        payload = None

        def settle_invocation_usage(self, payload):
            self.calls += 1
            self.payload = payload
            return {"settled": True, "slotReleased": True, "debitMode": "SHADOW"}

    client = TerminalClient()
    recover_in_flight_capabilities(database, keyring, client)
    assert client.calls == 1
    assert client.payload["toolCallIds"] == ["call-a", "call-b"]
    assert store.get_terminal_model_response("run-1", "step-1") == {"content": "paid answer"}


def test_store_restart_purges_expired_ciphertext(tmp_path):
    # Why: A read TTL alone leaves customer output on disk after the recovery window.
    # How: Reopen the store and require startup cleanup of expired ciphertext.
    # Invariant: Billing admission evidence remains separate from response retention.
    database = tmp_path / "recovery.db"
    keyring = WorkerEnvelopeKeyring("v1", b"a" * 32)
    store = CapabilityRecoveryStore(database, keyring)
    store.record_model_response(
        "admission-1", "invocation-1", "run-1", "step-1", {"content": "expired"},
        datetime.now(timezone.utc) - timedelta(seconds=1),
    )
    CapabilityRecoveryStore(database, keyring)
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM model_response_recovery").fetchone()[0] == 0


def test_legacy_store_duplicate_graph_step_fails_closed_on_startup(tmp_path):
    # Why: An older local schema may lack the unique run/step index.
    # How: Attempt migration against duplicate historical rows.
    # Invariant: Startup must reject ambiguity instead of fetchone choosing a paid answer.
    database = tmp_path / "legacy.db"
    with sqlite3.connect(database) as connection:
        connection.execute("""CREATE TABLE model_response_recovery (
            admission_id TEXT PRIMARY KEY, invocation_id TEXT NOT NULL, run_id TEXT NOT NULL,
            step_id TEXT NOT NULL, encrypted_response TEXT NOT NULL, expires_at TEXT NOT NULL
        )""")
        future = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
        connection.executemany(
            "INSERT INTO model_response_recovery VALUES (?, ?, 'run-1', 'step-1', 'ciphertext', ?)",
            [("admission-1", "invocation-1", future), ("admission-2", "invocation-2", future)],
        )
    with pytest.raises(sqlite3.IntegrityError):
        CapabilityRecoveryStore(database, WorkerEnvelopeKeyring("v1", b"a" * 32))


@pytest.mark.parametrize("invalid_ids", [["duplicate", "duplicate"], ["café"]])
def test_crash_sweeper_does_not_complete_with_corrupt_tool_call_ids(tmp_path, invalid_ids):
    # Why: Dropping corrupt causation IDs would create a completed receipt missing reported tool calls.
    # How: Require an unknown outcome when the durable list violates the canonical contract.
    # Invariant: No fabricated or partial COMPLETED billing evidence is sent.
    keyring = WorkerEnvelopeKeyring("v1", b"a" * 32)
    database = tmp_path / "recovery.db"
    store = CapabilityRecoveryStore(database, keyring)
    store.record_in_flight_admission({
        "admissionId": "admission-1", "invocationId": "invocation-1", "runId": "run-1",
        "capabilityToken": "a" * 48, "attemptOrdinal": 1,
    })
    store.record_usage_evidence("invocation-1", {
        "inputTokens": 1, "outputTokens": 1, "totalTokens": 2,
        "toolCallIds": invalid_ids,
    })

    class Client:
        payload = None

        def settle_invocation_usage(self, payload):
            self.payload = payload
            return {"settled": False, "slotReleased": False}

    client = Client()
    recover_in_flight_capabilities(database, keyring, client)
    assert client.payload["providerCompletionState"] == "OUTCOME_UNKNOWN"
    assert store.get_in_flight_admission("admission-1") is not None
