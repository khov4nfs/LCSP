from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from tools.graph.scanner.tools.syft_tool import SyftTool
from tools.graph.scanner.tools.tool_base import (
    OUTCOME_SUCCESS,
    OUTCOME_TOOL_FAILURE,
    OUTCOME_TOOL_TIMEOUT,
)


def _completed(args: list[str], returncode: int, stdout: str = "", stderr: str = "") -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(args=args, returncode=returncode, stdout=stdout, stderr=stderr)


@pytest.mark.p0
def test_syft_tool_returns_entries_for_workspace_with_packages(
    workspace_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_path = workspace_dir / "syft-config.yaml"
    config_path.write_text("output:\n  format: json\n", encoding="utf-8")

    workspace = workspace_dir / "repo"
    workspace.mkdir()

    payload = {
        "artifacts": [
            {
                "name": "openai",
                "version": "1.59.3",
                "purl": "pkg:pypi/openai@1.59.3",
                "locations": [{"path": str(workspace / "requirements.txt")}],
                "licenses": [{"spdxExpression": "MIT"}],
            }
        ]
    }

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="Application: syft v1.0.0\n")
        return _completed(command, 0, stdout=json.dumps(payload))

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = SyftTool(config_path=config_path, pinned_version="v1.0.0").run(workspace)

    assert result.execution.outcome == OUTCOME_SUCCESS
    assert len(result.entries) == 1
    assert result.entries[0].name == "openai"
    assert result.entries[0].ecosystem == "pypi"


@pytest.mark.p0
def test_syft_tool_returns_empty_list_when_no_packages(
    workspace_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_path = workspace_dir / "syft-config.yaml"
    config_path.write_text("output:\n  format: json\n", encoding="utf-8")

    workspace = workspace_dir / "repo"
    workspace.mkdir()

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="Application: syft v1.0.0\n")
        return _completed(command, 0, stdout=json.dumps({"artifacts": []}))

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = SyftTool(config_path=config_path, pinned_version="v1.0.0").run(workspace)

    assert result.execution.outcome == OUTCOME_SUCCESS
    assert result.entries == []


@pytest.mark.p0
def test_syft_tool_accepts_the_supported_v1_release_line(
    workspace_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_path = workspace_dir / "syft-config.yaml"
    config_path.write_text("output:\n  format: json\n", encoding="utf-8")

    workspace = workspace_dir / "repo"
    workspace.mkdir()

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="syft 1.50.0\n")
        return _completed(command, 0, stdout=json.dumps({"artifacts": []}))

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = SyftTool(config_path=config_path).run(workspace)

    assert result.execution.outcome == OUTCOME_SUCCESS
    assert result.execution.tool_version == "syft 1.50.0"


@pytest.mark.p0
def test_syft_tool_non_zero_exit_is_non_blocking_failure(
    workspace_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_path = workspace_dir / "syft-config.yaml"
    config_path.write_text("output:\n  format: json\n", encoding="utf-8")

    workspace = workspace_dir / "repo"
    workspace.mkdir()

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="Application: syft v1.0.0\n")
        return _completed(command, 2, stderr="failed to scan")

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = SyftTool(config_path=config_path, pinned_version="v1.0.0").run(workspace)

    assert result.execution.outcome == OUTCOME_TOOL_FAILURE
    assert result.entries == []


@pytest.mark.p0
def test_syft_tool_timeout_is_reported(
    workspace_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_path = workspace_dir / "syft-config.yaml"
    config_path.write_text("output:\n  format: json\n", encoding="utf-8")

    workspace = workspace_dir / "repo"
    workspace.mkdir()

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="Application: syft v1.0.0\n")
        raise subprocess.TimeoutExpired(cmd=command, timeout=120)

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = SyftTool(config_path=config_path, pinned_version="v1.0.0").run(workspace)

    assert result.execution.outcome == OUTCOME_TOOL_TIMEOUT
    assert result.entries == []


@pytest.mark.p0
def test_syft_tool_records_config_hash(
    workspace_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_path = workspace_dir / "syft-config.yaml"
    config_path.write_text("source:\n  name: dir\n", encoding="utf-8")

    workspace = workspace_dir / "repo"
    workspace.mkdir()

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="Application: syft v1.0.0\n")
        return _completed(command, 0, stdout=json.dumps({"artifacts": []}))

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = SyftTool(config_path=config_path, pinned_version="v1.0.0").run(workspace)

    assert result.execution.config_hash.startswith("sha256:")
    assert len(result.execution.config_hash) == 71


@pytest.mark.p0
def test_syft_tool_normalizes_locations_to_relative_paths(
    workspace_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_path = workspace_dir / "syft-config.yaml"
    config_path.write_text("output:\n  format: json\n", encoding="utf-8")

    workspace = workspace_dir / "repo"
    workspace.mkdir()

    payload = {
        "artifacts": [
            {
                "name": "requests",
                "version": "2.32.3",
                "purl": "pkg:pypi/requests@2.32.3",
                "locations": [{"path": str(workspace / "requirements.txt")}],
                "licenses": ["Apache-2.0"],
            }
        ]
    }

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="Application: syft v1.0.0\n")
        return _completed(command, 0, stdout=json.dumps(payload))

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = SyftTool(config_path=config_path, pinned_version="v1.0.0").run(workspace)

    assert result.execution.outcome == OUTCOME_SUCCESS
    assert len(result.entries) == 1
    assert not Path(result.entries[0].location).is_absolute()


@pytest.mark.p0
def test_syft_tool_output_contains_package_metadata_not_source_code(
    workspace_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_path = workspace_dir / "syft-config.yaml"
    config_path.write_text("output:\n  format: json\n", encoding="utf-8")

    workspace = workspace_dir / "repo"
    workspace.mkdir()

    payload = {
        "artifacts": [
            {
                "name": "anthropic",
                "version": "0.42.0",
                "purl": "pkg:pypi/anthropic@0.42.0",
                "locations": [{"path": str(workspace / "pyproject.toml")}],
                "licenses": ["MIT"],
                "metadata": {
                    "sourceSnippet": "def should_not_appear(): pass"
                },
            }
        ]
    }

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="Application: syft v1.0.0\n")
        return _completed(command, 0, stdout=json.dumps(payload))

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = SyftTool(config_path=config_path, pinned_version="v1.0.0").run(workspace)

    assert result.execution.outcome == OUTCOME_SUCCESS
    assert len(result.entries) == 1
    entry_text = json.dumps(result.entries[0].__dict__)
    assert "def " not in entry_text
    assert "function " not in entry_text
