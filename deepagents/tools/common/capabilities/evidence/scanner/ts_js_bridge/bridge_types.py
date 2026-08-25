from __future__ import annotations

from dataclasses import dataclass, field

from tools.common.capabilities.evidence.scanner.tools.common.tool_base import ToolExecutionResult


@dataclass(frozen=True)
class TsJsFinding:
    file_path: str
    line_number: int
    finding_type: str
    rule_id: str
    import_source: str | None
    call_expression: str
    kwarg_names: list[str]
    analysis_level: str
    has_dynamic_call: bool
    confidence: float = 0.0


@dataclass(frozen=True)
class TsJsUnsupportedDynamicFlow:
    file_path: str
    line_number: int
    reason: str


@dataclass(frozen=True)
class TsJsCoverageLimitation:
    file_path: str
    reason: str


@dataclass(frozen=True)
class TsJsBridgeResult:
    files_analyzed: int
    files_skipped: int
    findings: list[TsJsFinding]
    unsupported_dynamic_flows: list[TsJsUnsupportedDynamicFlow]
    coverage_limitations: list[TsJsCoverageLimitation]
    analyzer_version: str
    execution: ToolExecutionResult
    schema_version: str = "1.0"
    stderr_preview: str | None = field(default=None)
