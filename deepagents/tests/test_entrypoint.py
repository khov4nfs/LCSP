from __future__ import annotations

from pathlib import Path

import pytest

import entrypoint
from tools.common.capabilities.agent_runtime import local_server


def test_entrypoint_uses_langgraph_dev_only_for_non_production(monkeypatch) -> None:
    monkeypatch.delenv("LCSP_AGENT_RUNTIME_MODE", raising=False)
    monkeypatch.delenv("LCSP_AGENT_RUNTIME_SERVER_COMMAND", raising=False)
    monkeypatch.delenv("NODE_ENV", raising=False)

    command = entrypoint._agent_server_command()

    assert command[1:] == (
        "dev",
        "--no-browser",
        "--no-reload",
        "--allow-blocking",
        "--n-jobs-per-worker",
        str(entrypoint.DEFAULT_AGENT_RUNTIME_JOBS_PER_WORKER),
    )
    assert entrypoint._uses_langgraph_dev(command) is True


def test_entrypoint_accepts_explicit_agent_runtime_concurrency(monkeypatch) -> None:
    monkeypatch.delenv("LCSP_AGENT_RUNTIME_MODE", raising=False)
    monkeypatch.delenv("LCSP_AGENT_RUNTIME_SERVER_COMMAND", raising=False)
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_JOBS_PER_WORKER", "12")

    command = entrypoint._agent_server_command()

    assert command[-2:] == ("--n-jobs-per-worker", "12")


def test_entrypoint_rejects_invalid_agent_runtime_concurrency(monkeypatch) -> None:
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_JOBS_PER_WORKER", "0")

    with pytest.raises(RuntimeError, match="between 1 and 64"):
        entrypoint._agent_runtime_jobs_per_worker()


def test_entrypoint_defaults_to_combined_runtime_role(monkeypatch) -> None:
    monkeypatch.delenv("LCSP_AGENT_RUNTIME_ROLE", raising=False)

    assert entrypoint._agent_runtime_role() == "combined"


def test_entrypoint_accepts_fogewise_bridge_role(monkeypatch) -> None:
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_ROLE", "bridge")

    assert entrypoint._agent_runtime_role() == "bridge"


def test_entrypoint_rejects_unknown_runtime_role(monkeypatch) -> None:
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_ROLE", "worker")

    with pytest.raises(RuntimeError, match="LCSP_AGENT_RUNTIME_ROLE"):
        entrypoint._agent_runtime_role()


def test_entrypoint_uses_lcsp_local_server_in_production(monkeypatch) -> None:
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_MODE", "production")
    monkeypatch.delenv("LCSP_AGENT_RUNTIME_SERVER_COMMAND", raising=False)

    command = entrypoint._agent_server_command()

    assert Path(command[0]).name == Path(entrypoint.sys.executable).name
    assert command[1:] == (
        "-m",
        "tools.common.capabilities.agent_runtime.local_server",
    )


def test_entrypoint_accepts_explicit_production_agent_server_command(monkeypatch) -> None:
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_MODE", "production")
    monkeypatch.setenv(
        "LCSP_AGENT_RUNTIME_SERVER_COMMAND",
        "python -m tools.common.capabilities.agent_runtime.local_server",
    )

    command = entrypoint._agent_server_command()

    assert Path(command[0]).name == "python"
    assert command[1:] == (
        "-m",
        "tools.common.capabilities.agent_runtime.local_server",
    )


def test_entrypoint_rejects_langgraph_cli_in_production(
    monkeypatch,
) -> None:
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_MODE", "production")
    monkeypatch.setenv(
        "LCSP_AGENT_RUNTIME_SERVER_COMMAND",
        "langgraph up --config langgraph.json --port 2024",
    )

    with pytest.raises(RuntimeError, match="not the langgraph CLI"):
        entrypoint._agent_server_command()


def test_entrypoint_rejects_non_server_command_in_production(
    monkeypatch,
) -> None:
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_MODE", "production")
    monkeypatch.setenv(
        "LCSP_AGENT_RUNTIME_SERVER_COMMAND",
        "python -m tools.common.capabilities.agent_runtime.rabbitmq_consumer",
    )

    with pytest.raises(RuntimeError, match="local_server"):
        entrypoint._agent_server_command()


