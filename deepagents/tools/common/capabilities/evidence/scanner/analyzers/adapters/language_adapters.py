"""Adapters that preserve the existing Python and TS/JS analyzer outputs."""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Sequence

from tools.common.capabilities.evidence.scanner.analyzers.python_analysis.python_analyzer import (
    PythonAnalyzer,
)
from tools.common.capabilities.evidence.scanner.inventory.language.language_types import (
    LANGUAGE_JAVASCRIPT,
    LANGUAGE_PYTHON,
    LANGUAGE_TYPESCRIPT,
)
from tools.common.capabilities.evidence.scanner.ts_js_bridge.bridge import TsJsBridge
from tools.common.capabilities.evidence.scanner.ts_js_bridge.bridge_types import TsJsBridgeResult
from tools.common.capabilities.evidence.scanner.tools.common.tool_base import OUTCOME_SUCCESS
from tools.common.capabilities.evidence.scanner.analyzers.protocol import (
    ANALYZER_FAILED,
    ANALYZER_PARTIAL,
    ANALYZER_SUCCESS,
    AnalyzerCapability,
    CanonicalAnalyzerResult,
)


def _status(files_skipped: int, limitations: Sequence[str], failed: bool = False) -> str:
    if failed:
        return ANALYZER_FAILED
    return ANALYZER_PARTIAL if files_skipped or limitations else ANALYZER_SUCCESS


class PythonLanguageAdapter:
    language = LANGUAGE_PYTHON

    def supports(self, language: str) -> bool:
        return language == LANGUAGE_PYTHON

    def capabilities(self) -> AnalyzerCapability:
        return AnalyzerCapability(
            symbols=True,
            imports=True,
            calls=True,
            ai_invocations=True,
            dynamic_resolution=False,
        )

    def analyze(self, workspace: Path, include_files: Sequence[str] | None) -> CanonicalAnalyzerResult:
        native = PythonAnalyzer(workspace).analyze(include_files=include_files)
        limitations = tuple(native.coverage_limitations)
        return CanonicalAnalyzerResult(
            language=self.language,
            status=_status(native.files_skipped, limitations),
            capabilities=self.capabilities(),
            native_result=native,
            files_analyzed=native.files_analyzed,
            files_skipped=native.files_skipped,
            coverage_limitations=limitations,
            unsupported_dynamic_flows=tuple(native.unsupported_dynamic_flows),
            findings=tuple(native.findings),
            import_map=dict(native.import_map),
            execution=None,
        )


class TsJsLanguageAdapter:
    language = "ts_js"

    def __init__(self, bridge_factory: Callable[[Path], TsJsBridge] | None = None) -> None:
        self._bridge_factory = bridge_factory or (lambda workspace: TsJsBridge(workspace=workspace))

    def supports(self, language: str) -> bool:
        return language in {LANGUAGE_TYPESCRIPT, LANGUAGE_JAVASCRIPT}

    def capabilities(self) -> AnalyzerCapability:
        return AnalyzerCapability(
            symbols=True,
            imports=True,
            calls=True,
            ai_invocations=True,
            dynamic_resolution=False,
        )

    def analyze(self, workspace: Path, include_files: Sequence[str] | None) -> CanonicalAnalyzerResult:
        # The bridge is async; the canonical scanner entrypoint invokes this adapter
        # through its existing synchronous tool boundary.
        import asyncio

        native: TsJsBridgeResult = asyncio.run(
            self._bridge_factory(workspace).analyze(
                include_files=list(include_files) if include_files is not None else None
            )
        )
        limitations = tuple(item.reason for item in native.coverage_limitations)
        return CanonicalAnalyzerResult(
            language=self.language,
            status=_status(
                native.files_skipped,
                limitations,
                native.execution.outcome != OUTCOME_SUCCESS,
            ),
            capabilities=self.capabilities(),
            native_result=native,
            files_analyzed=native.files_analyzed,
            files_skipped=native.files_skipped,
            coverage_limitations=limitations,
            unsupported_dynamic_flows=tuple(native.unsupported_dynamic_flows),
            findings=tuple(native.findings),
            execution=native.execution,
        )
