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


def test_engineering_rule_corpus_is_grouped_by_lifecycle() -> None:
    rules = PROJECT_ROOT / "tools" / "legal" / "corpus" / "engineering_rules"

    # Only the EngineeringRule contract remains: authoring is the Legal Preparation agent's,
    # and there is no compiler, cache, precompiled registry or assessment-time service.
    assert _dirs(rules) == {"contract"}
    assert _py(rules) == set()
    assert _py(rules / "contract") == {
        "models.py",
        "legal_reasoning_contract.py",
        "runtime_projection.py",
        "validator.py",
    }


def _assert_import_blocked(module_name: str) -> None:
    try:
        importlib.import_module(module_name)
    except ModuleNotFoundError:
        return
    raise AssertionError(f"legacy import unexpectedly resolved: {module_name}")


def test_canonical_engineering_rule_imports_resolve() -> None:
    for module_name in (
        "tools.legal.corpus.engineering_rules.contract.models",
    ):
        assert importlib.import_module(module_name) is not None
    for retired in (
        "tools.legal.corpus.engineering_rules.compilation.compiler",
        "tools.legal.corpus.engineering_rules.registry.precompiled_registry",
        "tools.legal.corpus.engineering_rules.orchestration.service",
    ):
        _assert_import_blocked(retired)


def test_moved_lifecycle_relative_imports_are_not_supported() -> None:
    for module_name in (
        "tools.legal.corpus.engineering_rules.registry.models",
        "tools.legal.corpus.engineering_rules.compilation.models",
    ):
        _assert_import_blocked(module_name)


def test_legacy_engineering_rule_relative_imports_are_not_supported() -> None:
    _assert_import_blocked("tools.legal.engineering_rules.registry.models")