def test_entrypoint_rejects_unexpanded_production_command_env(monkeypatch) -> None:
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_MODE", "production")
    monkeypatch.delenv("LANGGRAPH_CHECKPOINT_DATABASE_URL", raising=False)
    monkeypatch.setenv(
        "LCSP_AGENT_RUNTIME_SERVER_COMMAND",
        "python -m tools.common.capabilities.agent_runtime.local_server "
        "--db $LANGGRAPH_CHECKPOINT_DATABASE_URL",
    )

    with pytest.raises(RuntimeError, match="unexpanded environment"):
        entrypoint._agent_server_command()


def test_langsmith_hardening_preserves_langgraph_license_keys() -> None:
    env = {
        "LANGSMITH_API_KEY": "trace-secret",
        "LANGCHAIN_API_KEY": "trace-secret",
        "LANGGRAPH_CLOUD_LICENSE_KEY": "license",
        "LANGGRAPH_ENTERPRISE_LICENSE_KEY": "enterprise-license",
    }

    entrypoint._harden_langsmith_env(env)

    assert "LANGSMITH_API_KEY" not in env
    assert "LANGCHAIN_API_KEY" not in env
    assert env["LANGGRAPH_CLOUD_LICENSE_KEY"] == "license"
    assert env["LANGGRAPH_ENTERPRISE_LICENSE_KEY"] == "enterprise-license"
    assert env["LANGSMITH_TRACING"] == "false"


def test_sandbox_reaper_settings_default_to_startup_and_periodic_cleanup() -> None:
    enabled, ttl_seconds, interval_seconds = entrypoint._sandbox_reaper_settings({})

    assert enabled is True
    assert ttl_seconds == entrypoint.DEFAULT_SANDBOX_TTL_SECONDS
    assert interval_seconds == entrypoint.DEFAULT_SANDBOX_REAPER_INTERVAL_SECONDS


def test_sandbox_reaper_invokes_docker_cleanup(monkeypatch) -> None:
    calls = []

    class FakeManager:
        def cleanup_stale(self, *, max_age_seconds: int):
            calls.append(max_age_seconds)
            return ["lcsp-repository-sandbox-old"]

    monkeypatch.setattr(entrypoint, "DockerSandboxManager", lambda: FakeManager())

    assert entrypoint._cleanup_stale_sandboxes(123) == [
        "lcsp-repository-sandbox-old"
    ]
    assert calls == [123]


def test_local_agent_server_requires_checkpoint_database_in_production(
    monkeypatch,
) -> None:
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_MODE", "production")
    monkeypatch.delenv("LANGGRAPH_CHECKPOINT_DATABASE_URL", raising=False)
    monkeypatch.delenv("POSTGRES_URI", raising=False)

    with pytest.raises(RuntimeError, match="LANGGRAPH_CHECKPOINT_DATABASE_URL"):
        local_server.LocalAgentRuntime()._open_checkpointer()


def test_local_agent_server_config_merges_sdk_context_for_sandbox_resolution() -> None:
    config = local_server._runtime_config(
        "thread-1",
        {"configurable": {"existing": "value"}},
        {"lcsp_boundary_name": "RepositoryAnalysisBoundary"},
        {
            "assessment_id": "assessment-1",
            "snapshot_id": "snapshot-1",
            "scan_job_id": "scan-1",
            "repository_path": "/",
            "system_event": {"snapshotId": "snapshot-1"},
        },
    )

    assert config["configurable"]["thread_id"] == "thread-1"
    assert config["configurable"]["existing"] == "value"
    assert config["configurable"]["assessment_id"] == "assessment-1"
    assert config["configurable"]["snapshot_id"] == "snapshot-1"
    assert config["configurable"]["scan_job_id"] == "scan-1"
    assert config["configurable"]["cwd"] == "/workspace/repository"
    assert "system_event" not in config["configurable"]
    assert config["metadata"]["lcsp_boundary_name"] == "RepositoryAnalysisBoundary"


def test_local_agent_runtime_close_drains_runs_before_checkpointer_shutdown() -> None:
    order: list[object] = []

    class FakeExecutor:
        def shutdown(self, *, wait: bool, cancel_futures: bool) -> None:
            order.append(("executor", wait, cancel_futures))

    class FakeCheckpointerContext:
        def __exit__(self, *_args) -> None:
            order.append("checkpointer")

    runtime = local_server.LocalAgentRuntime()
    runtime._executor = FakeExecutor()  # type: ignore[assignment]
    runtime._checkpointer_context = FakeCheckpointerContext()
    runtime._checkpointer = object()

    runtime.close()

    assert order == [("executor", True, True), "checkpointer"]
    assert runtime._checkpointer_context is None
    assert runtime._checkpointer is None
