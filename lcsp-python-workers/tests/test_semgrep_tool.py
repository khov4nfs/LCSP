from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from lcsp_workers.scanner.tools.semgrep_tool import (
    AI_USAGE_TOOL_NAME,
    SECRET_DETECT_TOOL_NAME,
    SemgrepTool,
)
from lcsp_workers.scanner.tools.tool_base import (
    OUTCOME_SUCCESS,
    OUTCOME_TOOL_TIMEOUT,
)


def _completed(
    args: list[str],
    returncode: int,
    stdout: str = "",
    stderr: str = "",
) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(args=args, returncode=returncode, stdout=stdout, stderr=stderr)


def _write_rulesets(workspace_dir: Path) -> tuple[Path, Path]:
    ai_ruleset = workspace_dir / "lcsp-ai-usage.yaml"
    secret_ruleset = workspace_dir / "lcsp-secret-detect.yaml"
    ai_ruleset.write_text("rules:\n  - id: lcsp.openai-client\n", encoding="utf-8")
    secret_ruleset.write_text("rules:\n  - id: lcsp.secret-openai-key\n", encoding="utf-8")
    return ai_ruleset, secret_ruleset


@pytest.mark.p0
def test_semgrep_tool_detects_openai_import(
    workspace_dir: Path,
    sample_python_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ai_ruleset, secret_ruleset = _write_rulesets(workspace_dir)
    target_path = sample_python_repo / "src" / "ai_client.py"

    ai_payload = {
        "results": [
            {
                "check_id": "lcsp.openai-client",
                "path": str(target_path),
                "start": {"line": 1},
                "end": {"line": 1},
                "extra": {
                    "message": "OpenAI client integration detected",
                    "severity": "INFO",
                    "lines": "import openai",
                },
            }
        ]
    }

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="semgrep 1.99.0\n")
        if str(ai_ruleset) in command:
            return _completed(command, 0, stdout=json.dumps(ai_payload))
        return _completed(command, 0, stdout=json.dumps({"results": []}))

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = SemgrepTool(
        ai_ruleset_path=ai_ruleset,
        secret_ruleset_path=secret_ruleset,
        pinned_version="1.",
    ).run(sample_python_repo)

    assert len(result.findings) == 1
    assert result.findings[0].rule_id == "lcsp.openai-client"
    assert result.findings[0].signal_type == "provider_integration"
    assert result.findings[0].file_path == "src/ai_client.py"


@pytest.mark.p0
def test_semgrep_tool_detects_model_call(
    workspace_dir: Path,
    sample_python_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ai_ruleset, secret_ruleset = _write_rulesets(workspace_dir)
    target_path = sample_python_repo / "src" / "ai_client.py"

    ai_payload = {
        "results": [
            {
                "check_id": "lcsp.model-call",
                "path": str(target_path),
                "start": {"line": 3},
                "end": {"line": 3},
                "extra": {
                    "message": "LLM model invocation detected",
                    "severity": "WARNING",
                },
            }
        ]
    }

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="semgrep 1.99.0\n")
        if str(ai_ruleset) in command:
            return _completed(command, 0, stdout=json.dumps(ai_payload))
        return _completed(command, 0, stdout=json.dumps({"results": []}))

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = SemgrepTool(
        ai_ruleset_path=ai_ruleset,
        secret_ruleset_path=secret_ruleset,
        pinned_version="1.",
    ).run(sample_python_repo)

    assert len(result.findings) == 1
    assert result.findings[0].rule_id == "lcsp.model-call"
    assert result.findings[0].signal_type == "model_call"
    assert result.findings[0].severity == "WARNING"


@pytest.mark.p0
def test_semgrep_tool_returns_empty_findings_when_no_ai_usage(
    workspace_dir: Path,
    sample_python_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ai_ruleset, secret_ruleset = _write_rulesets(workspace_dir)

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="semgrep 1.99.0\n")
        return _completed(command, 0, stdout=json.dumps({"results": []}))

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = SemgrepTool(
        ai_ruleset_path=ai_ruleset,
        secret_ruleset_path=secret_ruleset,
        pinned_version="1.",
    ).run(sample_python_repo)

    assert result.findings == []
    assert [execution.outcome for execution in result.executions] == [OUTCOME_SUCCESS, OUTCOME_SUCCESS]


