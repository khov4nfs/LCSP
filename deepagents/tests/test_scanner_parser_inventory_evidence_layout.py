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


def test_scanner_parsers_are_grouped_by_strategy() -> None:
    root = PROJECT_ROOT / "runtime" / "evidence" / "scanner" / "parsers"
    assert _dirs(root) == {"python", "structural"}
    assert _py(root) == set()
    assert _py(root / "python") == {"python_ast_parser.py", "python_cst_parser.py"}
    assert _py(root / "structural") == {
        "structural_augmentor.py",
        "structural_types.py",
        "tree_sitter_parser.py",
    }


def test_scanner_inventory_is_grouped_by_capability() -> None:
    root = PROJECT_ROOT / "runtime" / "evidence" / "scanner" / "inventory"
    assert _dirs(root) == {"language", "manifest"}
    assert _py(root) == set()
    assert _py(root / "language") == {
        "analyzer_router.py",
        "language_classifier.py",
        "language_types.py",
    }
    assert _py(root / "manifest") == {
        "manifest_parser.py",
        "manifest_rules.py",
        "manifest_types.py",
    }


def test_scanner_evidence_is_grouped_by_processing_capability() -> None:
    root = PROJECT_ROOT / "runtime" / "evidence" / "scanner" / "evidence"
    assert _dirs(root) == {"contract", "quality", "finalization"}
    assert _py(root) == set()
    assert _py(root / "contract") == {"models.py", "schema_validator.py"}
    assert _py(root / "quality") == {
        "privacy_gate.py",
        "quality_gate.py",
        "severity_mapper.py",
    }
    assert _py(root / "finalization") == {"terminal_state_handler.py"}


def _assert_alias(legacy: str, canonical: str) -> None:
    legacy_module = importlib.import_module(legacy)
    canonical_module = importlib.import_module(canonical)
    assert Path(str(legacy_module.__file__)).resolve() == Path(
        str(canonical_module.__file__)
    ).resolve()


def test_flat_parser_inventory_and_evidence_imports_route_to_owners() -> None:
    _assert_alias(
        "runtime.evidence.scanner.parsers.python_ast_parser",
        "runtime.evidence.scanner.parsers.python.python_ast_parser",
    )
    _assert_alias(
        "runtime.evidence.scanner.parsers.tree_sitter_parser",
        "runtime.evidence.scanner.parsers.structural.tree_sitter_parser",
    )
    _assert_alias(
        "runtime.evidence.scanner.inventory.language_classifier",
        "runtime.evidence.scanner.inventory.language.language_classifier",
    )
    _assert_alias(
        "runtime.evidence.scanner.inventory.manifest_parser",
        "runtime.evidence.scanner.inventory.manifest.manifest_parser",
    )
    _assert_alias(
        "runtime.evidence.scanner.evidence.quality_gate",
        "runtime.evidence.scanner.evidence.quality.quality_gate",
    )
    _assert_alias(
        "runtime.evidence.scanner.evidence.terminal_state_handler",
        "runtime.evidence.scanner.evidence.finalization.terminal_state_handler",
    )


def test_legacy_tools_parser_import_still_resolves() -> None:
    module = importlib.import_module("tools.graph.scanner.parsers.python_ast_parser")
    assert module.PythonAstParser.__name__ == "PythonAstParser"
