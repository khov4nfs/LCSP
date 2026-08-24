"""MW-scan-py-005: Knip + deptry dependency usage analysis tests."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from tools.graph.scanner.dependencies.dependency_fact import (
    USAGE_MISSING,
    USAGE_TRANSITIVE,
    USAGE_UNUSED,
    USAGE_USED,
)
from tools.graph.scanner.dependencies.dependency_normalizer import DependencyNormalizer
from tools.graph.scanner.tools.deptry_tool import DeptryTool
from tools.graph.scanner.tools.knip_tool import KnipTool
from tools.graph.scanner.tools.syft_tool import SBOMEntry
from tools.graph.scanner.tools.tool_base import (
    OUTCOME_SUCCESS,
    OUTCOME_TOOL_TIMEOUT,
)


def _completed(
    args: list[str],
    returncode: int,
    stdout: str = "",
    stderr: str = "",
) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(
        args=args,
        returncode=returncode,
        stdout=stdout,
        stderr=stderr,
    )


@pytest.mark.p0
def test_t01_knip_detects_js_openai_used_dependency(
    sample_ts_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = {
        "dependencies": {
            "openai": {
                "files": [str(sample_ts_repo / "src" / "ai.ts")],
            }
        },
        "unusedDependencies": [],
    }

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        assert "install" not in command
        if "--version" in command:
            return _completed(command, 0, stdout="5.46.0\n")
        return _completed(command, 0, stdout=json.dumps(payload))

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = KnipTool(pinned_version="5.").run(sample_ts_repo)

    assert result.execution.outcome == OUTCOME_SUCCESS
    assert result.execution.tool_name == "knip"
    assert result.facts[0].package_name == "openai"
    assert result.facts[0].ecosystem == "npm"
    assert result.facts[0].usage_state == USAGE_USED
    assert result.facts[0].is_ai_relevant is True
    assert result.facts[0].file_refs == ["src/ai.ts"]


@pytest.mark.p0
def test_knip_tool_accepts_the_supported_v6_release_line(
    sample_ts_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="6.32.0\n")
        return _completed(command, 0, stdout=json.dumps({}))

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = KnipTool().run(sample_ts_repo)

    assert result.execution.outcome == OUTCOME_SUCCESS
    assert result.execution.tool_version == "6.32.0"


@pytest.mark.p0
def test_knip_runs_from_the_archive_package_manifest_root(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project_root = tmp_path / "repository-archive"
    source_file = project_root / "src" / "ai.ts"
    source_file.parent.mkdir(parents=True)
    source_file.write_text("export const model = 'gpt';\n", encoding="utf-8")
    (project_root / "package.json").write_text("{}\n", encoding="utf-8")

    def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="6.32.0\n")
        assert kwargs["cwd"] == project_root
        return _completed(command, 0, stdout=json.dumps({}))

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = KnipTool().run(tmp_path)

    assert result.execution.outcome == OUTCOME_SUCCESS


@pytest.mark.p0
def test_knip_runs_each_independent_service_package(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service_roots = [tmp_path / "services" / "api", tmp_path / "services" / "worker"]
    for project_root in service_roots:
        source_file = project_root / "src" / "index.ts"
        source_file.parent.mkdir(parents=True)
        source_file.write_text("export {};\n", encoding="utf-8")
        (project_root / "package.json").write_text("{}\n", encoding="utf-8")

    invoked_roots: list[Path] = []

    def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="6.32.0\n")
        invoked_roots.append(kwargs["cwd"])
        return _completed(command, 0, stdout=json.dumps({}))

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = KnipTool().run(tmp_path)

    assert result.execution.outcome == OUTCOME_SUCCESS
    assert invoked_roots == service_roots


@pytest.mark.p0
def test_t02_deptry_marks_torch_unused(
    sample_python_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output = {"unused": [{"module": "torch", "file": "pyproject.toml"}]}

    def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        assert "install" not in command
        if "--version" in command:
            return _completed(command, 0, stdout="0.23.0\n")
        out_path = Path(command[command.index("--json-output") + 1])
        out_path.write_text(json.dumps(output), encoding="utf-8")
        return _completed(command, 0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = DeptryTool(pinned_version="0.").run(sample_python_repo)

    assert result.execution.outcome == OUTCOME_SUCCESS
    assert result.facts[0].package_name == "torch"
    assert result.facts[0].ecosystem == "pypi"
    assert result.facts[0].usage_state == USAGE_UNUSED
    assert result.facts[0].is_ai_relevant is True


@pytest.mark.p0
def test_t03_deptry_marks_langchain_missing(
    sample_python_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output = {"missing": [{"module": "langchain", "file": "src/agent.py"}]}

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="0.23.0\n")
        out_path = Path(command[command.index("--json-output") + 1])
        out_path.write_text(json.dumps(output), encoding="utf-8")
        return _completed(command, 0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = DeptryTool(pinned_version="0.").run(sample_python_repo)

    assert result.facts[0].package_name == "langchain"
    assert result.facts[0].usage_state == USAGE_MISSING
    assert result.facts[0].file_refs == ["src/agent.py"]


@pytest.mark.p0
def test_deptry_runs_each_independent_python_service(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service_roots = [tmp_path / "services" / "api", tmp_path / "workers" / "scan"]
    for project_root in service_roots:
        source_file = project_root / "src" / "main.py"
        source_file.parent.mkdir(parents=True)
        source_file.write_text("print('ok')\n", encoding="utf-8")
        (project_root / "pyproject.toml").write_text("[project]\nname = 'x'\n", encoding="utf-8")

    invoked_roots: list[Path] = []

    def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="0.25.1\n")
        invoked_roots.append(kwargs["cwd"])
        out_path = Path(command[command.index("--json-output") + 1])
        out_path.write_text("{}", encoding="utf-8")
        return _completed(command, 0)

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = DeptryTool().run(tmp_path)

    assert result.execution.outcome == OUTCOME_SUCCESS
    assert invoked_roots == service_roots


@pytest.mark.p0
def test_t04_normalizer_marks_syft_only_package_transitive() -> None:
    packages = DependencyNormalizer().normalize(
        sbom_entries=[
            SBOMEntry(
                name="urllib3",
                version="2.2.1",
                ecosystem="pypi",
                location="poetry.lock",
                purl="pkg:pypi/urllib3@2.2.1",
                license=None,
            )
        ],
        usage_facts=[],
    )

    assert packages[0].name == "urllib3"
    assert packages[0].usage_facts[0].usage_state == USAGE_TRANSITIVE
    assert packages[0].confidence_boost == 0.0


@pytest.mark.p0
def test_t05_knip_timeout_is_non_blocking(
    sample_ts_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="5.46.0\n")
        raise subprocess.TimeoutExpired(cmd=command, timeout=120)

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = KnipTool(pinned_version="5.").run(sample_ts_repo)

    assert result.execution.outcome == OUTCOME_TOOL_TIMEOUT
    assert result.facts == []


@pytest.mark.p0
def test_t06_knip_does_not_create_node_modules(
    sample_ts_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    commands: list[list[str]] = []

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        commands.append(command)
        if "--version" in command:
            return _completed(command, 0, stdout="5.46.0\n")
        return _completed(command, 0, stdout=json.dumps({}))

    monkeypatch.setattr(subprocess, "run", fake_run)

    KnipTool(pinned_version="5.").run(sample_ts_repo)

    assert all("install" not in command for command in commands)
    assert not (sample_ts_repo / "node_modules").exists()


@pytest.mark.p0
def test_knip_can_use_direct_binary_for_container_runtime(
    sample_ts_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    commands: list[list[str]] = []

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        commands.append(command)
        if "--version" in command:
            return _completed(command, 0, stdout="6.0.0\n")
        return _completed(command, 0, stdout=json.dumps({}))

    monkeypatch.setenv("KNIP_BINARY", "/usr/local/bin/knip")
    monkeypatch.setattr(subprocess, "run", fake_run)

    KnipTool().run(sample_ts_repo)

    assert commands[0][0] == "/usr/local/bin/knip"
    assert commands[1][0] == "/usr/local/bin/knip"
    assert all("--no-install" not in command for command in commands)


@pytest.mark.p0
def test_t07_file_refs_are_relative(
    sample_ts_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = {
        "dependencies": {
            "@anthropic-ai/sdk": {
                "files": [str(sample_ts_repo / "src" / "ai.ts")],
            }
        }
    }

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="5.46.0\n")
        return _completed(command, 0, stdout=json.dumps(payload))

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = KnipTool(pinned_version="5.").run(sample_ts_repo)

    assert result.facts[0].file_refs == ["src/ai.ts"]
    assert not Path(result.facts[0].file_refs[0]).is_absolute()


@pytest.mark.p0
def test_t08_two_tools_confirm_same_ai_package_confidence_boost() -> None:
    packages = DependencyNormalizer().normalize(
        sbom_entries=[
            SBOMEntry(
                name="openai",
                version="1.59.3",
                ecosystem="pypi",
                location="requirements.txt",
                purl="pkg:pypi/openai@1.59.3",
                license=None,
            )
        ],
        usage_facts=[
            DeptryTool.fact(
                package_name="openai",
                usage_state=USAGE_USED,
                file_refs=["src/app.py"],
            ),
            KnipTool.fact(
                package_name="openai",
                usage_state=USAGE_USED,
                file_refs=["src/app.ts"],
            ),
        ],
    )

    assert packages[0].is_ai_relevant is True
    assert packages[0].confidence_boost == 0.10
