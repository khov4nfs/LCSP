"""Root checkpoint barriers with real LangGraph execution and no model or network calls."""

from __future__ import annotations

import threading
from typing import Any, TypedDict

import pytest
from deepagents.backends import FilesystemBackend
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.pregel._executor import BackgroundExecutor
from test_assessment_root_agent import ASSESSMENT, THREAD, FakeClient

from assessment_root.runner import run_assessment_root


@pytest.mark.parametrize("commit_fails", [False, True])
def test_root_checkpoint_commit_precedes_next_step(monkeypatch, tmp_path, commit_fails):
    client = FakeClient()
    release_commit = threading.Event()
    committed = threading.Event()
    next_step_observations: list[bool] = []
    invocation_thread = threading.get_ident()

    class State(TypedDict):
        messages: list[Any]
        step: int

    class GatedSaver(InMemorySaver):
        def put(self, config, checkpoint, metadata, new_versions):
            if metadata.get("step") == 1:
                assert release_commit.wait(5), "checkpoint barrier never drained"
                if commit_fails:
                    raise RuntimeError("checkpoint_commit_failed")
            result = super().put(config, checkpoint, metadata, new_versions)
            if metadata.get("step") == 1:
                committed.set()
            return result

    saver = GatedSaver()
    native_submit = BackgroundExecutor.submit

    # Release on a real execution-side checkpoint wait, or observe unsafe advancement without sleeps.
    def observe_checkpoint_wait(executor, task, *args, **kwargs):
        future = native_submit(executor, task, *args, **kwargs)
        if (
            getattr(task, "__name__", "") == "_checkpointer_put_after_previous"
            and len(args) >= 4
            and args[3].get("step") == 1
        ):
            native_result = future.result

            def release_when_execution_waits(timeout=None):
                if threading.get_ident() == invocation_thread:
                    release_commit.set()
                return native_result(timeout)

            monkeypatch.setattr(future, "result", release_when_execution_waits)
        return future

    def next_step(_state):
        next_step_observations.append(committed.is_set())
        release_commit.set()
        client.lifecycle_state = "COMPLETE"
        return {"step": 2}

    builder = StateGraph(State)
    builder.add_node("first", lambda _state: {"step": 1})
    builder.add_node("next", next_step)
    builder.add_edge(START, "first")
    builder.add_edge("first", "next")
    builder.add_edge("next", END)
    graph = builder.compile(checkpointer=saver).with_config({"max_concurrency": 8})
    monkeypatch.setattr(BackgroundExecutor, "submit", observe_checkpoint_wait)
    monkeypatch.setattr("assessment_root.runner.create_assessment_root_agent", lambda **_kwargs: graph)

    try:
        result = run_assessment_root(
            client,
            ASSESSMENT,
            backend_factory=lambda *_: (FilesystemBackend(root_dir=tmp_path, virtual_mode=True), None),
            model=object(),
            checkpointer=saver,
            governance=(),
        )
    finally:
        release_commit.set()

    assert result["threadId"] == THREAD
    if commit_fails:
        assert result["state"] == "FAILED"
        assert result["errorType"] == "RuntimeError"
        assert next_step_observations == []
        assert ("finish", "FAILED") in client.calls
    else:
        assert result["state"] == "SUCCEEDED"
        assert next_step_observations == [True]
        assert ("finish", "SUCCEEDED") in client.calls
