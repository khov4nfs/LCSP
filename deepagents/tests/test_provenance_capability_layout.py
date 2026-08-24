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


def test_provenance_runtime_is_grouped_by_owner_capability() -> None:
    provenance = PROJECT_ROOT / "runtime" / "evidence" / "provenance"

    assert _dirs(provenance) == {"governance", "dispatch", "entrypoints"}
    assert _py(provenance) == set()
    assert _py(provenance / "governance") == {
        "authorization.py",
        "catalog.py",
        "registry.py",
        "resolver.py",
    }
    assert _py(provenance / "dispatch") == {
        "dispatcher.py",
        "runtime_binding.py",
    }
    assert _py(provenance / "entrypoints") == {
        "tool_entrypoints.py",
        "program_graph_tool_entrypoints.py",
        "scanner_tool_entrypoints.py",
        "legal_tool_entrypoints.py",
        "remediation_tool_entrypoints.py",
    }


def _assert_same_file(alias: str, canonical: str) -> None:
    alias_module = importlib.import_module(alias)
    canonical_module = importlib.import_module(canonical)
    assert Path(str(alias_module.__file__)).resolve() == Path(
        str(canonical_module.__file__)
    ).resolve()


def test_flat_provenance_imports_route_to_owner_packages() -> None:
    _assert_same_file(
        "runtime.evidence.provenance.catalog",
        "runtime.evidence.provenance.governance.catalog",
    )
    _assert_same_file(
        "runtime.evidence.provenance.dispatcher",
        "runtime.evidence.provenance.dispatch.dispatcher",
    )
    _assert_same_file(
        "runtime.evidence.provenance.legal_tool_entrypoints",
        "runtime.evidence.provenance.entrypoints.legal_tool_entrypoints",
    )


def test_moved_relative_imports_route_across_provenance_owners() -> None:
    _assert_same_file(
        "runtime.evidence.provenance.dispatch.catalog",
        "runtime.evidence.provenance.governance.catalog",
    )
    _assert_same_file(
        "runtime.evidence.provenance.entrypoints.registry",
        "runtime.evidence.provenance.governance.registry",
    )


def test_legacy_agentic_evidence_imports_follow_provenance_owners() -> None:
    _assert_same_file(
        "tools.common.agentic_evidence.catalog",
        "runtime.evidence.provenance.governance.catalog",
    )
    _assert_same_file(
        "tools.common.agentic_evidence.dispatcher",
        "runtime.evidence.provenance.dispatch.dispatcher",
    )
