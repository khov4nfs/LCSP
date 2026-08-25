from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .bridge_types import (
    TsJsBridgeResult,
    TsJsCoverageLimitation,
    TsJsFinding,
    TsJsUnsupportedDynamicFlow,
)
from tools.common.capabilities.evidence.scanner.tools.common.tool_base import OUTCOME_SUCCESS, ToolExecutionResult


EXPECTED_SCHEMA_VERSION = "1.0"
DEFAULT_TOOL_NAME = "ts_js_analyzer"


class TsJsSchemaValidationError(ValueError):
    pass


class TsJsSchemaValidator:
    def validate(
        self,
        stdout: bytes | str,
        *,
        workspace: str | Path,
        config_hash: str,
    ) -> TsJsBridgeResult:
        payload = self._parse_stdout(stdout)
        schema_version = self._required_str(payload, "schema_version")
        if schema_version != EXPECTED_SCHEMA_VERSION:
            raise TsJsSchemaValidationError(
                f"schema_version mismatch: expected {EXPECTED_SCHEMA_VERSION}, got {schema_version}"
            )

        analyzer_version = self._required_str(payload, "analyzer_version")
        files_analyzed = self._required_int(payload, "files_analyzed")
        files_skipped = self._required_int(payload, "files_skipped")

        findings = [
            self._finding(item, Path(workspace))
            for item in self._required_list(payload, "findings")
        ]
        unsupported_dynamic_flows = [
            self._dynamic_flow(item, Path(workspace))
            for item in self._required_list(payload, "unsupported_dynamic_flows")
        ]
        coverage_limitations = [
            self._coverage_limitation(item, Path(workspace))
            for item in self._required_list(payload, "coverage_limitations")
        ]

        return TsJsBridgeResult(
            files_analyzed=files_analyzed,
            files_skipped=files_skipped,
            findings=findings,
            unsupported_dynamic_flows=unsupported_dynamic_flows,
            coverage_limitations=coverage_limitations,
            analyzer_version=analyzer_version,
            execution=ToolExecutionResult(
                tool_name=DEFAULT_TOOL_NAME,
                tool_version=analyzer_version,
                outcome=OUTCOME_SUCCESS,
                config_hash=config_hash,
                messages=[],
            ),
            schema_version=schema_version,
        )

    def _parse_stdout(self, stdout: bytes | str) -> dict[str, Any]:
        text = stdout.decode("utf-8", errors="replace") if isinstance(stdout, bytes) else stdout
        try:
            payload = json.loads(text)
        except json.JSONDecodeError as error:
            raise TsJsSchemaValidationError("stdout is not valid JSON") from error
        if not isinstance(payload, dict):
            raise TsJsSchemaValidationError("stdout JSON must be an object")
        return payload

    def _finding(self, item: Any, workspace: Path) -> TsJsFinding:
        if not isinstance(item, dict):
            raise TsJsSchemaValidationError("finding must be an object")
        kwarg_names = self._required_list(item, "kwarg_names")
        if not all(isinstance(name, str) for name in kwarg_names):
            raise TsJsSchemaValidationError("finding.kwarg_names must contain strings only")

        return TsJsFinding(
            file_path=self._relative_path(self._required_str(item, "file_path"), workspace),
            line_number=max(1, self._required_int(item, "line_number")),
            finding_type=self._required_str(item, "finding_type"),
            rule_id=self._required_str(item, "rule_id"),
            import_source=self._optional_str(item, "import_source"),
            call_expression=self._required_str(item, "call_expression"),
            kwarg_names=list(kwarg_names),
            analysis_level=self._required_str(item, "analysis_level"),
            has_dynamic_call=self._required_bool(item, "has_dynamic_call"),
            confidence=self._optional_float(item, "confidence"),
        )

    def _dynamic_flow(self, item: Any, workspace: Path) -> TsJsUnsupportedDynamicFlow:
        if not isinstance(item, dict):
            raise TsJsSchemaValidationError("unsupported_dynamic_flow must be an object")
        return TsJsUnsupportedDynamicFlow(
            file_path=self._relative_path(self._required_str(item, "file_path"), workspace),
            line_number=max(1, self._required_int(item, "line_number")),
            reason=self._required_str(item, "reason"),
        )

    def _coverage_limitation(self, item: Any, workspace: Path) -> TsJsCoverageLimitation:
        if not isinstance(item, dict):
            raise TsJsSchemaValidationError("coverage_limitation must be an object")
        return TsJsCoverageLimitation(
            file_path=self._relative_path(self._required_str(item, "file_path"), workspace),
            reason=self._required_str(item, "reason"),
        )

    def _relative_path(self, value: str, workspace: Path) -> str:
        path = Path(value)
        if not path.is_absolute():
            return path.as_posix()

        workspace_resolved = workspace.resolve(strict=False)
        path_resolved = path.resolve(strict=False)
        try:
            return path_resolved.relative_to(workspace_resolved).as_posix()
        except ValueError:
            return path_resolved.name

    def _required_str(self, payload: dict[str, Any], key: str) -> str:
        value = payload.get(key)
        if not isinstance(value, str) or not value.strip():
            raise TsJsSchemaValidationError(f"{key} must be a non-empty string")
        return value

    def _optional_str(self, payload: dict[str, Any], key: str) -> str | None:
        value = payload.get(key)
        if value is None:
            return None
        if not isinstance(value, str):
            raise TsJsSchemaValidationError(f"{key} must be a string when present")
        return value

    def _required_int(self, payload: dict[str, Any], key: str) -> int:
        value = payload.get(key)
        if not isinstance(value, int):
            raise TsJsSchemaValidationError(f"{key} must be an integer")
        return value

    def _required_bool(self, payload: dict[str, Any], key: str) -> bool:
        value = payload.get(key)
        if not isinstance(value, bool):
            raise TsJsSchemaValidationError(f"{key} must be a boolean")
        return value

    def _required_list(self, payload: dict[str, Any], key: str) -> list[Any]:
        value = payload.get(key)
        if not isinstance(value, list):
            raise TsJsSchemaValidationError(f"{key} must be a list")
        return value

    def _optional_float(self, payload: dict[str, Any], key: str) -> float:
        value = payload.get(key, 0.0)
        if not isinstance(value, (int, float)):
            raise TsJsSchemaValidationError(f"{key} must be numeric when present")
        return round(min(1.0, max(0.0, float(value))), 2)
