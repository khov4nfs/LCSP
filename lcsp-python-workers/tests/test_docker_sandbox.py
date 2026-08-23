from __future__ import annotations

from pathlib import Path

from lcsp_workers.llm.docker_sandbox import (
    DockerSandboxBackend,
    DockerSandboxConfig,
)


def _config(tmp_path: Path) -> DockerSandboxConfig:
    return DockerSandboxConfig(
        image="python:3.14-alpine",
        network="none",
        cpus="1",
        memory="512m",
        timeout_seconds=30,
        output_root=tmp_path,
        workspace_root=None,
        openwiki_root=None,
        scope="workflow-1",
        per_workflow=False,
    )


def test_docker_sandbox_fails_closed_when_docker_missing(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(
        "lcsp_workers.llm.docker_sandbox.shutil.which",
        lambda _: None,
    )

    result = DockerSandboxBackend(_config(tmp_path)).execute("echo unsafe")

    assert result.exit_code == 127
    assert "docker was not found" in result.output


def test_docker_sandbox_upload_download_stays_inside_output_root(tmp_path) -> None:
    backend = DockerSandboxBackend(_config(tmp_path))

    upload = backend.upload_files([("/notes/result.txt", b"ok")])[0]
    download = backend.download_files(["/notes/result.txt"])[0]
    escape = backend.upload_files([("/../escape.txt", b"no")])[0]

    assert upload.error is None
    assert download.content == b"ok"
    assert escape.error == "invalid_path"
