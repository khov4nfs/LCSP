from __future__ import annotations

import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, call

import pytest
from deepagents.backends.protocol import LsResult, WriteResult
from tools.common.capabilities.agent_runtime import agent_server_client
from tools.common.capabilities.platform import docker_sandbox
from tools.common.capabilities.platform import repository_sandbox


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_scan_job_reuses_thread_only_for_same_scan_delivery() -> None:
    scan = agent_server_client.agent_thread_id(
        "scan_requested",
        {"assessmentId": "assessment-1", "scanJobId": "scan-1"},
        "corr-scan",
    )
    redelivery = agent_server_client.agent_thread_id(
        "scan_requested",
        {"assessmentId": "assessment-1", "scanJobId": "scan-1"},
        "corr-redelivery",
    )
    rerun = agent_server_client.agent_thread_id(
        "scan_requested",
        {"assessmentId": "assessment-1", "scanJobId": "scan-2"},
        "corr-rerun",
    )
    assessment = agent_server_client.agent_thread_id(
        "engineering_assessment_requested",
        {"assessmentId": "assessment-1", "workflowRunId": "workflow-2"},
        "corr-assessment",
    )
    other = agent_server_client.agent_thread_id(
        "scan_requested",
        {"assessmentId": "assessment-2", "scanJobId": "scan-9"},
        "corr-other",
    )

    assert scan == redelivery
    assert scan != rerun
    assert scan != assessment
    assert scan != other


def test_agent_server_dispatch_reuses_thread_and_keeps_event_out_of_prompt(monkeypatch) -> None:
    fake_client = MagicMock()
    fake_client.runs.create.return_value = {"run_id": "run-1", "status": "pending"}
    fake_client.runs.get.side_effect = [
        {"run_id": "run-1", "status": "running"},
        {"run_id": "run-1", "status": "success"},
    ]
    fake_client.threads.get_state.return_value = {"values": {"ok": True}}
    monkeypatch.setattr(agent_server_client, "get_sync_client", lambda **_kwargs: fake_client)
    monkeypatch.setattr(agent_server_client.time, "sleep", lambda _seconds: None)

    event = {
        "assessmentId": "assessment-1",
        "scanJobId": "scan-1",
        "snapshotId": "snapshot-1",
        "commitSha": "abc123",
        "secretInternalField": "must-not-be-copied-to-model-message",
    }
    result = agent_server_client.dispatch_agent_runtime_event(
        "scan_requested",
        event,
        "corr-1",
    )

    assert result == {"ok": True}
    thread_id = agent_server_client.agent_thread_id("scan_requested", event, "corr-1")
    fake_client.threads.create.assert_called_once()
    assert fake_client.threads.create.call_args.kwargs["thread_id"] == thread_id
    assert fake_client.threads.create.call_args.kwargs["if_exists"] == "do_nothing"

    create = fake_client.runs.create.call_args
    assert create.args[:2] == (thread_id, "lcsp-agent")
    assert create.kwargs["context"]["system_event"] == event
    assert "config" not in create.kwargs
    assert create.kwargs["context"]["thread_id"] == thread_id
    assert create.kwargs["context"]["snapshot_id"] == "snapshot-1"
    assert create.kwargs["context"]["repository_path"] == "/"
    prompt = create.kwargs["input"]["messages"][0]["content"]
    assert "secretInternalField" not in prompt
    assert "trusted lcsp system event" in prompt.lower()
    assert create.kwargs["multitask_strategy"] == "enqueue"
    assert fake_client.runs.get.call_count == 2


def test_agent_server_scan_observer_persists_scheduler_progress(monkeypatch) -> None:
    posted = []

    class FakeConfig:
        nestjs_api_base_url = "http://api.local"
        worker_api_key = "worker-key"

    class FakeClient:
        def __init__(self, base_url, api_key):
            assert base_url == "http://api.local"
            assert api_key == "worker-key"

        def post_scan_runtime_event(self, scan_job_id, payload):
            posted.append((scan_job_id, payload))

    monkeypatch.setattr(agent_server_client, "load_config", lambda: FakeConfig())
    monkeypatch.setattr(agent_server_client, "WorkerApiClient", FakeClient)

    observer = agent_server_client._ScanRunObserver(
        {"scanJobId": "scan-1", "assessmentId": "assessment-1"}
    )
    observer.emit(
        event_type="TOOL_STARTED",
        run_status="RUNNING",
        summary="LangGraph repository run queued",
        output_summary={"runId": "run-1", "schedulerState": "pending"},
    )

    assert posted == [
        (
            "scan-1",
            {
                "event_type": "TOOL_STARTED",
                "run_status": "RUNNING",
                "stage": "SCAN",
                "tool_name": "langgraph_run",
                "summary": "LangGraph repository run queued",
                "output_summary": {
                    "runId": "run-1",
                    "schedulerState": "pending",
                    "runtimeRunId": "run-1",
                },
            },
        )
    ]


