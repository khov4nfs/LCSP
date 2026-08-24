"""Scanner analyzers grouped by analysis capability."""
from __future__ import annotations

import importlib.abc
import importlib.util
import sys
from pathlib import Path
from typing import Final

_CAPABILITY_MODULES: Final[dict[str, frozenset[str]]] = {
    "ai_invocation": frozenset({"ai_invocation_detector", "ai_pattern_rules"}),
    "decision_flow": frozenset({"decision_flow_tracer", "decision_patterns"}),
    "findings": frozenset(
        {
            "confidence_calculator",
            "finding_deduplicator",
            "finding_types",
            "signal_fuser",
        }
    ),
    "human_review": frozenset({"human_review_detector"}),
    "python_analysis": frozenset({"level_guard", "python_analyzer", "python_ast"}),
}
_PREFIX = f"{__name__}."
_PHYSICAL_ROOT = Path(__file__).resolve().parent


def _owner(module: str) -> str | None:
    for capability, modules in _CAPABILITY_MODULES.items():
        if module in modules:
            return capability
    return None


def _physical_analyzer_path(fullname: str) -> Path | None:
    if not fullname.startswith(_PREFIX):
        return None
    parts = fullname[len(_PREFIX) :].split(".")
    if not parts:
        return None

    head = parts[0]
    if head in _CAPABILITY_MODULES:
        if len(parts) < 2:
            return None
        nested = parts[1]
        owner = _owner(nested)
        if owner is None or owner == head:
            return None
        return _PHYSICAL_ROOT / owner / f"{nested}.py"

    owner = _owner(head)
    if owner is None:
        return None
    return _PHYSICAL_ROOT / owner / f"{head}.py"


class _AnalyzerCapabilityAliasFinder(importlib.abc.MetaPathFinder):
    """Route flat and moved-relative analyzer imports to physical owners."""

    def find_spec(self, fullname: str, path=None, target=None):  # type: ignore[override]
        module_path = _physical_analyzer_path(fullname)
        if module_path is None or not module_path.is_file():
            return None
        return importlib.util.spec_from_file_location(fullname, module_path)


if not any(
    isinstance(finder, _AnalyzerCapabilityAliasFinder) for finder in sys.meta_path
):
    sys.meta_path.insert(0, _AnalyzerCapabilityAliasFinder())

from .ai_invocation.ai_invocation_detector import AIInvocationDetector, TechnicalFinding
from .python_analysis.python_analyzer import AiCallSite, PythonAnalysisResult, PythonAnalyzer

__all__ = [
    "AIInvocationDetector",
    "AiCallSite",
    "PythonAnalysisResult",
    "PythonAnalyzer",
    "TechnicalFinding",
]
