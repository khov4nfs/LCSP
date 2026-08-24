from __future__ import annotations

from pathlib import Path

from .python_analyzer import PythonAnalyzer, PythonAnalysisResult


class PythonAstAnalyzer:
    """Compatibility wrapper for existing scanner analyzer tests."""

    def __init__(self, workspace: str | Path) -> None:
        self._analyzer = PythonAnalyzer(workspace)

    def analyze(self) -> PythonAnalysisResult:
        return self._analyzer.analyze()

