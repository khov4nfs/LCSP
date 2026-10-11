"""Real native checkpoints are erased; another assessment and its files survive."""

from concurrent.futures import Future
import threading
from uuid import uuid4

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from starlette.testclient import TestClient

from tools.common.capabilities.agent_runtime import local_server
from tools.common.capabilities.agent_runtime.agent_server_client import agent_thread_id
from tools.common.capabilities.platform import logging_path
from tools.common.capabilities.platform.docker_sandbox import DockerSandboxManager


@pytest.fixture
def runtime(monkeypatch, tmp_path):
    value = local_server.LocalAgentRuntime()
    saver = InMemorySaver()
    builder = StateGraph(dict)
    builder.add_node("persist", lambda state: state)
    builder.add_edge(START, "persist")
    builder.add_edge("persist", END)
    value.graph = builder.compile(checkpointer=saver)
    value._checkpointer = saver
    erased = []
    monkeypatch.setattr(DockerSandboxManager, "erase", lambda _self, thread: erased.append(thread))
    monkeypatch.setattr(logging_path, "get_repo_root", lambda: str(tmp_path))
    yield value, saver, erased
    value.close()


def test_checkpoint_namespace_private_logs_and_runtime_state_erased_idempotently(runtime, tmp_path):
    value, saver, erased = runtime
    root, other = str(uuid4()), str(uuid4())
    transport = agent_thread_id("", {"assessmentId": "assessment-owned"}, "")
    for thread in (root, transport, other):
        value.create_thread({"thread_id": thread})
        value.graph.invoke({"customer": thread}, {"configurable": {"thread_id": thread}})
    own = tmp_path / "tmp/user_owner/assessment_assessment-owned"
    own.mkdir(parents=True)
    (own / "run.log").write_text("synthetic customer content")
    unattributed = tmp_path / "tmp/user_unknown_user/assessment_assessment-owned"
    unattributed.mkdir(parents=True)
    (unattributed / "run.log").write_text("synthetic early customer content")
    other_path = tmp_path / "tmp/user_owner/assessment_another"
    other_path.mkdir()
    (other_path / "run.log").write_text("another assessment")
    other_checkpoints = list(saver.list({"configurable": {"thread_id": other}}))
    value.erase_assessment("assessment-owned", "owner", root)
    value.erase_assessment("assessment-owned", "owner", root)
    assert not own.exists()
    assert not unattributed.exists()
    assert (other_path / "run.log").read_text() == "another assessment"
    assert list(saver.list({"configurable": {"thread_id": other}})) == other_checkpoints
    assert set(erased) == {root, transport}
    for thread in (root, transport):
        assert not list(saver.list({"configurable": {"thread_id": thread}}))
        assert value.get_thread(thread) is None
        assert value.list_runs(thread) == []
        with pytest.raises(PermissionError):
            value.create_run(thread, {"input": None})
        with pytest.raises(PermissionError):
            value.get_state(thread)


def test_running_execution_drains_before_erasure_and_pending_execution_is_cancelled(runtime):
    value, saver, erased = runtime
    root = str(uuid4())
    running, pending = Future(), Future()
    running.set_running_or_notify_cancel()
    cancel = threading.Event()
    for run, future in (("running", running), ("pending", pending)):
        value._runs[(root, run)] = {"status": run}
        value._run_futures[(root, run)] = future
        value._cancel_events[(root, run)] = cancel
    result = []
    worker = threading.Thread(target=lambda: (value.erase_assessment("owned", "owner", root), result.append(True)))
    worker.start()
    assert cancel.wait(timeout=2)
    assert not erased
    running.set_result(None)
    worker.join(timeout=2)
    assert not worker.is_alive()
    assert result == [True]
    assert pending.cancelled()
    assert not value._runs


def test_erasure_http_auth_schema_and_revoked_access(runtime, monkeypatch):
    value, _, _ = runtime
    monkeypatch.setenv("WORKER_API_KEY", "synthetic-worker-key")
    monkeypatch.setattr(local_server.app.state, "runtime", value, raising=False)
    client = TestClient(local_server.app)
    root = str(uuid4())
    body = {"assessmentId": "owned", "ownerId": "owner", "threadId": root}
    headers = {"x-worker-api-key": "synthetic-worker-key"}
    assert client.post("/internal/assessment-erasure", json=body).status_code == 403
    assert client.post("/internal/assessment-erasure", json={**body, "ownerId": "../other"}, headers=headers).status_code == 400
    assert client.post("/internal/assessment-erasure", json={**body, "extra": "customer"}, headers=headers).status_code == 400
    assert client.post("/internal/assessment-erasure", json=body, headers=headers).json() == {"erased": True}
    assert client.get(f"/threads/{root}/state").status_code == 404
    assert client.post(f"/threads/{root}/runs", json={"input": None}).status_code == 404


def test_log_cleanup_refuses_symlinks_and_other_tenants(tmp_path, monkeypatch):
    monkeypatch.setattr(logging_path, "get_repo_root", lambda: str(tmp_path))
    target = tmp_path / "tmp/user_owner"
    other = tmp_path / "other"
    other.mkdir()
    target.parent.mkdir()
    target.symlink_to(other, target_is_directory=True)
    with pytest.raises(ValueError):
        logging_path.erase_assessment_logs("owner", "owned")
    with pytest.raises(ValueError):
        logging_path.erase_assessment_logs("../other", "owned")
    assert other.is_dir()
