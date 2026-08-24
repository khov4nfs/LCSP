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


def test_graph_construction_is_grouped_by_capability() -> None:
    root = PROJECT_ROOT / "runtime" / "evidence" / "graph" / "construction"
    assert _dirs(root) == {"assembly", "extraction", "validation"}
    assert _py(root) == set()
    assert _py(root / "assembly") == {"assembler.py", "builder.py"}
    assert _py(root / "extraction") == {"extractor.py", "source_evidence.py"}
    assert _py(root / "validation") == {"semantic_integrity.py", "validator.py"}


def test_graph_lineage_is_grouped_by_capability() -> None:
    root = PROJECT_ROOT / "runtime" / "evidence" / "graph" / "lineage"
    assert _dirs(root) == {"ai", "contract", "data", "sensitive", "decision"}
    assert _py(root) == set()
    assert _py(root / "ai") == {"ai_invocation_gate.py", "ai_lifecycle.py"}
    assert _py(root / "contract") == {"contract_flow.py", "contract_lineage.py"}
    assert _py(root / "data") == {"data_lineage.py", "database_lineage.py"}
    assert _py(root / "sensitive") == {"sensitive_data.py", "sensitive_lineage_gate.py"}
    assert _py(root / "decision") == {"decision_influence.py"}


def _assert_alias(legacy: str, canonical: str) -> None:
    legacy_module = importlib.import_module(legacy)
    canonical_module = importlib.import_module(canonical)
    assert Path(str(legacy_module.__file__)).resolve() == Path(
        str(canonical_module.__file__)
    ).resolve()


def test_flat_graph_construction_imports_route_to_owner_packages() -> None:
    _assert_alias(
        "runtime.evidence.graph.construction.builder",
        "runtime.evidence.graph.construction.assembly.builder",
    )
    _assert_alias(
        "runtime.evidence.graph.construction.extractor",
        "runtime.evidence.graph.construction.extraction.extractor",
    )
    _assert_alias(
        "runtime.evidence.graph.construction.validator",
        "runtime.evidence.graph.construction.validation.validator",
    )


def test_flat_graph_lineage_imports_route_to_owner_packages() -> None:
    _assert_alias(
        "runtime.evidence.graph.lineage.ai_lifecycle",
        "runtime.evidence.graph.lineage.ai.ai_lifecycle",
    )
    _assert_alias(
        "runtime.evidence.graph.lineage.contract_lineage",
        "runtime.evidence.graph.lineage.contract.contract_lineage",
    )
    _assert_alias(
        "runtime.evidence.graph.lineage.sensitive_lineage_gate",
        "runtime.evidence.graph.lineage.sensitive.sensitive_lineage_gate",
    )
