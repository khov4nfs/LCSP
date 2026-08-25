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


def test_scanner_root_only_contains_capability_packages() -> None:
    scanner = PROJECT_ROOT / "tools" / "common" / "capabilities" / "evidence" / "scanner"

    assert _dirs(scanner) == {
        "analyzers",
        "dependencies",
        "evidence",
        "inventory",
        "parsers",
        "rulesets",
        "tools",
        "ts_js_bridge",
        "scanning",
        "snapshot",
        "assembly",
        "toolchain",
    }
    assert _py(scanner) == set()
    assert _py(scanner / "scanning") == {
        "scan_boundary.py",
        "targeted_reanalysis_boundary.py",
        "worker.py",
    }
    assert _py(scanner / "snapshot") == {
        "snapshot_service_client.py",
        "workspace.py",
    }
    assert _py(scanner / "assembly") == {"evidence_assembler.py"}
    assert _py(scanner / "toolchain") == {
        "tool_registry.py",
        "toolchain_execution.py",
    }
    assert (scanner / "tools" / "syft-config.yaml").is_file()


def _assert_importable(module_name: str) -> None:
    assert importlib.import_module(module_name).__file__


def _assert_removed(module_name: str) -> None:
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module(module_name)


def test_flat_scanner_imports_are_removed() -> None:
    _assert_removed("tools.common.capabilities.evidence.scanner.workspace")
    _assert_removed("tools.common.capabilities.evidence.scanner.toolchain_execution")
    _assert_removed("tools.common.capabilities.evidence.scanner.evidence_assembler")
    _assert_removed("tools.common.capabilities.evidence.scanner.scan_boundary")

    _assert_importable("tools.common.capabilities.evidence.scanner.snapshot.workspace")
    _assert_importable("tools.common.capabilities.evidence.scanner.toolchain.toolchain_execution")
    _assert_importable("tools.common.capabilities.evidence.scanner.assembly.evidence_assembler")
    _assert_importable("tools.common.capabilities.evidence.scanner.scanning.scan_boundary")


def test_scanner_program_graph_alias_is_removed() -> None:
    _assert_removed("tools.common.capabilities.evidence.scanner.program_graph.models")
    _assert_importable("tools.common.capabilities.evidence.graph.schema.models")
