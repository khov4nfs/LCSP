from __future__ import annotations

from pathlib import Path
from typing import Sequence

from tools.common.capabilities.evidence.scanner.analyzers.csharp_analysis import CSharpAnalyzer
from tools.common.capabilities.evidence.scanner.inventory.language.language_types import LANGUAGE_CSHARP
from tools.common.capabilities.evidence.scanner.analyzers.protocol import (
    ANALYZER_PARTIAL,
    ANALYZER_SUCCESS,
    AnalyzerCapability,
    CanonicalAnalyzerResult,
)


class CSharpLanguageAdapter:
    language = LANGUAGE_CSHARP

    def supports(self, language: str) -> bool:
        return language == LANGUAGE_CSHARP

    def capabilities(self) -> AnalyzerCapability:
        return AnalyzerCapability(
            symbols=True,
            imports=True,
            calls=True,
            ai_invocations=True,
            dependencies=True,
            dynamic_resolution=False,
        )

    def analyze(self, workspace: Path, include_files: Sequence[str] | None) -> CanonicalAnalyzerResult:
        native = CSharpAnalyzer(workspace).analyze(include_files)
        limitations = tuple(native.coverage_limitations)
        status = ANALYZER_PARTIAL if native.files_skipped or limitations or native.unsupported_dynamic_flows else ANALYZER_SUCCESS
        return CanonicalAnalyzerResult(
            language=self.language,
            status=status,
            capabilities=self.capabilities(),
            native_result=native,
            files_analyzed=native.files_analyzed,
            files_skipped=native.files_skipped,
            coverage_limitations=limitations,
            unsupported_dynamic_flows=native.unsupported_dynamic_flows,
            semantic_facts=tuple(native.semantic_program.nodes),
            dependencies=native.package_dependencies,
        )
