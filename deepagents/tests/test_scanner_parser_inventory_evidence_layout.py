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
    root = PROJECT_ROOT / "tools" / "common" / "capabilities" / "evidence" / "scanner" / "parsers"
    assert _dirs(root) == {"python", "structural"}
    assert _py(root) == set()
    assert _py(root / "python") == {"python_ast_parser.py", "python_cst_parser.py"}
    assert _py(root / "structural") == {
        "structural_augmentor.py",
        "structural_types.py",
        "tree_sitter_parser.py",
    }


def test_scanner_inventory_is_grouped_by_capability() -> None:
    root = PROJECT_ROOT / "tools" / "common" / "capabilities" / "evidence" / "scanner" / "inventory"
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
    root = PROJECT_ROOT / "tools" / "common" / "capabilities" / "evidence" / "scanner" / "evidence"
    assert _dirs(root) == {"contract", "quality", "finalization"}
    assert _py(root) == set()
    assert _py(root / "contract") == {"models.py", "schema_validator.py"}
    assert _py(root / "quality") == {
        "privacy_gate.py",
        "quality_gate.py",
        "severity_mapper.py",
    }
    assert _py(root / "finalization") == {"terminal_state_handler.py"}


def _assert_import_blocked(module_name: str) -> None:
    try:
        importlib.import_module(module_name)
    except ModuleNotFoundError:
        return
    raise AssertionError(f"legacy import unexpectedly resolved: {module_name}")


def test_flat_parser_inventory_and_evidence_imports_are_not_supported() -> None:
    for module_name in (
        "tools.common.capabilities.evidence.scanner.parsers.python_ast_parser",
        "tools.common.capabilities.evidence.scanner.parsers.tree_sitter_parser",
        "tools.common.capabilities.evidence.scanner.inventory.language_classifier",
        "tools.common.capabilities.evidence.scanner.inventory.manifest_parser",
        "tools.common.capabilities.evidence.scanner.evidence.quality_gate",
        "tools.common.capabilities.evidence.scanner.evidence.terminal_state_handler",
    ):
        _assert_import_blocked(module_name)


def test_legacy_tools_parser_import_still_resolves() -> None:
    module = importlib.import_module("tools.common.capabilities.evidence.scanner.parsers.python.python_ast_parser")
    assert module.PythonAstParser.__name__ == "PythonAstParser"
