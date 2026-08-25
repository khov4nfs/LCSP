from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest


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


def test_agentic_evidence_tools_are_grouped_by_owner_capability() -> None:
    provenance = PROJECT_ROOT / "tools" / "common" / "capabilities" / "agentic_evidence"

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


def _assert_importable(module_name: str) -> None:
    assert importlib.import_module(module_name).__file__


def _assert_removed(module_name: str) -> None:
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module(module_name)


def test_flat_provenance_imports_are_removed() -> None:
    _assert_removed("tools.common.capabilities.evidence.provenance.catalog")
    _assert_removed("tools.common.capabilities.evidence.provenance.dispatcher")
    _assert_removed("tools.common.capabilities.evidence.provenance.legal_tool_entrypoints")

    _assert_importable("tools.common.capabilities.agentic_evidence.governance.catalog")
    _assert_importable("tools.common.capabilities.agentic_evidence.dispatch.dispatcher")
    _assert_importable("tools.common.capabilities.agentic_evidence.entrypoints.legal_tool_entrypoints")


def test_moved_relative_provenance_import_aliases_are_removed() -> None:
    _assert_removed("tools.common.capabilities.evidence.provenance.dispatch.catalog")
    _assert_removed("tools.common.capabilities.evidence.provenance.entrypoints.registry")

    _assert_importable("tools.common.capabilities.agentic_evidence.governance.catalog")
    _assert_importable("tools.common.capabilities.agentic_evidence.governance.registry")


def test_agentic_evidence_imports_use_tools_namespace() -> None:
    _assert_importable("tools.common.capabilities.agentic_evidence.governance.catalog")
    _assert_importable("tools.common.capabilities.agentic_evidence.dispatch.dispatcher")
    _assert_removed("tools.common.capabilities.evidence.provenance.governance.catalog")