def test_agent_server_dispatch_raises_terminal_error_from_run_state(monkeypatch) -> None:
    fake_client = MagicMock()
    fake_client.runs.create.return_value = {"run_id": "run-1", "status": "pending"}
    fake_client.runs.get.return_value = {"run_id": "run-1", "status": "error"}
    fake_client.threads.get_state.return_value = {
        "error": {
            "error": "RuntimeError",
            "message": "Remote run failed",
        }
    }
    monkeypatch.setattr(agent_server_client, "get_sync_client", lambda **_kwargs: fake_client)
    monkeypatch.setattr(agent_server_client.time, "sleep", lambda _seconds: None)

    with pytest.raises(agent_server_client.AgentServerRunError) as captured:
        agent_server_client.dispatch_agent_runtime_event(
            "scan_requested",
            {"assessmentId": "assessment-1", "scanJobId": "scan-1"},
            "corr-1",
        )

    assert captured.value.remote_error_type == "RuntimeError"
    assert "Remote run failed" in str(captured.value)
    create = fake_client.runs.create.call_args



def test_agent_server_dispatch_cancels_run_at_boundary_deadline(monkeypatch) -> None:
    fake_client = MagicMock()
    fake_client.runs.create.return_value = {"run_id": "run-timeout", "status": "pending"}
    fake_client.runs.get.return_value = {"run_id": "run-timeout", "status": "pending"}
    monkeypatch.setattr(agent_server_client, "get_sync_client", lambda **_kwargs: fake_client)
    monotonic_values = iter([0.0, 0.0, 0.0, 2.0])
    monkeypatch.setattr(
        agent_server_client.time,
        "monotonic",
        lambda: next(monotonic_values),
    )
    monkeypatch.setattr(agent_server_client.time, "sleep", lambda _seconds: None)

    with pytest.raises(agent_server_client.AgentServerRunError) as captured:
        agent_server_client.dispatch_agent_runtime_event(
            "scan_requested",
            {"assessmentId": "assessment-1", "scanJobId": "scan-1"},
            "corr-timeout",
            timeout_seconds=1.0,
        )

    assert captured.value.remote_error_type == "AgentServerRunTimeout"
    fake_client.runs.cancel.assert_called_once_with(
        agent_server_client.agent_thread_id(
            "scan_requested",
            {"assessmentId": "assessment-1", "scanJobId": "scan-1"},
            "corr-timeout",
        ),
        "run-timeout",
        wait=False,
        action="interrupt",
    )


def test_reconcile_stale_agent_runs_interrupts_only_runs_before_current_server(monkeypatch) -> None:
    fake_client = MagicMock()
    fake_client.threads.search.return_value = [
        {"thread_id": "thread-1"},
        {"thread_id": "thread-2"},
    ]
    fake_client.runs.list.side_effect = [
        [
            {
                "run_id": "old-running",
                "status": "running",
                "created_at": "2026-09-24T16:00:00+00:00",
            },
            {
                "run_id": "current-pending",
                "status": "pending",
                "created_at": "2026-09-24T16:31:00+00:00",
            },
        ],
        [
            {
                "run_id": "old-pending",
                "status": "pending",
                "created_at": "2026-09-24T15:59:59Z",
            },
            {
                "run_id": "completed",
                "status": "success",
                "created_at": "2026-09-24T15:00:00Z",
            },
        ],
    ]
    response = SimpleNamespace(
        text="process_start_time_seconds 1790267377.79\n",
        raise_for_status=lambda: None,
    )
    monkeypatch.setattr(agent_server_client.httpx, "get", lambda *_args, **_kwargs: response)
    monkeypatch.setattr(agent_server_client, "get_sync_client", lambda **_kwargs: fake_client)

    cancelled = agent_server_client.reconcile_stale_agent_runs(
        server_url="http://127.0.0.1:2024"
    )

    assert cancelled == 2
    assert fake_client.runs.cancel.call_args_list == [
        call("thread-1", "old-running", wait=False, action="interrupt"),
        call("thread-2", "old-pending", wait=False, action="interrupt"),
    ]



