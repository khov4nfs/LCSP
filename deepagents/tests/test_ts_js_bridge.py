"""MW-scan-py-007: TS/JS subprocess bridge tests."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from runtime.evidence.scanner.tools.tool_base import (
    OUTCOME_SUCCESS,
    OUTCOME_TOOL_FAILURE,
    OUTCOME_TOOL_TIMEOUT,
)


class FakeProcess:
    def __init__(
        self,
        *,
        stdout: str = "",
        stderr: str = "",
        returncode: int = 0,
        delay_seconds: float = 0,
    ) -> None:
        self._stdout = stdout
        self._stderr = stderr
        self.returncode = returncode
        self.delay_seconds = delay_seconds
        self.killed = False

    async def communicate(self) -> tuple[bytes, bytes]:
        if self.delay_seconds:
            await asyncio.sleep(self.delay_seconds)
        return self._stdout.encode(), self._stderr.encode()

    def kill(self) -> None:
        self.killed = True

    async def wait(self) -> None:
        return None


def _payload(**overrides: object) -> str:
    payload: dict[str, object] = {
        "schema_version": "1.0",
        "analyzer_version": "1.0.0",
        "files_analyzed": 1,
        "files_skipped": 0,
        "findings": [
            {
                "file_path": "src/ai.ts",
                "line_number": 3,
                "finding_type": "AI_PROVIDER_USAGE",
                "rule_id": "ts-openai-chat-completions",
                "import_source": "openai",
                "call_expression": "client.chat.completions.create",
                "kwarg_names": ["model", "messages"],
                "analysis_level": "L1",
                "has_dynamic_call": False,
            }
        ],
        "unsupported_dynamic_flows": [],
        "coverage_limitations": [],
    }
    payload.update(overrides)
    return json.dumps(payload)


@pytest.mark.p0
async def test_t01_openai_chat_completion_payload_is_validated(
    sample_ts_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from runtime.evidence.scanner.ts_js_bridge.bridge import TsJsBridge

    async def fake_exec(*args: str, **kwargs: Any) -> FakeProcess:
        assert "npm" not in args
        assert kwargs["cwd"] is None
        assert kwargs["env"].keys() == {"PATH"}
        return FakeProcess(stdout=_payload())

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    result = await TsJsBridge(
        workspace=sample_ts_repo,
        node_executable="node",
        analyzer_script_path="/tools/cli.js",
    ).analyze()

    assert result.execution.outcome == OUTCOME_SUCCESS
    assert result.findings[0].rule_id == "ts-openai-chat-completions"
    assert result.findings[0].finding_type == "AI_PROVIDER_USAGE"
    assert result.findings[0].analysis_level == "L1"


@pytest.mark.p0
async def test_t02_anthropic_messages_payload_is_validated(
    sample_ts_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from runtime.evidence.scanner.ts_js_bridge.bridge import TsJsBridge

    async def fake_exec(*_: str, **__: Any) -> FakeProcess:
        return FakeProcess(
            stdout=_payload(
                findings=[
                    {
                        "file_path": "src/ai.ts",
                        "line_number": 3,
                        "finding_type": "AI_PROVIDER_USAGE",
                        "rule_id": "ts-anthropic-messages",
                        "import_source": "@anthropic-ai/sdk",
                        "call_expression": "client.messages.create",
                        "kwarg_names": ["model", "messages"],
                        "analysis_level": "L1",
                        "has_dynamic_call": False,
                    }
                ]
            )
        )

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    result = await TsJsBridge(
        workspace=sample_ts_repo,
        node_executable="node",
        analyzer_script_path="/tools/cli.js",
    ).analyze()

    assert result.findings[0].rule_id == "ts-anthropic-messages"


@pytest.mark.p0
async def test_t03_langchain_prompt_payload_is_validated(
    sample_ts_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from runtime.evidence.scanner.ts_js_bridge.bridge import TsJsBridge

    async def fake_exec(*_: str, **__: Any) -> FakeProcess:
        return FakeProcess(
            stdout=_payload(
                findings=[
                    {
                        "file_path": "src/prompt.ts",
                        "line_number": 5,
                        "finding_type": "SYSTEM_PROMPT_DETECTED",
                        "rule_id": "ts-langchain-prompt",
                        "import_source": "langchain",
                        "call_expression": "ChatPromptTemplate.fromMessages",
                        "kwarg_names": [],
                        "analysis_level": "L1",
                        "has_dynamic_call": False,
                    }
                ]
            )
        )

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    result = await TsJsBridge(
        workspace=sample_ts_repo,
        node_executable="node",
        analyzer_script_path="/tools/cli.js",
    ).analyze()

    assert result.findings[0].finding_type == "SYSTEM_PROMPT_DETECTED"


@pytest.mark.p0
async def test_t04_dynamic_property_access_is_returned_as_unsupported_flow(
    sample_ts_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from runtime.evidence.scanner.ts_js_bridge.bridge import TsJsBridge

    async def fake_exec(*_: str, **__: Any) -> FakeProcess:
        return FakeProcess(
            stdout=_payload(
                findings=[],
                unsupported_dynamic_flows=[
                    {
                        "file_path": "src/dynamic.ts",
                        "line_number": 99,
                        "reason": "dynamic property access on AI client object",
                    }
                ],
            )
        )

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    result = await TsJsBridge(
        workspace=sample_ts_repo,
        node_executable="node",
        analyzer_script_path="/tools/cli.js",
    ).analyze()

    assert result.unsupported_dynamic_flows[0].reason.startswith(
        "dynamic property access"
    )


@pytest.mark.p0
async def test_t05_timeout_kills_process_and_records_limitation(
    sample_ts_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from runtime.evidence.scanner.ts_js_bridge.bridge import TsJsBridge

    fake_process = FakeProcess(delay_seconds=1)

    async def fake_exec(*_: str, **__: Any) -> FakeProcess:
        return fake_process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    result = await TsJsBridge(
        workspace=sample_ts_repo,
        node_executable="node",
        analyzer_script_path="/tools/cli.js",
        timeout_seconds=0.01,
    ).analyze()

    assert fake_process.killed is True
    assert result.execution.outcome == OUTCOME_TOOL_TIMEOUT
    assert result.coverage_limitations[0].reason.startswith("TS_JS_ANALYZER_FAILED")


@pytest.mark.p0
async def test_t06_invalid_json_stdout_records_non_blocking_failure(
    sample_ts_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from runtime.evidence.scanner.ts_js_bridge.bridge import TsJsBridge

    async def fake_exec(*_: str, **__: Any) -> FakeProcess:
        return FakeProcess(stdout="{not-json")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    result = await TsJsBridge(
        workspace=sample_ts_repo,
        node_executable="node",
        analyzer_script_path="/tools/cli.js",
    ).analyze()

    assert result.execution.outcome == OUTCOME_TOOL_FAILURE
    assert result.coverage_limitations[0].reason.startswith("TS_JS_ANALYZER_FAILED")


@pytest.mark.p0
async def test_t07_subprocess_env_contains_path_only(
    sample_ts_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from runtime.evidence.scanner.ts_js_bridge.bridge import TsJsBridge
    from runtime.evidence.scanner.ts_js_bridge.bridge import assert_subprocess_env_safe

    monkeypatch.setenv("GITHUB_TOKEN", "ghp_123456789012345678901234567890123456")
    captured_env: dict[str, str] = {}

    async def fake_exec(*_: str, **kwargs: Any) -> FakeProcess:
        captured_env.update(kwargs["env"])
        return FakeProcess(stdout=_payload())

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    await TsJsBridge(
        workspace=sample_ts_repo,
        node_executable="node",
        analyzer_script_path="/tools/cli.js",
    ).analyze()

    assert captured_env.keys() == {"PATH"}
    assert "GITHUB_TOKEN" not in captured_env
    with pytest.raises(AssertionError):
        assert_subprocess_env_safe(
            {"PATH": "/usr/bin", "GITHUB_TOKEN": "ghp_123456789012345678901234567890123456"}
        )


@pytest.mark.p0
async def test_t08_absolute_finding_path_is_stripped_to_workspace_relative(
    sample_ts_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from runtime.evidence.scanner.ts_js_bridge.bridge import TsJsBridge

    absolute = sample_ts_repo / "src" / "ai.ts"

    async def fake_exec(*_: str, **__: Any) -> FakeProcess:
        return FakeProcess(
            stdout=_payload(
                findings=[
                    {
                        "file_path": str(absolute),
                        "line_number": 3,
                        "finding_type": "AI_PROVIDER_USAGE",
                        "rule_id": "ts-openai-chat-completions",
                        "import_source": "openai",
                        "call_expression": "client.chat.completions.create",
                        "kwarg_names": ["model", "messages"],
                        "analysis_level": "L1",
                        "has_dynamic_call": False,
                    }
                ]
            )
        )

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    result = await TsJsBridge(
        workspace=sample_ts_repo,
        node_executable="node",
        analyzer_script_path="/tools/cli.js",
    ).analyze()

    assert result.findings[0].file_path == "src/ai.ts"
    assert not Path(result.findings[0].file_path).is_absolute()


@pytest.mark.p0
async def test_t09_secret_in_stderr_is_stripped_before_result_message(
    sample_ts_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from runtime.evidence.scanner.ts_js_bridge.bridge import TsJsBridge

    async def fake_exec(*_: str, **__: Any) -> FakeProcess:
        return FakeProcess(
            stderr="GITHUB_TOKEN=ghp_123456789012345678901234567890123456",
            returncode=1,
        )

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    result = await TsJsBridge(
        workspace=sample_ts_repo,
        node_executable="node",
        analyzer_script_path="/tools/cli.js",
    ).analyze()

    message = result.execution.messages[0]
    assert "ghp_" not in message


@pytest.mark.p0
async def test_t10_no_js_ts_files_skips_subprocess(
    workspace_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from runtime.evidence.scanner.ts_js_bridge.bridge import TsJsBridge

    (workspace_dir / "src").mkdir()
    (workspace_dir / "src" / "app.py").write_text("print('ok')\n", encoding="utf-8")
    called = False

    async def fake_exec(*_: str, **__: Any) -> FakeProcess:
        nonlocal called
        called = True
        return FakeProcess(stdout=_payload())

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    result = await TsJsBridge(
        workspace=workspace_dir,
        node_executable="node",
        analyzer_script_path="/tools/cli.js",
    ).analyze()

    assert called is False
    assert result.execution.outcome == OUTCOME_SUCCESS
    assert result.files_analyzed == 0
    assert result.findings == []


@pytest.mark.p0
async def test_t11_missing_analyzer_script_records_concise_failure(
    sample_ts_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from runtime.evidence.scanner.ts_js_bridge.bridge import TsJsBridge

    async def fake_exec(*_: str, **__: Any) -> FakeProcess:
        raise AssertionError("subprocess should not run when analyzer script is missing")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    monkeypatch.setattr(
        TsJsBridge,
        "_default_analyzer_script_path",
        lambda self: sample_ts_repo / "missing-cli.js",
    )

    result = await TsJsBridge(
        workspace=sample_ts_repo,
        node_executable="node",
    ).analyze()

    assert result.execution.outcome == OUTCOME_TOOL_FAILURE
    assert result.coverage_limitations[0].reason.startswith(
        "TS_JS_ANALYZER_FAILED: analyzer script not found"
    )
    assert "\n" not in result.coverage_limitations[0].reason


@pytest.mark.p0
def test_ts_analyzer_source_contains_required_rule_ids() -> None:
    analyzer = (
        Path(__file__).parents[1]
        / "runtime"
        / "evidence"
        / "scanner"
        / "ts_js_bridge"
        / "ts-js-analyzer"
        / "analyzer.ts"
    )
    source = analyzer.read_text(encoding="utf-8")

    for rule_id in [
        "ts-openai-chat-completions",
        "ts-openai-embeddings",
        "ts-anthropic-messages",
        "ts-google-genai",
        "ts-langchain-llm",
        "ts-langchain-prompt",
        "ts-langchain-rag",
        "ts-llamaindex-query",
        "ts-hf-inference",
        "ts-generic-predict",
        "ts-system-prompt-var",
        "ts-dynamic-prompt",
        "ts-output-parser",
        "ts-local-http-inference",
    ]:
        assert rule_id in source