@pytest.mark.p0
def test_semgrep_tool_limits_each_ruleset_to_authorized_relative_files(
    workspace_dir: Path,
    sample_python_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ai_ruleset, secret_ruleset = _write_rulesets(workspace_dir)
    commands: list[list[str]] = []

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="semgrep 1.99.0\n")
        commands.append(command)
        return _completed(command, 0, stdout=json.dumps({"results": []}))

    monkeypatch.setattr(subprocess, "run", fake_run)

    SemgrepTool(
        ai_ruleset_path=ai_ruleset,
        secret_ruleset_path=secret_ruleset,
        pinned_version="1.",
    ).run(sample_python_repo, include_files=["src/ai_client.py"])

    expected_target = str((sample_python_repo / "src" / "ai_client.py").resolve())
    assert len(commands) == 2
    assert all(expected_target in command for command in commands)
    assert all(str(sample_python_repo) not in command for command in commands)


@pytest.mark.p0
def test_semgrep_tool_rejects_target_outside_materialized_workspace(
    workspace_dir: Path,
    sample_python_repo: Path,
) -> None:
    ai_ruleset, secret_ruleset = _write_rulesets(workspace_dir)

    with pytest.raises(ValueError, match="outside the materialized workspace"):
        SemgrepTool(
            ai_ruleset_path=ai_ruleset,
            secret_ruleset_path=secret_ruleset,
            pinned_version="1.",
        ).run(sample_python_repo, include_files=["../outside.py"])


@pytest.mark.p0
def test_semgrep_tool_strips_source_code_from_output(
    workspace_dir: Path,
    sample_python_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ai_ruleset, secret_ruleset = _write_rulesets(workspace_dir)
    target_path = sample_python_repo / "src" / "ai_client.py"

    ai_payload = {
        "results": [
            {
                "check_id": "lcsp.openai-client",
                "path": str(target_path),
                "start": {"line": 1},
                "end": {"line": 1},
                "extra": {
                    "message": "OpenAI client integration detected",
                    "severity": "INFO",
                    "lines": "import openai\nclient = openai.OpenAI()",
                },
            }
        ]
    }

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="semgrep 1.99.0\n")
        if str(ai_ruleset) in command:
            return _completed(command, 0, stdout=json.dumps(ai_payload))
        return _completed(command, 0, stdout=json.dumps({"results": []}))

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = SemgrepTool(
        ai_ruleset_path=ai_ruleset,
        secret_ruleset_path=secret_ruleset,
        pinned_version="1.",
    ).run(sample_python_repo)

    finding_text = json.dumps(result.findings[0].__dict__)
    assert "import openai" not in finding_text
    assert "client = openai.OpenAI" not in finding_text


@pytest.mark.p0
def test_semgrep_tool_records_config_hashes(
    workspace_dir: Path,
    sample_python_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ai_ruleset, secret_ruleset = _write_rulesets(workspace_dir)

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="semgrep 1.99.0\n")
        return _completed(command, 0, stdout=json.dumps({"results": []}))

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = SemgrepTool(
        ai_ruleset_path=ai_ruleset,
        secret_ruleset_path=secret_ruleset,
        pinned_version="1.",
    ).run(sample_python_repo)

    assert len(result.executions) == 2
    assert result.executions[0].tool_name == AI_USAGE_TOOL_NAME
    assert result.executions[1].tool_name == SECRET_DETECT_TOOL_NAME
    assert result.executions[0].config_hash.startswith("sha256:")
    assert result.executions[1].config_hash.startswith("sha256:")


@pytest.mark.p0
def test_semgrep_tool_timeout_is_non_blocking(
    workspace_dir: Path,
    sample_python_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ai_ruleset, secret_ruleset = _write_rulesets(workspace_dir)

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="semgrep 1.99.0\n")
        if str(ai_ruleset) in command:
            raise subprocess.TimeoutExpired(cmd=command, timeout=180)
        return _completed(command, 0, stdout=json.dumps({"results": []}))

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = SemgrepTool(
        ai_ruleset_path=ai_ruleset,
        secret_ruleset_path=secret_ruleset,
        pinned_version="1.",
    ).run(sample_python_repo)

    assert result.findings == []
    assert result.executions[0].outcome == OUTCOME_TOOL_TIMEOUT


