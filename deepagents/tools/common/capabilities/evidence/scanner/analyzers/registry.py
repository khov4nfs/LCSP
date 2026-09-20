"""Deterministic registry for semantic language analyzers."""
from __future__ import annotations

from pathlib import Path
from typing import Iterable, Sequence

from .protocol import (
    ANALYZER_FAILED,
    ANALYZER_UNSUPPORTED,
    AnalyzerCapability,
    CanonicalAnalyzerResult,
    LanguageAnalyzer,
)


class LanguageAnalyzerRegistry:
    def __init__(self, analyzers: Iterable[LanguageAnalyzer] = ()) -> None:
        self._analyzers: list[LanguageAnalyzer] = []
        for analyzer in analyzers:
            self.register(analyzer)

    @classmethod
    def default(cls, ts_js_bridge_factory=None) -> "LanguageAnalyzerRegistry":
        from .adapters import CLanguageAdapter, CSharpLanguageAdapter, ClojureLanguageAdapter, CppLanguageAdapter, DartLanguageAdapter, ElixirLanguageAdapter, GoLanguageAdapter, HaskellLanguageAdapter, JavaLanguageAdapter, KotlinLanguageAdapter, LuaLanguageAdapter, ObjectiveCLanguageAdapter, PhpLanguageAdapter, PowerShellLanguageAdapter, PythonLanguageAdapter, RLanguageAdapter, RubyLanguageAdapter, RustLanguageAdapter, ScalaLanguageAdapter, ShellLanguageAdapter, SolidityLanguageAdapter, SqlLanguageAdapter, SwiftLanguageAdapter, TsJsLanguageAdapter

        return cls((CSharpLanguageAdapter(), DartLanguageAdapter(), GoLanguageAdapter(), JavaLanguageAdapter(), KotlinLanguageAdapter(), ObjectiveCLanguageAdapter(), PhpLanguageAdapter(), PythonLanguageAdapter(), RubyLanguageAdapter(), RustLanguageAdapter(), SwiftLanguageAdapter(), TsJsLanguageAdapter(ts_js_bridge_factory), ScalaLanguageAdapter(), ElixirLanguageAdapter(), ClojureLanguageAdapter(), CLanguageAdapter(), CppLanguageAdapter(), ShellLanguageAdapter(), PowerShellLanguageAdapter(), SqlLanguageAdapter(), LuaLanguageAdapter(), RLanguageAdapter(), HaskellLanguageAdapter(), SolidityLanguageAdapter()))

    def register(self, analyzer: LanguageAnalyzer) -> None:
        if any(existing.language == analyzer.language for existing in self._analyzers):
            raise ValueError(f"analyzer already registered: {analyzer.language}")
        self._analyzers.append(analyzer)
        self._analyzers.sort(key=lambda item: item.language)

    def resolve(self, language: str) -> LanguageAnalyzer | None:
        return next((item for item in self._analyzers if item.supports(language)), None)

    def languages(self) -> tuple[str, ...]:
        return tuple(item.language for item in self._analyzers)

    def capabilities(self, language: str) -> AnalyzerCapability | None:
        analyzer = self.resolve(language)
        return analyzer.capabilities() if analyzer else None

    def analyze(
        self, language: str, workspace: Path, include_files: Sequence[str] | None
    ) -> CanonicalAnalyzerResult:
        analyzer = self.resolve(language)
        if analyzer is None:
            return CanonicalAnalyzerResult(
                language=language,
                status=ANALYZER_UNSUPPORTED,
                capabilities=AnalyzerCapability(),
                coverage_limitations=(f"no semantic analyzer registered for {language}",),
            )
        try:
            return analyzer.analyze(workspace, include_files)
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception as exc:
            return CanonicalAnalyzerResult(
                language=language,
                status=ANALYZER_FAILED,
                capabilities=analyzer.capabilities(),
                coverage_limitations=(f"analyzer execution failed: {type(exc).__name__}",),
            )
