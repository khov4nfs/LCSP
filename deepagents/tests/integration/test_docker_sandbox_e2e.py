from __future__ import annotations

import io
import json
import os
import subprocess
import tarfile
from types import SimpleNamespace
from uuid import uuid4

import pytest

from tools.common.capabilities.platform import repository_sandbox
from tools.common.capabilities.platform.docker_sandbox import (
    DockerSandboxBackend,
    DockerSandboxSpec,
)


@pytest.mark.integration
@pytest.mark.e2e
def test_docker_sandbox_executes_repository_tools_without_host_secrets() -> None:
    """Exercise the real LCSP Docker sandbox integration.

    This test is intentionally opt-in for Docker-enabled jobs. It does not mock
    the sandbox backend when enabled.
    """

    if os.environ.get("LCSP_DOCKER_SANDBOX_E2E") != "1":
        pytest.skip("LCSP_DOCKER_SANDBOX_E2E=1 is required for Docker E2E")

    image = os.environ.get("LCSP_REPOSITORY_SANDBOX_IMAGE", "lcsp-agent-runtime:dev")
    inspect = subprocess.run(
        ["docker", "image", "inspect", image],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=30,
    )
    if inspect.returncode != 0:
        pytest.fail(f"Docker sandbox image is missing: {image}")

    thread_id = f"docker-e2e-{uuid4()}"
    backend = DockerSandboxBackend(DockerSandboxSpec(thread_id, image=image))
    try:
        backend.ensure_running()
        backend.write("src/app.py", "print('lcsp sandbox ok')\n")

        listed = backend.ls("/")
        assert listed.error is None
        assert any(entry["path"].endswith("/src") for entry in listed.entries)

        read = backend.read("src/app.py")
        assert read.error is None
        assert read.file_data["content"] == "print('lcsp sandbox ok')\n"

        executed = backend.execute("python src/app.py", timeout=20)
        assert executed.exit_code == 0
        assert "lcsp sandbox ok" in executed.output

        uploaded = backend.upload_files([("notes/result.txt", b"evidence\n")])
        assert uploaded[0].error is None
        downloaded = backend.download_files(["notes/result.txt"])
        assert downloaded[0].error is None
        assert downloaded[0].content == b"evidence\n"

        env_probe = backend.execute("env | sort", timeout=20)
        assert env_probe.exit_code == 0
        assert "OPENAI_API_KEY=" not in env_probe.output
        assert "DATABASE_URL=" not in env_probe.output
    finally:
        backend.cleanup()


@pytest.mark.integration
@pytest.mark.e2e
def test_docker_sandbox_hydrates_repository_snapshot_without_removing_mountpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Exercise real snapshot hydration inside the tmpfs-backed repository mount."""

    if os.environ.get("LCSP_DOCKER_SANDBOX_E2E") != "1":
        pytest.skip("LCSP_DOCKER_SANDBOX_E2E=1 is required for Docker E2E")

    image = os.environ.get("LCSP_REPOSITORY_SANDBOX_IMAGE", "lcsp-agent-runtime:dev")
    inspect = subprocess.run(
        ["docker", "image", "inspect", image],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=30,
    )
    if inspect.returncode != 0:
        pytest.fail(f"Docker sandbox image is missing: {image}")

    archive_requests = 0

    class FakeSnapshotClient:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def download_archive(self, request) -> bytes:
            nonlocal archive_requests
            archive_requests += 1
            assert request.snapshot_id == "snapshot-1"
            assert request.scan_job_id == "scan-1"
            return _fixture_archive()

    monkeypatch.setattr(
        repository_sandbox,
        "load_config",
        lambda: SimpleNamespace(
            nestjs_api_base_url="http://api.local",
            worker_api_key="test-worker-key",
        ),
    )
    monkeypatch.setattr(
        repository_sandbox,
        "RepositorySnapshotClient",
        FakeSnapshotClient,
    )

    backend = DockerSandboxBackend(
        DockerSandboxSpec(f"hydrate-e2e-{uuid4()}", image=image)
    )
    try:
        backend.ensure_running()
        stale = backend.write("stale.txt", "remove me\n")
        assert stale.error is None

        repository_sandbox.hydrate_repository(
            backend,
            snapshot_id="snapshot-1",
            scan_job_id="scan-1",
            commit_sha="abcdef1",
            assessment_id="assessment-1",
            correlation_id="corr-1",
        )
        repository_sandbox.hydrate_repository(
            backend,
            snapshot_id="snapshot-1",
            scan_job_id="scan-1",
            commit_sha="abcdef1",
            assessment_id="assessment-1",
            correlation_id="corr-1",
        )
        assert archive_requests == 1

        stale_read = backend.read("stale.txt")
        assert stale_read.error == "file_not_found"

        app = backend.read("src/app.py")
        assert app.error is None
        assert app.file_data["content"] == "print('hydrated')\n"

        marker = backend.read("/workspace/repository/.lcsp/repository.json")
        assert marker.error is None
        payload = json.loads(marker.file_data["content"])
        assert payload["snapshotId"] == "snapshot-1"
        assert payload["scanJobId"] == "scan-1"
        assert payload["repositoryRoot"] == "/workspace/repository"

        skill = backend.read("/workspace/repository/.lcsp/agent/skills/lcsp/SKILL.md")
        assert skill.error is None
        assert "name: lcsp" in skill.file_data["content"]
        reference = backend.read(
            "/workspace/repository/.lcsp/agent/skills/interview-context/"
            "references/protected-boundaries.md"
        )
        assert reference.error is None

        git_probe = backend.execute(
            "test -d /workspace/repository/.git "
            "&& git --git-dir=/workspace/repository/.git "
            "--work-tree=/workspace/repository rev-parse --is-inside-work-tree",
            timeout=20,
        )
        assert git_probe.exit_code == 0
        assert "true" in git_probe.output
    finally:
        backend.cleanup()


def _fixture_archive() -> bytes:
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        content = b"print('hydrated')\n"
        info = tarfile.TarInfo("repo/src/app.py")
        info.size = len(content)
        archive.addfile(info, io.BytesIO(content))

        reserved = b"must be stripped\n"
        reserved_info = tarfile.TarInfo("repo/.lcsp/repository.json")
        reserved_info.size = len(reserved)
        archive.addfile(reserved_info, io.BytesIO(reserved))
    return output.getvalue()
