from __future__ import annotations

from pathlib import Path
from typing import Sequence

from tools.common.capabilities.evidence.scanner.analyzers.protocol import (
    ANALYZER_FAILED,
    ANALYZER_PARTIAL,
    ANALYZER_SUCCESS,
    AnalyzerCapability,
    CanonicalAnalyzerResult,
)
from tools.common.capabilities.evidence.scanner.analyzers.ruby_analysis.ruby_analyzer import RubyAnalyzer


class RubyLanguageAdapter:
    language = "ruby"

    def supports(self, language: str) -> bool:
        return language == self.language

    def capabilities(self) -> AnalyzerCapability:
        return AnalyzerCapability(
            symbols=True,
            imports=True,
            calls=True,
            ai_invocations=True,
            framework_semantics=False,
            dependencies=True,
            dynamic_resolution=False,
        )

    def analyze(
        self, workspace: Path, include_files: Sequence[str] | None
    ) -> CanonicalAnalyzerResult:
        try:
            native = RubyAnalyzer(workspace).analyze(include_files)
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception as error:
            return CanonicalAnalyzerResult(
                language=self.language,
                status=ANALYZER_FAILED,
                capabilities=self.capabilities(),
                coverage_limitations=(f"ruby analyzer failed: {type(error).__name__}",),
            )
        status = ANALYZER_PARTIAL if native.coverage_limitations or native.files_skipped else ANALYZER_SUCCESS
        return CanonicalAnalyzerResult(
            language=self.language,
            status=status,
            capabilities=self.capabilities(),
            native_result=native,
            files_analyzed=native.files_analyzed,
            files_skipped=native.files_skipped,
            coverage_limitations=native.coverage_limitations,
            unsupported_dynamic_flows=native.unsupported_dynamic_flows,
            findings=native.findings,
            semantic_facts=tuple(native.semantic_program.nodes),
            dependencies=native.package_dependencies,
        )
