from __future__ import annotations
from pathlib import Path
from typing import Sequence
from tools.common.capabilities.evidence.scanner.analyzers.php_analysis import PhpAnalyzer
from tools.common.capabilities.evidence.scanner.analyzers.protocol import ANALYZER_PARTIAL, ANALYZER_SUCCESS, AnalyzerCapability, CanonicalAnalyzerResult

class PhpLanguageAdapter:
    language = "php"
    def supports(self, language: str) -> bool: return language == self.language
    def capabilities(self) -> AnalyzerCapability:
        return AnalyzerCapability(symbols=True, imports=True, calls=True, dependencies=True, ai_invocations=True, dynamic_resolution=False)
    def analyze(self, workspace: Path, include_files: Sequence[str] | None) -> CanonicalAnalyzerResult:
        native = PhpAnalyzer(workspace).analyze(include_files)
        status = ANALYZER_PARTIAL if native.files_skipped or native.coverage_limitations or native.unsupported_dynamic_flows else ANALYZER_SUCCESS
        return CanonicalAnalyzerResult(language=self.language, status=status, capabilities=self.capabilities(), native_result=native, files_analyzed=native.files_analyzed, files_skipped=native.files_skipped, coverage_limitations=native.coverage_limitations, unsupported_dynamic_flows=native.unsupported_dynamic_flows, semantic_facts=tuple(native.semantic_program.nodes), dependencies=native.package_dependencies)
