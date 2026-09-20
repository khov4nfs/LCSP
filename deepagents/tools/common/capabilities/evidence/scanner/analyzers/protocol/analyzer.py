"""Stable boundary between language-specific analyzers and scanner orchestration."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol, Sequence


ANALYZER_SUCCESS = "SUCCESS"
ANALYZER_PARTIAL = "PARTIAL"
ANALYZER_FAILED = "FAILED"
ANALYZER_UNSUPPORTED = "UNSUPPORTED"


@dataclass(frozen=True)
class AnalyzerCapability:
    """Explicit extraction capabilities; false means the adapter does not claim it."""

    symbols: bool = False
    imports: bool = False
    calls: bool = False
    ai_invocations: bool = False
    framework_semantics: bool = False
    dependencies: bool = False
    dynamic_resolution: bool = False


@dataclass(frozen=True)
class CanonicalAnalyzerResult:
    """Normalized execution envelope while retaining the native result for compatibility."""

    language: str
    status: str
    capabilities: AnalyzerCapability
    native_result: Any = None
    files_analyzed: int = 0
    files_skipped: int = 0
    coverage_limitations: tuple[str, ...] = field(default_factory=tuple)
    unsupported_dynamic_flows: tuple[Any, ...] = field(default_factory=tuple)
    findings: tuple[Any, ...] = field(default_factory=tuple)
    semantic_facts: tuple[Any, ...] = field(default_factory=tuple)
    structural_facts: tuple[Any, ...] = field(default_factory=tuple)
    import_map: dict[str, str] = field(default_factory=dict)
    dependencies: tuple[Any, ...] = field(default_factory=tuple)
    execution: Any = None


class LanguageAnalyzer(Protocol):
    """Protocol implemented by each semantic language adapter."""

    language: str

    def supports(self, language: str) -> bool: ...

    def capabilities(self) -> AnalyzerCapability: ...

    def analyze(
        self, workspace: Path, include_files: Sequence[str] | None
    ) -> CanonicalAnalyzerResult: ...