def test_repository_backend_activation_is_scoped_to_repository_database() -> None:
    backend = object()

    assert repository_sandbox.current_repository_backend() is None
    with repository_sandbox.activate_repository_backend(backend):
        active = repository_sandbox.current_repository_backend()
        assert isinstance(active, repository_sandbox.AssessmentRepositoryBackend)
        assert active._backend is backend
    assert repository_sandbox.current_repository_backend() is None


def test_runtime_backend_mirrors_native_skills_before_first_read(monkeypatch) -> None:
    writes = []
    raw = MagicMock()
    raw.id = "sandbox-1"
    raw.write.side_effect = lambda path, content: writes.append(
        (path, content)
    ) or WriteResult(path=path)
    raw.ls.return_value = LsResult(entries=[])

    monkeypatch.setattr(
        repository_sandbox,
        "resolve_repository_thread_backend",
        lambda config: raw,
    )
    monkeypatch.setattr(
        repository_sandbox,
        "get_config",
        lambda: {"configurable": {"thread_id": "thread-1"}},
    )

    backend = repository_sandbox.RuntimeRepositoryBackend()
    backend.ls(repository_sandbox.REPOSITORY_SKILLS)

    assert any(
        path == f"{repository_sandbox.REPOSITORY_SKILLS}/lcsp/SKILL.md"
        and "name: lcsp" in content
        for path, content in writes
    )
    raw.ls.assert_called_once_with(repository_sandbox.REPOSITORY_SKILLS)


def test_repository_virtualization_accepts_native_sandbox_repository_paths() -> None:
    raw = MagicMock()
    raw.id = "sandbox-1"
    raw.ls.return_value = LsResult(entries=[])

    backend = repository_sandbox.repository_database_backend(raw)
    backend.ls(repository_sandbox.REPOSITORY_SKILLS)

    raw.ls.assert_called_once_with(repository_sandbox.REPOSITORY_SKILLS)


def test_docker_sandbox_manager_uses_deterministic_secure_container() -> None:
    calls = []

    def runner(args, input_bytes, timeout):
        calls.append((list(args), input_bytes, timeout))
        if args[1] == "inspect":
            return subprocess.CompletedProcess(args, 1, b"", b"missing")
        return subprocess.CompletedProcess(args, 0, b"container-id", b"")

    manager = docker_sandbox.DockerSandboxManager(runner=runner)
    backend = manager.resolve(
        {
            "configurable": {
                "thread_id": "thread-1",
                "assessment_id": "assessment-1",
                "snapshot_id": "snapshot-1",
                "scan_job_id": "scan-1",
                "commit_sha": "abc123",
            }
        }
    )

    assert backend.id == "lcsp-repository-sandbox-4b0a5fefc328e6b9257bc535"
    run_args = calls[1][0]
    assert run_args[:4] == ["docker", "run", "-d", "--name"]
    assert "--privileged" not in run_args
    assert "/var/run/docker.sock" not in " ".join(run_args)
    assert ["--security-opt", "no-new-privileges"] == run_args[
        run_args.index("--security-opt") : run_args.index("--security-opt") + 2
    ]
    assert ["--cap-drop", "ALL"] == run_args[
        run_args.index("--cap-drop") : run_args.index("--cap-drop") + 2
    ]
    assert ["--network", "none"] == run_args[
        run_args.index("--network") : run_args.index("--network") + 2
    ]
    assert ["--user", "1000:1000"] == run_args[
        run_args.index("--user") : run_args.index("--user") + 2
    ]


def test_codebase_memory_is_baked_into_docker_sandbox_without_host_graph_state() -> None:
    setup = (PROJECT_ROOT / "sandbox" / "setup.sh").read_text(encoding="utf-8")

    assert 'CODEBASE_MEMORY_VERSION="0.11.0"' in setup
    assert 'codebase-memory-mcp==${CODEBASE_MEMORY_VERSION}' in setup
    assert "/usr/local/libexec/codebase-memory-mcp" in setup
    assert "/usr/local/bin/codebase-memory-graph" in setup
    assert 'CBM_CACHE_DIR="${CBM_CACHE_DIR:-${HOME:-/tmp}/.cache/codebase-memory-mcp}"' in setup
    assert "/workspace/repository/.codebase-memory" not in setup
    # Sandbox image creation must not start the CBM daemon or build a project graph.
    assert "cli list_projects" not in setup
    assert "cli index_repository" not in setup


