"""Health dispatch owns its snapshot hydration on the native Agent Server thread."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from deepagents import create_deep_agent
from langgraph.checkpoint.memory import InMemorySaver

from middleware.system_event_dispatch import dispatch_agent_runtime_system_event
from orchestration.context import LCSPRunContext
from tests.test_native_researcher_task_preparation import ScriptedModel
from tools.common.capabilities.agent_runtime import health_boundary, invocation
from tools.common.capabilities.platform.repository_sandbox import (
    activate_repository_backend,
    current_repository_backend,
)


@pytest.mark.asyncio
@pytest.mark.parametrize("async_mode", [False, True])
async def test_health_dispatch_hydrates_native_thread_and_isolates_backends(
    monkeypatch, async_mode
) -> None:
    backends = {}
    hydrated = []

    def resolve(config):
        thread = config["configurable"]["thread_id"]
        raw = MagicMock()
        raw.id = thread

        def read(*_args, **_kwargs):
            assert current_repository_backend()._backend is raw
            assert thread in {name for name, _pins in hydrated}
            return SimpleNamespace(error=None, file_data={"content": thread})

        raw.read.side_effect = read
        raw.write.return_value = SimpleNamespace(error=None, path=None)
        backends[thread] = raw
        return raw

    def hydrate(raw, **pins):
        assert current_repository_backend() is None
        hydrated.append((raw.id, pins))

    monkeypatch.setattr(health_boundary, "resolve_repository_thread_backend", resolve)
    monkeypatch.setattr(health_boundary, "hydrate_repository", hydrate)
    monkeypatch.setattr(
        invocation, "build_boundary",
        lambda _target: health_boundary.AgentRuntimeHealthBoundary(None),
    )
    model = ScriptedModel()
    graph = create_deep_agent(
        model=model,
        middleware=[dispatch_agent_runtime_system_event],
        context_schema=LCSPRunContext,
        checkpointer=InMemorySaver(),
    )
    requests = []
    for thread in ("health-thread-a", "health-thread-b"):
        context = LCSPRunContext(
            system_boundary_name="agent_runtime_health_requested",
            correlation_id=thread,
            system_event={
                "snapshotId": "snapshot-" + thread,
                "scanJobId": "scan-" + thread,
                "commitSha": "abcdef1",
                "threadId": "untrusted-payload-thread",
                "expectedPath": "src/app.py",
            },
        )
        requests.append(({"configurable": {"thread_id": thread}}, context))
    if async_mode:
        await asyncio.gather(*(
            graph.ainvoke({"messages": []}, config, context=context)
            for config, context in requests
        ))
    else:
        for config, context in requests:
            graph.invoke({"messages": []}, config, context=context)

    assert model.prompts == []
    assert current_repository_backend() is None
    assert {thread for thread, _pins in hydrated} == set(backends) == {
        "health-thread-a", "health-thread-b"
    }
    for thread, pins in hydrated:
        assert pins == {
            "snapshot_id": "snapshot-" + thread,
            "scan_job_id": "scan-" + thread,
            "commit_sha": "abcdef1",
            "correlation_id": thread,
        }
        raw = backends[thread]
        raw.read.assert_called_once_with(
            "/workspace/repository/src/app.py", offset=0, limit=4000
        )
        assert raw.write.call_args.args[0] == "/workspace/repository/.lcsp/agent/runtime-health.json"
        assert json.loads(raw.write.call_args.args[1])["correlationId"] == thread
        state = graph.get_state({"configurable": {"thread_id": thread}})
        assert state.config["configurable"]["checkpoint_id"]


@pytest.mark.parametrize("missing", ["snapshotId", "scanJobId"])
def test_health_dispatch_rejects_missing_snapshot_identity_before_sandbox_access(
    monkeypatch, missing
) -> None:
    resolve = MagicMock(side_effect=AssertionError("must not resolve a sandbox"))
    monkeypatch.setattr(health_boundary, "resolve_repository_thread_backend", resolve)
    event = {"snapshotId": "snapshot-1", "scanJobId": "scan-1"}
    del event[missing]
    with pytest.raises(ValueError, match="snapshotId and scanJobId"):
        health_boundary.AgentRuntimeHealthBoundary(None).handle(event, "corr-1")
    resolve.assert_not_called()


@pytest.mark.parametrize("failure", ["hydrate", "read", "write"])
def test_health_failure_propagates_and_restores_prior_backend(monkeypatch, failure) -> None:
    raw = MagicMock()
    raw.read.return_value = SimpleNamespace(error="missing" if failure == "read" else None)
    raw.write.return_value = SimpleNamespace(
        error="failed" if failure == "write" else None, path=None
    )
    monkeypatch.setattr(
        health_boundary, "get_config",
        lambda: {"configurable": {"thread_id": "health-thread"}},
    )
    monkeypatch.setattr(health_boundary, "resolve_repository_thread_backend", lambda _config: raw)
    hydrate = MagicMock(
        side_effect=RuntimeError("hydrate failed") if failure == "hydrate" else None
    )
    monkeypatch.setattr(health_boundary, "hydrate_repository", hydrate)
    with activate_repository_backend(object()) as prior:
        with pytest.raises(RuntimeError):
            health_boundary.AgentRuntimeHealthBoundary(None).handle(
                {"snapshotId": "snapshot-1", "scanJobId": "scan-1"}, "corr-1"
            )
        assert current_repository_backend() is prior
    assert current_repository_backend() is None
    if failure == "hydrate":
        raw.read.assert_not_called()
    if failure != "write":
        raw.write.assert_not_called()
