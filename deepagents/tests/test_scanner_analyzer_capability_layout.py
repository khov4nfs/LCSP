from __future__ import annotations

import importlib
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))


def _dirs(path: Path) -> set[str]:
    return {
        item.name
        for item in path.iterdir()
        if item.is_dir() and item.name != "__pycache__"
    }


def _py(path: Path) -> set[str]:
    return {
        item.name
        for item in path.iterdir()
        if item.is_file() and item.suffix == ".py" and item.name != "__init__.py"
    }


def test_scanner_analyzers_are_grouped_by_capability() -> None:
    root = PROJECT_ROOT / "tools" / "common" / "capabilities" / "evidence" / "scanner" / "analyzers"

    assert _dirs(root) == {
        "ai_invocation",
        "decision_flow",
        "findings",
        "human_review",
        "python_analysis",
    }
    assert _py(root) == set()
    assert _py(root / "ai_invocation") == {
        "ai_invocation_detector.py",
        "ai_pattern_rules.py",
    }
    assert _py(root / "decision_flow") == {
        "decision_flow_tracer.py",
        "decision_patterns.py",
    }
    assert _py(root / "findings") == {
        "confidence_calculator.py",
        "finding_deduplicator.py",
        "finding_types.py",
        "signal_fuser.py",
    }
    assert _py(root / "human_review") == {"human_review_detector.py"}
    assert _py(root / "python_analysis") == {
        "level_guard.py",
        "python_analyzer.py",
        "python_ast.py",
    }


def _assert_import_blocked(module_name: str) -> None:
    try:
        importlib.import_module(module_name)
    except ModuleNotFoundError:
        return
    raise AssertionError(f"legacy import unexpectedly resolved: {module_name}")


def test_flat_analyzer_imports_are_not_supported() -> None:
    for module_name in (
        "tools.common.capabilities.evidence.scanner.analyzers.ai_invocation_detector",
        "tools.common.capabilities.evidence.scanner.analyzers.decision_flow_tracer",
        "tools.common.capabilities.evidence.scanner.analyzers.finding_types",
        "tools.common.capabilities.evidence.scanner.analyzers.python_analyzer",
    ):
        _assert_import_blocked(module_name)


def test_moved_ai_detector_resolves_cross_capability_relative_imports() -> None:
    module = importlib.import_module(
        "tools.common.capabilities.evidence.scanner.analyzers.ai_invocation.ai_invocation_detector"
    )
    assert module.AIInvocationDetector.__name__ == "AIInvocationDetector"


def test_legacy_tools_scanner_analyzer_import_still_resolves() -> None:
    module = importlib.import_module("tools.common.capabilities.evidence.scanner.analyzers.python_analysis.python_analyzer")
    assert module.PythonAnalyzer.__name__ == "PythonAnalyzer"