def test_system_event_middleware_dispatches_inside_resolved_docker_backend(monkeypatch) -> None:
    import middleware.system_event_dispatch as system_dispatch
    from orchestration.context import LCSPRunContext

    backend = object()
    event = {
        "assessmentId": "assessment-1",
        "scanJobId": "scan-1",
        "snapshotId": "snapshot-1",
    }
    calls = []
    monkeypatch.setattr(
        system_dispatch,
        "resolve_repository_thread_backend",
        lambda config: calls.append(("resolve", config)) or backend,
    )
    monkeypatch.setattr(
        system_dispatch,
        "ensure_repository_for_event",
        lambda resolved, boundary, payload, lifecycle=None: calls.append(
            ("hydrate", resolved, boundary, payload)
        ),
    )
    monkeypatch.setattr(system_dispatch, "_worker_client", lambda: None)

    def invoke(boundary, payload, correlation_id):
        active = repository_sandbox.current_repository_backend()
        assert isinstance(active, repository_sandbox.AssessmentRepositoryBackend)
        assert active._backend is backend
        calls.append(("invoke", boundary, payload, correlation_id))

    monkeypatch.setattr(system_dispatch, "invoke_boundary", invoke)
    runtime = SimpleNamespace(
        context=LCSPRunContext(
            assessment_id="assessment-1",
            correlation_id="corr-1",
            system_boundary_name="scan_requested",
            system_event=event,
        ),
        config={"configurable": {"thread_id": "thread-1"}},
    )

    result = system_dispatch.dispatch_agent_runtime_system_event.before_agent({}, runtime)

    assert result == {"jump_to": "end"}
    assert calls == [
        ("resolve", runtime.config),
        ("hydrate", backend, "scan_requested", event),
        ("invoke", "scan_requested", event, "corr-1"),
    ]
    assert repository_sandbox.current_repository_backend() is None


def test_system_event_middleware_fails_scan_when_repository_hydration_crashes(
    monkeypatch,
) -> None:
    import middleware.system_event_dispatch as system_dispatch
    from orchestration.context import LCSPRunContext

    backend = object()
    event = {
        "assessmentId": "assessment-1",
        "scanJobId": "scan-1",
        "snapshotId": "snapshot-1",
    }
    calls = []

    class FakeClient:
        def __init__(self) -> None:
            self.runtime_events = []
            self.callbacks = []

        def post_scan_runtime_event(self, scan_job_id, payload):
            self.runtime_events.append((scan_job_id, payload))

        def post_scan_callback(self, scan_job_id, payload):
            self.callbacks.append((scan_job_id, payload))

    client = FakeClient()
    monkeypatch.setattr(
        system_dispatch,
        "resolve_repository_thread_backend",
        lambda config: calls.append(("resolve", config)) or backend,
    )

    def fail_hydration(resolved, boundary, payload, lifecycle=None):
        calls.append(("hydrate", resolved, boundary, payload))
        assert lifecycle is not None
        lifecycle("repository_archive_downloading")
        lifecycle("repository_sandbox_hydrating")
        raise OSError(7, "Argument list too long", "docker")

    monkeypatch.setattr(
        system_dispatch,
        "ensure_repository_for_event",
        fail_hydration,
    )
    monkeypatch.setattr(system_dispatch, "_worker_client", lambda: client)
    monkeypatch.setattr(
        system_dispatch,
        "invoke_boundary",
        lambda *_args, **_kwargs: calls.append(("invoke",)),
    )
    runtime = SimpleNamespace(
        context=LCSPRunContext(
            assessment_id="assessment-1",
            correlation_id="corr-1",
            system_boundary_name="scan_requested",
            system_event=event,
        ),
        config={"configurable": {"thread_id": "thread-1"}},
    )

    with pytest.raises(OSError):
        system_dispatch.dispatch_agent_runtime_system_event.before_agent({}, runtime)

    assert calls == [
        ("resolve", runtime.config),
        ("hydrate", backend, "scan_requested", event),
    ]
    assert [payload["event_type"] for _, payload in client.runtime_events] == [
        "RUN_STARTED",
        "TOOL_STARTED",
        "TOOL_STARTED",
        "TOOL_FAILED",
        "RUN_FAILED",
    ]
    assert client.runtime_events[-1][1]["output_summary"] == {
        "errorCode": "REPOSITORY_SANDBOX_HYDRATION_FAILED"
    }
    assert len(client.callbacks) == 1
    scan_job_id, callback = client.callbacks[0]
    assert scan_job_id == "scan-1"
    assert callback.status == "FAILED"
    assert callback.error_code == "REPOSITORY_SANDBOX_HYDRATION_FAILED"
    assert callback.privacy_flags["containsSourceCode"] is False
    assert repository_sandbox.current_repository_backend() is None



