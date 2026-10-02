from __future__ import annotations

import json
import subprocess

from tools.common.capabilities.platform.docker_sandbox import (
    DockerSandboxBackend,
    DockerSandboxManager,
    DockerSandboxSpec,
    REPOSITORY_ROOT,
    RUNTIME_ROOT,
    _sandbox_path,
    sandbox_spec_from_config,
)


def test_sandbox_spec_uses_thread_id_for_collision_safe_container_name() -> None:
    spec = sandbox_spec_from_config(
        {"configurable": {"thread_id": "assessment-thread-1"}}
    )

    assert spec.container_name.startswith("lcsp-repository-sandbox-")
    assert spec.container_name == DockerSandboxSpec("assessment-thread-1").container_name
    assert spec.container_name != DockerSandboxSpec("assessment-thread-2").container_name


def test_docker_run_does_not_expose_privileged_host_surfaces() -> None:
    calls = []

    def runner(args, input_bytes, timeout):
        calls.append(list(args))
        if args[1] == "inspect":
            return subprocess.CompletedProcess(args, 1, b"", b"missing")
        return subprocess.CompletedProcess(args, 0, b"container-id", b"")

    backend = DockerSandboxBackend(DockerSandboxSpec("thread-1"), runner=runner)
    backend.ensure_running()

    run_args = calls[1]
    rendered = " ".join(run_args)
    assert "--privileged" not in run_args
    assert "/var/run/docker.sock" not in rendered
    assert "--network none" in rendered
    assert "--security-opt no-new-privileges" in rendered
    assert "--cap-drop ALL" in rendered
    assert "--user 1000:1000" in rendered
    assert "HOME=/workspace/runtime/home" in rendered
    assert "XDG_CACHE_HOME=/workspace/runtime/cache" in rendered
    assert "CBM_CACHE_DIR=/workspace/runtime/codebase-memory" in rendered
    assert "--pids-limit 512" in rendered
    assert "--entrypoint bash" in rendered
    assert "/workspace/repository" in rendered
    assert "/workspace/runtime" in rendered


def test_sandbox_path_virtualizes_repository_root() -> None:
    assert _sandbox_path("/") == REPOSITORY_ROOT
    assert _sandbox_path("src/app.py") == f"{REPOSITORY_ROOT}/src/app.py"
    assert _sandbox_path("/src/app.py") == f"{REPOSITORY_ROOT}/src/app.py"
    assert _sandbox_path("/workspace/repository/src/app.py") == (
        f"{REPOSITORY_ROOT}/src/app.py"
    )
    assert _sandbox_path("/workspace/runtime/state.json") == (
        f"{RUNTIME_ROOT}/state.json"
    )
    assert _sandbox_path("/tmp/probe") == "/tmp/probe"


def test_docker_runner_filters_forbidden_secret_environment(monkeypatch) -> None:
    captured = {}

    def fake_run(args, **kwargs):
        captured["env"] = kwargs["env"]
        return subprocess.CompletedProcess(args, 0, b"[]", b"")

    from tools.common.capabilities.platform import docker_sandbox

    monkeypatch.setattr(docker_sandbox.subprocess, "run", fake_run)
    monkeypatch.setenv("OPENAI_API_KEY", "secret")
    monkeypatch.setenv("DATABASE_URL", "postgres://secret")
    monkeypatch.setenv("LCSP_ALLOWED_FOR_TEST", "ok")

    docker_sandbox._run_docker(["docker", "inspect", "x"], None, 1)

    assert captured["env"]["LCSP_ALLOWED_FOR_TEST"] == "ok"
    assert "OPENAI_API_KEY" not in captured["env"]
    assert "DATABASE_URL" not in captured["env"]


def test_delete_allows_repository_workspace_paths() -> None:
    calls = []

    def runner(args, input_bytes, timeout):
        calls.append(list(args))
        if args[1] == "inspect":
            return subprocess.CompletedProcess(
                args,
                0,
                b'[{"State":{"Running":true}}]',
                b"",
            )
        return subprocess.CompletedProcess(args, 0, b"", b"")

    backend = DockerSandboxBackend(DockerSandboxSpec("thread-1"), runner=runner)
    result = backend.delete("/workspace/repository/generated.txt")

    assert result.error is None
    assert any(
        "rm -rf -- /workspace/repository/generated.txt" in " ".join(call)
        for call in calls
    )


