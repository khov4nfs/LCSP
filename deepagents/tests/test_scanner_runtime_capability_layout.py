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


def test_scanner_root_only_contains_capability_packages() -> None:
    scanner = PROJECT_ROOT / "runtime" / "evidence" / "scanner"

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


def _assert_alias(legacy: str, canonical: str) -> None:
    legacy_module = importlib.import_module(legacy)
    canonical_module = importlib.import_module(canonical)
    assert Path(str(legacy_module.__file__)).resolve() == Path(
        str(canonical_module.__file__)
    ).resolve()


def test_flat_scanner_imports_route_to_capability_packages() -> None:
    _assert_alias(
        "runtime.evidence.scanner.workspace",
        "runtime.evidence.scanner.snapshot.workspace",
    )
    _assert_alias(
        "runtime.evidence.scanner.toolchain_execution",
        "runtime.evidence.scanner.toolchain.toolchain_execution",
    )
    _assert_alias(
        "runtime.evidence.scanner.evidence_assembler",
        "runtime.evidence.scanner.assembly.evidence_assembler",
    )
    _assert_alias(
        "runtime.evidence.scanner.scan_boundary",
        "runtime.evidence.scanner.scanning.scan_boundary",
    )


def test_scanner_program_graph_alias_points_to_canonical_evidence_graph() -> None:
    legacy = importlib.import_module("runtime.evidence.scanner.program_graph.models")
    canonical = importlib.import_module("runtime.evidence.graph.schema.models")
    assert Path(str(legacy.__file__)).resolve() == Path(
        str(canonical.__file__)
    ).resolve()
