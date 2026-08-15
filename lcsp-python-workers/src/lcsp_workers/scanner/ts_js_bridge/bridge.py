from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
from pathlib import Path
from typing import Iterable

from lcsp_workers.platform.logging import get_logger
from lcsp_workers.platform.redaction import SENSITIVE_KEY_PATTERN, redact_string
from lcsp_workers.scanner.tools.tool_base import (
    NOT_RUN_VERSION,
    OUTCOME_SUCCESS,
    OUTCOME_TOOL_FAILURE,
    OUTCOME_TOOL_TIMEOUT,
    ToolExecutionResult,
)

from .bridge_types import TsJsBridgeResult, TsJsCoverageLimitation
from .schema_validator import DEFAULT_TOOL_NAME, TsJsSchemaValidationError, TsJsSchemaValidator


DEFAULT_TIMEOUT_SECONDS = 150
EXPECTED_SCHEMA_VERSION = "1.0"
DEFAULT_ANALYZER_VERSION = "unknown"
TS_JS_ANALYZER_FAILED = "TS_JS_ANALYZER_FAILED"
TS_JS_SUFFIXES = {".js", ".ts", ".mjs", ".cjs", ".jsx", ".tsx"}
EXCLUDED_PARTS = {"node_modules", ".git", "dist", "build", ".next", "coverage"}
LOGGER = get_logger(__name__)