def test_upload_files_streams_content_over_stdin_not_command_arguments() -> None:
    calls = []
    content = b"repository archive bytes" * 10_000

    def runner(args, input_bytes, timeout):
        calls.append((list(args), input_bytes, timeout))
        if args[1] == "inspect":
            return subprocess.CompletedProcess(
                args,
                0,
                b'[{"State":{"Running":true}}]',
                b"",
            )
        return subprocess.CompletedProcess(args, 0, b"", b"")

    backend = DockerSandboxBackend(DockerSandboxSpec("thread-1"), runner=runner)
    result = backend.upload_files(
        [("/tmp/lcsp-assessment-repository.tar.gz", content)]
    )

    assert result[0].error is None
    exec_calls = [call for call in calls if call[0][1] == "exec"]
    assert len(exec_calls) == 1
    exec_args, input_bytes, timeout = exec_calls[0]
    rendered = " ".join(exec_args)
    assert "-i" in exec_args
    assert input_bytes == content
    assert timeout is not None
    assert "/tmp/lcsp-assessment-repository.tar.gz" in exec_args
    assert "repository archive bytes" not in rendered
    assert "base64" not in rendered


def test_existing_container_is_recreated_when_static_security_config_drifts() -> None:
    calls = []
    stale_container = {
        "Config": {
            "Image": "old-image",
            "Labels": {
                "lcsp.repository-sandbox": "true",
                "lcsp.thread-id": DockerSandboxSpec("thread-1").safe_thread_hash,
            },
        },
        "HostConfig": {
            "NetworkMode": "bridge",
            "Privileged": False,
            "PidsLimit": 512,
            "Memory": 2147483648,
            "NanoCpus": 2000000000,
            "SecurityOpt": ["no-new-privileges"],
            "CapDrop": ["ALL"],
            "Binds": None,
        },
        "State": {"Running": True},
    }

    def runner(args, input_bytes, timeout):
        calls.append(list(args))
        if args[1] == "inspect":
            return subprocess.CompletedProcess(
                args,
                0,
                json.dumps([stale_container]).encode("utf-8"),
                b"",
            )
        return subprocess.CompletedProcess(args, 0, b"", b"")

    backend = DockerSandboxBackend(DockerSandboxSpec("thread-1"), runner=runner)
    backend.ensure_running()

    rendered = [" ".join(call) for call in calls]
    assert any("docker rm -f" in call for call in rendered)
    assert any("docker run -d" in call for call in rendered)


def test_manager_cleanup_stale_removes_old_lcsp_sandboxes() -> None:
    calls = []

    def runner(args, input_bytes, timeout):
        calls.append(list(args))
        if args[1:5] == [
            "ps",
            "-aq",
            "--filter",
            "label=lcsp.repository-sandbox=true",
        ]:
            return subprocess.CompletedProcess(args, 0, b"container-old\ncontainer-new\n", b"")
        if args[1:3] == ["inspect", "container-old"]:
            return subprocess.CompletedProcess(
                args,
                0,
                json.dumps(
                    [
                        {
                            "Name": "/lcsp-repository-sandbox-old",
                            "Created": "2020-01-01T00:00:00Z",
                        }
                    ]
                ).encode("utf-8"),
                b"",
            )
        if args[1:3] == ["inspect", "container-new"]:
            return subprocess.CompletedProcess(
                args,
                0,
                json.dumps(
                    [
                        {
                            "Name": "/lcsp-repository-sandbox-new",
                            "Created": "2999-01-01T00:00:00Z",
                        }
                    ]
                ).encode("utf-8"),
                b"",
            )
        return subprocess.CompletedProcess(args, 0, b"", b"")

    manager = DockerSandboxManager(runner=runner)

    assert manager.cleanup_stale(max_age_seconds=3600) == [
        "lcsp-repository-sandbox-old"
    ]
    assert any(call[1:4] == ["rm", "-f", "container-old"] for call in calls)
    assert not any(call[1:4] == ["rm", "-f", "container-new"] for call in calls)
