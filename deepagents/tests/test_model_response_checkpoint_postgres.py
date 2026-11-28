"""Live PostgreSQL evidence for Assessment Root paid-response checkpoint cleanup."""

import os
import sqlite3
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse
from uuid import uuid4

import psycopg
import pytest
from langchain.agents import create_agent
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import AIMessage, HumanMessage, message_to_dict

from middleware.capability_recovery import CapabilityRecoveryStore
from middleware.envelope_encryption import WorkerEnvelopeKeyring
from middleware.usage_metering import (
    AgentRoleMiddleware,
    AgentRunState,
    activate_agent_run_state,
    active_model_step_id,
)
from test_assessment_root_agent import RootScriptedModel
from tools.common.capabilities.agent_runtime.root_capacity import MeasuredPostgresSaver


def _dedicated_checkpoint_url():
    # Why: This test writes native LangGraph checkpoints and must never touch a local or production DB.
    # How: Require an explicit loopback endpoint and exact dedicated test database before connecting.
    # Invariant: No connection attempt occurs for any other target.
    raw = os.environ.get("LCSP_CHECKPOINT_ACK_TEST_DATABASE_URL")
    if raw is None:
        pytest.skip("LCSP_CHECKPOINT_ACK_TEST_DATABASE_URL is required for live Postgres evidence")
    parsed = urlparse(raw)
    if (
        parsed.scheme not in {"postgres", "postgresql"}
        or parsed.hostname != "127.0.0.1"
        or parsed.port != 55432
        or parsed.path != "/lcsp_api_test"
    ):
        raise RuntimeError("Checkpoint acknowledgement test requires 127.0.0.1:55432/lcsp_api_test")
    return raw


def _delete_test_thread(connection, thread_id):
    # Why: Keep the dedicated test database free of synthetic customer answers.
    # How: Delete only rows tied to this random test thread after assertions.
    # Invariant: No other run's checkpoints or billing records are touched.
    for table in ("checkpoint_writes", "checkpoint_blobs", "checkpoints"):
        connection.execute(f"DELETE FROM {table} WHERE thread_id = %s", (thread_id,))


@pytest.mark.parametrize("physical_marker, expected_rows", [("inv-1", 0), ("wrong-invocation", 1)])
def test_live_postgres_model_checkpoint_ack_erases_only_durable_paid_response(
    tmp_path, monkeypatch, physical_marker, expected_rows,
):
    # Why: Mocked put_writes could miss a native Postgres serialization or acknowledgement difference.
    # How: Run a real graph through MeasuredPostgresSaver and inspect both checkpoint and encrypted local store.
    # Invariant: The answer survives in the native checkpoint while its temporary encrypted copy is removed.
    url = _dedicated_checkpoint_url()
    thread_id = f"checkpoint-paid-{uuid4()}"
    run_id = f"run-{uuid4()}"
    db_path = tmp_path / "recovery.db"
    monkeypatch.setenv("WORKER_RECOVERY_DB_PATH", str(db_path))
    monkeypatch.setenv("WORKER_ENVELOPE_ENCRYPTION_KEY", "61" * 32)
    store = CapabilityRecoveryStore(db_path, WorkerEnvelopeKeyring("v1", b"a" * 32))

    class PersistPaidResponse(AgentMiddleware):
        def wrap_model_call(self, request, handler):
            response = handler(request)
            response.result[0].additional_kwargs["_lcsp_physical_invocation_id"] = physical_marker
            store.record_model_response(
                "adm-1", "inv-1", run_id, active_model_step_id(),
                {"result": [message_to_dict(message) for message in response.result], "structured_response": None},
                datetime.now(timezone.utc) + timedelta(hours=1),
            )
            store.mark_model_response_terminal("adm-1")
            return response

    model = RootScriptedModel(responses=[AIMessage(content="paid answer")])
    try:
        with MeasuredPostgresSaver.from_conn_string(url) as saver:
            saver.setup()
            agent = create_agent(
                model, tools=[],
                middleware=[AgentRoleMiddleware("assessment-root", operation_type="SYNTHESIS"), PersistPaidResponse()],
                checkpointer=saver,
            )
            config = {
                "configurable": {"thread_id": thread_id},
                "metadata": {"assessment_root_execution_id": run_id},
            }
            with activate_agent_run_state(AgentRunState(run_id=run_id, agent_role="assessment-root")):
                result = agent.invoke({"messages": [HumanMessage(content="evaluate")]}, config=config)
            assert result["messages"][-1].content == "paid answer"
            saved = saver.get_tuple(config)
            assert saved is not None
            assert saved.checkpoint["channel_values"]["messages"][-1].content == "paid answer"
        with sqlite3.connect(db_path) as connection:
            assert connection.execute("SELECT COUNT(*) FROM model_response_recovery").fetchone()[0] == expected_rows
        assert len(model.prompts) == 1
    finally:
        with psycopg.connect(url, autocommit=True) as connection:
            _delete_test_thread(connection, thread_id)


def test_failed_live_postgres_pending_write_retains_paid_response(tmp_path, monkeypatch):
    # Why: A failed native Postgres write is not a checkpoint acknowledgement.
    # How: Close a real saver connection before the pending-write call and inspect local recovery.
    # Invariant: A database outage cannot erase the only durable copy of a paid answer.
    url = _dedicated_checkpoint_url()
    db_path = tmp_path / "recovery.db"
    monkeypatch.setenv("WORKER_RECOVERY_DB_PATH", str(db_path))
    monkeypatch.setenv("WORKER_ENVELOPE_ENCRYPTION_KEY", "61" * 32)
    store = CapabilityRecoveryStore(db_path, WorkerEnvelopeKeyring("v1", b"a" * 32))
    message = AIMessage(content="paid", additional_kwargs={"_lcsp_physical_invocation_id": "inv-1"})
    store.record_model_response(
        "adm-1", "inv-1", "run-1", "graph-task:task-1",
        {"result": [message_to_dict(message)], "structured_response": None},
        datetime.now(timezone.utc) + timedelta(hours=1),
    )
    store.mark_model_response_terminal("adm-1")
    with MeasuredPostgresSaver.from_conn_string(url) as saver:
        saver.setup()
        saver.conn.close()
        with pytest.raises(Exception):
            saver.put_writes(
                {"configurable": {"thread_id": f"failed-{uuid4()}", "checkpoint_ns": "", "checkpoint_id": str(uuid4())},
                 "metadata": {"assessment_root_execution_id": "run-1"}},
                [("messages", [message])], "task-1", "~__pregel_pull, model",
            )
    assert store.get_terminal_model_response_record("run-1", "graph-task:task-1") is not None
