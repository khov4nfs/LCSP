"""Checkpoint acknowledgement may erase only the exact, durably written paid response."""

from datetime import datetime, timedelta, timezone
import sqlite3

import pytest
from langchain_core.messages import AIMessage
from langchain_core.messages import message_to_dict
from langchain_core.messages import HumanMessage
from langchain.agents import create_agent
from langchain.agents.middleware import AgentMiddleware
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.postgres import PostgresSaver

from middleware.capability_recovery import CapabilityRecoveryStore
from middleware.envelope_encryption import WorkerEnvelopeKeyring
from tools.common.capabilities.agent_runtime.root_capacity import MeasuredPostgresSaver
from middleware.usage_metering import AgentRoleMiddleware, AgentRunState, activate_agent_run_state, active_model_step_id
from test_assessment_root_agent import RootScriptedModel


def _store(tmp_path, monkeypatch):
    # Why: Use the production worker-local encryption and recovery path in the checkpoint test.
    # How: Configure one deterministic test key and create an acknowledged response.
    # Invariant: No plaintext answer is placed in the checkpoint-ack plumbing.
    db_path = tmp_path / "recovery.db"
    monkeypatch.setenv("WORKER_RECOVERY_DB_PATH", str(db_path))
    monkeypatch.setenv("WORKER_ENVELOPE_ENCRYPTION_KEY", "61" * 32)
    store = CapabilityRecoveryStore(db_path, WorkerEnvelopeKeyring("v1", b"a" * 32))
    paid_message = AIMessage(content="paid", additional_kwargs={"_lcsp_physical_invocation_id": "inv-1"})
    store.record_model_response(
        "adm-1", "inv-1", "run-1", "graph-task:task-1",
        {"result": [message_to_dict(paid_message)], "structured_response": None},
        datetime.now(timezone.utc) + timedelta(hours=1),
    )
    store.mark_model_response_terminal("adm-1")
    return store


def _put(monkeypatch, *, fail=False):
    # Why: The test must distinguish a real saver success from an exception before persistence.
    # How: Patch only native PostgresSaver I/O while exercising the measured subclass.
    # Invariant: Cleanup cannot run before the native saver returns.
    calls = []

    def native_put(self, config, writes, task_id, task_path=""):
        calls.append((task_id, writes))
        if fail:
            raise RuntimeError("native checkpoint write failed")

    monkeypatch.setattr(PostgresSaver, "put_writes", native_put)
    return object.__new__(MeasuredPostgresSaver), calls


def test_paid_response_deleted_only_after_matching_native_model_write(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch)
    saver, writes = _put(monkeypatch)
    msg = AIMessage(content="paid", additional_kwargs={"_lcsp_physical_invocation_id": "inv-1"})
    saver.put_writes(
        {"metadata": {"assessment_root_execution_id": "run-1"}, "configurable": {}},
        [("messages", [msg])], "task-1", "~__pregel_pull, model",
    )
    assert len(writes) == 1
    assert store.get_terminal_model_response_record("run-1", "graph-task:task-1") is None


@pytest.mark.parametrize("wrong", ["run", "task", "invocation", "path", "channel"])
def test_checkpoint_ack_keeps_response_when_binding_is_wrong(tmp_path, monkeypatch, wrong):
    store = _store(tmp_path, monkeypatch)
    saver, _ = _put(monkeypatch)
    run_id = "other-run" if wrong == "run" else "run-1"
    task_id = "other-task" if wrong == "task" else "task-1"
    invocation = "other-invocation" if wrong == "invocation" else "inv-1"
    path = "~__pregel_pull, tools" if wrong == "path" else "~__pregel_pull, model"
    channel = "other" if wrong == "channel" else "messages"
    saver.put_writes(
        {"metadata": {"assessment_root_execution_id": run_id}, "configurable": {}},
        [(channel, [AIMessage(content="paid", additional_kwargs={"_lcsp_physical_invocation_id": invocation})])],
        task_id, path,
    )
    assert store.get_terminal_model_response_record("run-1", "graph-task:task-1") is not None


def test_failed_native_write_keeps_paid_response(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch)
    saver, _ = _put(monkeypatch, fail=True)
    msg = AIMessage(content="paid", additional_kwargs={"_lcsp_physical_invocation_id": "inv-1"})
    with pytest.raises(RuntimeError, match="native checkpoint write failed"):
        saver.put_writes(
            {"metadata": {"assessment_root_execution_id": "run-1"}, "configurable": {}},
            [("messages", [msg])], "task-1", "~__pregel_pull, model",
        )
    assert store.get_terminal_model_response_record("run-1", "graph-task:task-1") is not None


def test_native_graph_model_pending_write_deletes_only_matching_paid_answer(tmp_path, monkeypatch):
    # Why: Synthetic saver arguments might not reflect the actual LangGraph model write shape.
    # How: Run a real graph with native InMemorySaver pending writes and invoke the same ack filter after persistence.
    # Invariant: Cleanup follows the native model write and leaves the graph answer available from checkpoint.
    db_path = tmp_path / "recovery.db"
    monkeypatch.setenv("WORKER_RECOVERY_DB_PATH", str(db_path))
    monkeypatch.setenv("WORKER_ENVELOPE_ENCRYPTION_KEY", "61" * 32)
    store = CapabilityRecoveryStore(db_path, WorkerEnvelopeKeyring("v1", b"a" * 32))

    class PersistResponse(AgentMiddleware):
        def wrap_model_call(self, request, handler):
            response = handler(request)
            response.result[0].additional_kwargs["_lcsp_physical_invocation_id"] = "inv-1"
            store.record_model_response(
                "adm-1", "inv-1", "run-1", active_model_step_id(),
                {"result": [message_to_dict(message) for message in response.result], "structured_response": None},
                datetime.now(timezone.utc) + timedelta(hours=1),
            )
            store.mark_model_response_terminal("adm-1")
            return response

    class NativeSpy(InMemorySaver):
        def put_writes(self, config, writes, task_id, task_path=""):
            saved = super().put_writes(config, writes, task_id, task_path)
            MeasuredPostgresSaver._delete_checkpointed_model_response(config, writes, task_id, task_path)
            return saved

    saver = NativeSpy()
    model = RootScriptedModel(responses=[AIMessage(content="paid answer")])
    agent = create_agent(
        model, tools=[],
        middleware=[AgentRoleMiddleware("assessment-root", operation_type="SYNTHESIS"), PersistResponse()],
        checkpointer=saver,
    )
    with activate_agent_run_state(AgentRunState(run_id="run-1", agent_role="assessment-root")):
        result = agent.invoke(
            {"messages": [HumanMessage(content="evaluate")]},
            config={"configurable": {"thread_id": "thread-1"},
                    "metadata": {"assessment_root_execution_id": "run-1"}},
        )
    assert result["messages"][-1].content == "paid answer"
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM model_response_recovery").fetchone()[0] == 0
