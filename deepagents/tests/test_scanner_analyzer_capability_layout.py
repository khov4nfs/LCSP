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
    root = PROJECT_ROOT / "runtime" / "evidence" / "scanner" / "analyzers"

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


def _assert_alias(legacy: str, canonical: str) -> None:
    legacy_module = importlib.import_module(legacy)
    canonical_module = importlib.import_module(canonical)
    assert Path(str(legacy_module.__file__)).resolve() == Path(
        str(canonical_module.__file__)
    ).resolve()


def test_flat_analyzer_imports_route_to_capability_packages() -> None:
    _assert_alias(
        "runtime.evidence.scanner.analyzers.ai_invocation_detector",
        "runtime.evidence.scanner.analyzers.ai_invocation.ai_invocation_detector",
    )
    _assert_alias(
        "runtime.evidence.scanner.analyzers.decision_flow_tracer",
        "runtime.evidence.scanner.analyzers.decision_flow.decision_flow_tracer",
    )
    _assert_alias(
        "runtime.evidence.scanner.analyzers.finding_types",
        "runtime.evidence.scanner.analyzers.findings.finding_types",
    )
    _assert_alias(
        "runtime.evidence.scanner.analyzers.python_analyzer",
        "runtime.evidence.scanner.analyzers.python_analysis.python_analyzer",
    )


def test_moved_ai_detector_resolves_cross_capability_relative_imports() -> None:
    module = importlib.import_module(
        "runtime.evidence.scanner.analyzers.ai_invocation.ai_invocation_detector"
    )
    assert module.AIInvocationDetector.__name__ == "AIInvocationDetector"


def test_legacy_tools_scanner_analyzer_import_still_resolves() -> None:
    module = importlib.import_module("tools.graph.scanner.analyzers.python_analyzer")
    assert module.PythonAnalyzer.__name__ == "PythonAnalyzer"