class TsJsBridge:
    def __init__(
        self,
        *,
        workspace: str | Path,
        node_executable: str | None = None,
        analyzer_script_path: str | Path | None = None,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        schema_validator: TsJsSchemaValidator | None = None,
    ) -> None:
        self._workspace = Path(workspace)
        self._node_executable = node_executable
        self._uses_default_analyzer_script_path = analyzer_script_path is None
        self._analyzer_script_path = (
            self._default_analyzer_script_path()
            if self._uses_default_analyzer_script_path
            else Path(analyzer_script_path)
        )
        self._timeout_seconds = timeout_seconds
        self._schema_validator = schema_validator or TsJsSchemaValidator()

    async def analyze(
        self,
        include_files: Iterable[str] | None = None,
    ) -> TsJsBridgeResult:
        include_file_list = list(include_files) if include_files is not None else None
        if not self._should_run(include_file_list):
            return self._skipped_result("ts/js analyzer skipped: no JS/TS files present")

        config_hash = self._config_hash()
        if (
            self._uses_default_analyzer_script_path
            and not self._analyzer_script_path.is_file()
        ):
            return self._failure_result(
                outcome=OUTCOME_TOOL_FAILURE,
                config_hash=config_hash,
                message=(
                    f"{TS_JS_ANALYZER_FAILED}: analyzer script not found at "
                    f"{self._analyzer_script_path}"
                ),
            )
        request_json = json.dumps(
            {
                "schema_version": EXPECTED_SCHEMA_VERSION,
                "workspace_path": str(self._workspace.resolve(strict=False)),
                "max_analysis_depth": 3,
                "output_format": "json",
                "include_files": include_file_list,
            },
            separators=(",", ":"),
        )
        env = sanitized_subprocess_env()
        assert_subprocess_env_safe(env)

        try:
            proc = await asyncio.create_subprocess_exec(
                self._resolve_node_executable(),
                str(self._analyzer_script_path),
                "--workspace",
                str(self._workspace.resolve(strict=False)),
                "--request",
                request_json,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
                cwd=None,
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(),
                    timeout=self._timeout_seconds,
                )
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                return self._failure_result(
                    outcome=OUTCOME_TOOL_TIMEOUT,
                    config_hash=config_hash,
                    message=f"{TS_JS_ANALYZER_FAILED}: timeout after {self._timeout_seconds}s",
                )
        except OSError as error:
            return self._failure_result(
                outcome=OUTCOME_TOOL_FAILURE,
                config_hash=config_hash,
                message=f"{TS_JS_ANALYZER_FAILED}: execution failed: {type(error).__name__}",
            )

        redacted_stderr = redact_stderr(stderr)
        if redacted_stderr:
            LOGGER.debug(
                "TS_JS_ANALYZER_STDERR",
                stderr_preview=redacted_stderr[:500],
            )

        if proc.returncode != 0:
            message = redacted_stderr[:500] or "non-zero exit code"
            return self._failure_result(
                outcome=OUTCOME_TOOL_FAILURE,
                config_hash=config_hash,
                message=f"{TS_JS_ANALYZER_FAILED}: {message}",
                stderr_preview=redacted_stderr[:500] if redacted_stderr else None,
            )

        try:
            return self._schema_validator.validate(
                stdout,
                workspace=self._workspace,
                config_hash=config_hash,
            )
        except TsJsSchemaValidationError as error:
            return self._failure_result(
                outcome=OUTCOME_TOOL_FAILURE,
                config_hash=config_hash,
                message=f"{TS_JS_ANALYZER_FAILED}: {error}",
                stderr_preview=redacted_stderr[:500] if redacted_stderr else None,
            )

    def _should_run(self, include_files: list[str] | None) -> bool:
        if include_files is not None:
            return any(Path(path).suffix.lower() in TS_JS_SUFFIXES for path in include_files)

        return any(
            path.is_file()
            and path.suffix.lower() in TS_JS_SUFFIXES
            and not any(part in EXCLUDED_PARTS for part in path.parts)
            for path in self._workspace.rglob("*")
        )

    def _resolve_node_executable(self) -> str:
        candidate = self._node_executable or os.environ.get("TS_JS_NODE_PATH") or shutil.which("node") or "node"
        executable_name = Path(candidate).name.lower()
        if executable_name not in {"node", "node.exe"}:
            raise AssertionError("TS/JS analyzer node executable must resolve to node")
        return candidate

    def _default_analyzer_script_path(self) -> Path:
        return (
            Path(__file__).resolve().parent
            / "ts-js-analyzer"
            / "dist"
            / "tools"
            / "ts-js-analyzer"
            / "cli.js"
        )

    def _config_hash(self) -> str:
        try:
            digest = hashlib.sha256(self._analyzer_script_path.read_bytes()).hexdigest()
        except OSError:
            digest = "unavailable"
        return f"sha256:{digest}"

    def _skipped_result(self, message: str) -> TsJsBridgeResult:
        return TsJsBridgeResult(
            files_analyzed=0,
            files_skipped=0,
            findings=[],
            unsupported_dynamic_flows=[],
            coverage_limitations=[],
            analyzer_version=NOT_RUN_VERSION,
            execution=ToolExecutionResult(
                tool_name=DEFAULT_TOOL_NAME,
                tool_version=NOT_RUN_VERSION,
                outcome=OUTCOME_SUCCESS,
                config_hash=self._config_hash(),
                messages=[message],
            ),
        )

    def _failure_result(
        self,
        *,
        outcome: str,
        config_hash: str,
        message: str,
        stderr_preview: str | None = None,
    ) -> TsJsBridgeResult:
        return TsJsBridgeResult(
            files_analyzed=0,
            files_skipped=0,
            findings=[],
            unsupported_dynamic_flows=[],
            coverage_limitations=[
                TsJsCoverageLimitation(file_path="<workspace>", reason=message)
            ],
            analyzer_version=DEFAULT_ANALYZER_VERSION,
            execution=ToolExecutionResult(
                tool_name=DEFAULT_TOOL_NAME,
                tool_version=DEFAULT_ANALYZER_VERSION,
                outcome=outcome,
                config_hash=config_hash,
                messages=[message],
            ),
            stderr_preview=stderr_preview,
        )


def sanitized_subprocess_env() -> dict[str, str]:
    return {"PATH": os.environ.get("PATH", "")}


def assert_subprocess_env_safe(env: dict[str, str]) -> None:
    if set(env.keys()) != {"PATH"}:
        raise AssertionError("TS/JS analyzer subprocess env must contain PATH only")
    for key, value in env.items():
        if key != "PATH" or SENSITIVE_KEY_PATTERN.search(key) or redact_string(value) != value:
            raise AssertionError("TS/JS analyzer subprocess env contains a secret")


def redact_stderr(stderr: bytes | str) -> str:
    text = stderr.decode("utf-8", errors="replace") if isinstance(stderr, bytes) else stderr
    return redact_string(text)