@pytest.mark.p0
def test_semgrep_secret_detection_does_not_appear_in_evidence(
    workspace_dir: Path,
    sample_python_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ai_ruleset, secret_ruleset = _write_rulesets(workspace_dir)
    target_path = sample_python_repo / "src" / "ai_client.py"

    ai_payload = {
        "results": [
            {
                "check_id": "lcsp.openai-client",
                "path": str(target_path),
                "start": {"line": 1},
                "end": {"line": 1},
                "extra": {
                    "message": "OpenAI client integration detected",
                    "severity": "INFO",
                },
            }
        ]
    }
    secret_payload = {
        "results": [
            {
                "check_id": "lcsp.secret-openai-key",
                "path": str(target_path),
                "start": {"line": 2},
                "end": {"line": 2},
                "extra": {
                    "message": "Potential OpenAI secret detected",
                    "severity": "WARNING",
                },
            }
        ]
    }

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="semgrep 1.99.0\n")
        if str(ai_ruleset) in command:
            return _completed(command, 0, stdout=json.dumps(ai_payload))
        return _completed(command, 0, stdout=json.dumps(secret_payload))

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = SemgrepTool(
        ai_ruleset_path=ai_ruleset,
        secret_ruleset_path=secret_ruleset,
        pinned_version="1.",
    ).run(sample_python_repo)

    assert len(result.findings) == 1
    assert result.findings[0].rule_id == "lcsp.openai-client"
    assert all("secret" not in finding.rule_id for finding in result.findings)
    assert result.redaction_applied is True


@pytest.mark.p0
def test_semgrep_tool_parses_full_ruleset_metadata_and_strips_source_fields(
    workspace_dir: Path,
    sample_python_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ai_ruleset, secret_ruleset = _write_rulesets(workspace_dir)
    target_path = sample_python_repo / "src" / "ai_client.py"

    ai_payload = {
        "results": [
            {
                "check_id": "lcsp-openai-chat-completions-py",
                "path": str(target_path),
                "start": {"line": 3},
                "end": {"line": 6},
                "extra": {
                    "message": "OpenAI chat completions API call",
                    "severity": "WARNING",
                    "lines": "response = client.chat.completions.create(...)",
                    "metavars": {"$CLIENT": {"abstract_content": "client"}},
                    "metadata": {
                        "finding_type": "AI_PROVIDER_USAGE",
                        "base_confidence": 0.9,
                        "library_group": "openai",
                    },
                },
            }
        ]
    }

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if "--version" in command:
            return _completed(command, 0, stdout="semgrep 1.99.0\n")
        if str(ai_ruleset) in command:
            return _completed(command, 0, stdout=json.dumps(ai_payload))
        return _completed(command, 0, stdout=json.dumps({"results": []}))

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = SemgrepTool(
        ai_ruleset_path=ai_ruleset,
        secret_ruleset_path=secret_ruleset,
        pinned_version="1.",
    ).run(sample_python_repo)

    assert len(result.findings) == 1
    finding = result.findings[0]
    assert finding.rule_id == "lcsp-openai-chat-completions-py"
    assert finding.signal_type == "provider_integration"
    assert finding.finding_type == "AI_PROVIDER_USAGE"
    assert finding.base_confidence == 0.9
    assert finding.library_group == "openai"
    assert finding.file_path == "src/ai_client.py"
    finding_payload = json.dumps(finding.__dict__)
    assert "chat.completions.create" not in finding_payload
    assert "abstract_content" not in finding_payload


@pytest.mark.p0
def test_semgrep_full_ai_ruleset_declares_required_groups_and_metadata() -> None:
    ruleset = (
        Path(__file__).parents[1]
        / "src"
        / "lcsp_workers"
        / "scanner"
        / "rulesets"
        / "lcsp-ai-usage.yaml"
    )
    source = ruleset.read_text(encoding="utf-8")

    for expected in [
        "options:",
        "symbolic_propagation: true",
        "strip_source: true",
        "lcsp-openai-chat-completions-py",
        "lcsp-openai-chat-completions-js",
        "lcsp-anthropic-messages-js",
        "lcsp-google-genai-js",
        "lcsp-hf-inference-api-py",
        "lcsp-langchain-agent-py",
        "lcsp-llamaindex-query-py",
        "lcsp-sklearn-predict-py",
        "lcsp-tf-predict-py",
        "lcsp-torch-inference-py",
        "lcsp-local-inference-endpoint-py",
        "lcsp-generic-generate-py",
        "AI_DECISION_FLOW_SIGNAL",
        "RAG_USAGE_SIGNAL",
        "MODEL_OUTPUT_PARSER_SIGNAL",
        "DYNAMIC_SYSTEM_PROMPT_REFERENCE",
    ]:
        assert expected in source

    rule_blocks = [block for block in source.split("  - id: ") if block.startswith("lcsp-")]
    assert len(rule_blocks) >= 20
    for block in rule_blocks:
        assert "finding_type:" in block
        assert "base_confidence:" in block
        assert "library_group:" in block
