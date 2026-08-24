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
    rules = PROJECT_ROOT / "runtime" / "legal" / "corpus" / "engineering_rules"

    assert _dirs(rules) == {"contract", "compilation", "registry", "orchestration"}
    assert _py(rules) == set()
    assert _py(rules / "contract") == {
        "models.py",
        "legal_reasoning_contract.py",
        "validator.py",
    }
    assert _py(rules / "compilation") == {
        "chunk_triage.py",
        "compiler.py",
        "fingerprint.py",
    }
    assert _py(rules / "registry") == {
        "cache.py",
        "precompiled_contract_overrides.py",
        "precompiled_registry.py",
    }
    assert _py(rules / "orchestration") == {"service.py"}


def _assert_alias(legacy: str, canonical: str) -> None:
    legacy_module = importlib.import_module(legacy)
    canonical_module = importlib.import_module(canonical)
    assert Path(str(legacy_module.__file__)).resolve() == Path(
        str(canonical_module.__file__)
    ).resolve()


def test_flat_engineering_rule_imports_route_to_lifecycle_packages() -> None:
    _assert_alias(
        "runtime.legal.corpus.engineering_rules.models",
        "runtime.legal.corpus.engineering_rules.contract.models",
    )
    _assert_alias(
        "runtime.legal.corpus.engineering_rules.compiler",
        "runtime.legal.corpus.engineering_rules.compilation.compiler",
    )
    _assert_alias(
        "runtime.legal.corpus.engineering_rules.precompiled_registry",
        "runtime.legal.corpus.engineering_rules.registry.precompiled_registry",
    )
    _assert_alias(
        "runtime.legal.corpus.engineering_rules.service",
        "runtime.legal.corpus.engineering_rules.orchestration.service",
    )


def test_moved_lifecycle_relative_imports_route_to_contract_owner() -> None:
    _assert_alias(
        "runtime.legal.corpus.engineering_rules.registry.models",
        "runtime.legal.corpus.engineering_rules.contract.models",
    )
    _assert_alias(
        "runtime.legal.corpus.engineering_rules.compilation.models",
        "runtime.legal.corpus.engineering_rules.contract.models",
    )


def test_legacy_engineering_rule_relative_imports_route_to_contract_owner() -> None:
    legacy = importlib.import_module("tools.legal.legal.engineering_rules.registry.models")
    canonical = importlib.import_module(
        "runtime.legal.corpus.engineering_rules.contract.models"
    )
    assert Path(str(legacy.__file__)).resolve() == Path(
        str(canonical.__file__)
    ).resolve()
    assert legacy.EngineeringRule.__name__ == "EngineeringRule"