def test_repository_database_backend_virtualizes_repo_as_agent_root() -> None:
    from deepagents.backends.protocol import (
        ExecuteResponse,
        FileDownloadResponse,
        FileUploadResponse,
        GlobResult,
        GrepResult,
        LsResult,
        WriteResult,
    )

    raw = MagicMock()
    raw.id = "sandbox-1"
    raw.ls.return_value = LsResult(
        entries=[{"path": "/workspace/repository/src/app.py", "is_dir": False}]
    )
    raw.glob.return_value = GlobResult(
        matches=[{"path": "/workspace/repository/src/app.py", "is_dir": False}]
    )
    raw.grep.return_value = GrepResult(
        matches=[{"path": "/workspace/repository/src/app.py", "line": 1, "text": "hello"}]
    )
    raw.write.return_value = WriteResult(path="/workspace/repository/.lcsp/agent/note.md")
    raw.upload_files.return_value = [
        FileUploadResponse(path="/workspace/repository/tmp/data.bin")
    ]
    raw.download_files.return_value = [
        FileDownloadResponse(
            path="/workspace/repository/src/app.py",
            content=b"print('ok')",
        )
    ]
    raw.execute.return_value = ExecuteResponse(output="ok", exit_code=0)

    backend = repository_sandbox.repository_database_backend(raw)

    assert backend.ls("/").entries == [{"path": "/src/app.py", "is_dir": False}]
    assert backend.glob("*.py", "/").matches == [
        {"path": "/src/app.py", "is_dir": False}
    ]
    assert backend.grep("hello", "/").matches == [
        {"path": "/src/app.py", "line": 1, "text": "hello"}
    ]
    assert backend.write("/.lcsp/agent/note.md", "note").path == "/.lcsp/agent/note.md"
    assert backend.upload_files([("/tmp/data.bin", b"x")])[0].path == "/tmp/data.bin"
    assert backend.download_files(["/src/app.py"])[0].content == b"print('ok')"

    backend.execute("git status --short")

    raw.ls.assert_called_once_with("/workspace/repository")
    raw.glob.assert_called_once_with("*.py", "/workspace/repository")
    raw.grep.assert_called_once_with("hello", "/workspace/repository", None)
    raw.write.assert_called_once_with(
        "/workspace/repository/.lcsp/agent/note.md",
        "note",
    )
    raw.execute.assert_called_once_with(
        "cd /workspace/repository && git status --short"
    )


def test_repository_database_metadata_lives_inside_repo_and_agent_state_is_reserved() -> None:
    assert repository_sandbox.REPOSITORY_META.startswith(
        repository_sandbox.REPOSITORY_ROOT + "/.lcsp/"
    )
    assert repository_sandbox.REPOSITORY_AGENT_STATE.startswith(
        repository_sandbox.REPOSITORY_ROOT + "/.lcsp/"
    )


def test_repository_database_bootstraps_a_git_baseline() -> None:
    source = (
        PROJECT_ROOT / "tools/common/capabilities/platform/repository_sandbox.py"
    ).read_text(encoding="utf-8")

    assert "git -C {repository} init -q" in source
    assert "--git-dir={repository}/.git --work-tree={repository}" in source
    assert " add -A" in source
    assert "LCSP baseline " in source
    assert ".lcsp/" in source


def test_repository_hydration_clears_mount_contents_not_mountpoint() -> None:
    bootstrap = repository_sandbox._repository_hydration_bootstrap("abc123")

    assert f"rm -rf {repository_sandbox.REPOSITORY_ROOT}" not in bootstrap
    assert (
        f"find {repository_sandbox.REPOSITORY_ROOT} -mindepth 1 -maxdepth 1 "
        "-exec rm -rf -- {} +"
    ) in bootstrap
    assert (
        "tar -xzf /tmp/lcsp-assessment-repository.tar.gz "
        f"-C {repository_sandbox.REPOSITORY_ROOT}"
    ) in bootstrap
