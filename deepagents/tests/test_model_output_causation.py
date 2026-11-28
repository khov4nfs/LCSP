"""Physical model-call causation survives worker restarts without guessing verdicts."""

import sqlite3

import pytest
from langchain_core.messages import AIMessage
from langchain.agents.middleware import ModelResponse

from middleware.model_output_causation import (
    CausationConflictError,
    find_physical_invocation_for_tool_call,
    record_physical_tool_call_causation,
)
from rule_set_preparation.claim_inventory import attach_physical_invocation_to_rejection


def _response(*tool_call_ids: str) -> ModelResponse:
    return ModelResponse(result=[AIMessage(content="", tool_calls=[
        {"id": call_id, "name": "record_claim", "args": {}}
        for call_id in tool_call_ids
    ])])


def test_physical_tool_call_causation_is_durable_and_distinguishes_calls(tmp_path):
    # Why: A model response can invoke multiple tools, so model turn alone cannot prove causation.
    # How: Persist exact tool-call identities under the server-issued physical invocation.
    # Invariant: A downstream rejection must resolve only its own tool call, including after restart.
    database = tmp_path / "worker.db"
    assert record_physical_tool_call_causation(database, "run-1", "inv-1", _response("call-a", "call-b")) == 2
    assert find_physical_invocation_for_tool_call(database, "run-1", "call-a") == "inv-1"
    assert find_physical_invocation_for_tool_call(database, "run-1", "call-b") == "inv-1"
    assert find_physical_invocation_for_tool_call(database, "run-2", "call-a") is None


def test_replay_is_idempotent_and_reused_provider_id_has_no_unique_verdict_origin(tmp_path):
    # Why: A later provider call can legitimately reuse an opaque tool-call ID.
    # How: Accept exact replay, retain the second origin, and make unqualified lookup ambiguous.
    # Invariant: Paid settlement is not blocked and no verdict is inferred from conflicting origins.
    database = tmp_path / "worker.db"
    response = _response("call-a")
    record_physical_tool_call_causation(database, "run-1", "inv-1", response)
    assert record_physical_tool_call_causation(database, "run-1", "inv-1", response) == 1
    assert record_physical_tool_call_causation(database, "run-1", "inv-2", response) == 1
    assert find_physical_invocation_for_tool_call(database, "run-1", "call-a") is None


def test_missing_or_duplicate_tool_call_id_never_creates_partial_mapping(tmp_path):
    # Why: Unaddressable or duplicate tool calls cannot become trustworthy verdict evidence.
    # How: Validate the complete response before opening the write transaction.
    # Invariant: No partial mapping survives a rejected response.
    database = tmp_path / "worker.db"
    with pytest.raises(CausationConflictError):
        record_physical_tool_call_causation(database, "run-1", "inv-1", _response("call-a", "call-a"))
    with pytest.raises(CausationConflictError):
        record_physical_tool_call_causation(database, "", "inv-1", _response("call-b"))
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM physical_tool_call_causation_v2").fetchone()[0] == 0


def test_provider_reuse_across_paid_invocations_preserves_both_and_makes_lookup_ambiguous(tmp_path):
    # Why: A provider may reuse an opaque tool-call ID on two legitimate physical responses.
    # How: Persist both origins, then require unqualified lookup to return no verdict authority.
    # Invariant: Causation ambiguity must not block financial settlement of the second paid call.
    database = tmp_path / "worker.db"
    record_physical_tool_call_causation(database, "run-1", "inv-1", _response("call-a"))
    assert record_physical_tool_call_causation(database, "run-1", "inv-2", _response("call-a")) == 1
    assert find_physical_invocation_for_tool_call(database, "run-1", "call-a") is None
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM physical_tool_call_causation_v2 WHERE run_id = 'run-1' AND tool_call_id = 'call-a'"
        ).fetchone()[0] == 2


def test_legacy_single_origin_rows_migrate_without_becoming_verdict_authority_on_reuse(tmp_path):
    # Why: Workers may restart with the previous unique mapping table on disk.
    # How: Copy its row into the expanded index before recording a reused provider ID.
    # Invariant: Historical evidence remains visible but ambiguity still suppresses verdict attribution.
    database = tmp_path / "worker.db"
    with sqlite3.connect(database) as connection:
        connection.execute("""CREATE TABLE physical_tool_call_causation (
            run_id TEXT NOT NULL, tool_call_id TEXT NOT NULL, invocation_id TEXT NOT NULL,
            PRIMARY KEY (run_id, tool_call_id)
        )""")
        connection.execute("INSERT INTO physical_tool_call_causation VALUES ('run-1', 'call-a', 'inv-1')")
    assert find_physical_invocation_for_tool_call(database, "run-1", "call-a") == "inv-1"
    record_physical_tool_call_causation(database, "run-1", "inv-2", _response("call-a"))
    assert find_physical_invocation_for_tool_call(database, "run-1", "call-a") is None


def test_rejection_event_carries_physical_origin_only_when_unique(tmp_path):
    # Why: The server journal needs exact physical causation to distinguish reused provider call IDs.
    # How: Enrich one rejection from the durable mapping, then introduce an ambiguous second origin.
    # Invariant: Ambiguous or absent evidence never fabricates a physical invocation ID.
    database = tmp_path / "worker.db"
    record_physical_tool_call_causation(database, "run-1", "inv-1", _response("call-a"))
    envelope = {"toolCallId": "call-a", "rejectionCode": "RULE_AUTHORING_INVALID"}
    assert attach_physical_invocation_to_rejection(database, "run-1", envelope)["physicalInvocationId"] == "inv-1"
    record_physical_tool_call_causation(database, "run-1", "inv-2", _response("call-a"))
    assert "physicalInvocationId" not in attach_physical_invocation_to_rejection(database, "run-1", envelope)
    assert "physicalInvocationId" not in attach_physical_invocation_to_rejection(database, "run-2", envelope)
