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


def test_graph_resolution_is_grouped_by_capability() -> None:
    resolution = (
        PROJECT_ROOT
        / "tools"
        / "common"
        / "capabilities"
        / "evidence"
        / "graph"
        / "resolution"
    )

    assert _dirs(resolution) == {"boundary", "framework", "architecture", "dispatch"}
    assert _py(resolution) == set()
    assert _py(resolution / "boundary") == {
        "api_boundary_resolution.py",
        "python_agent_boundary_resolution.py",
    }
    assert _py(resolution / "framework") == {
        "framework_boundary_finalizer.py",
        "framework_links.py",
        "framework_metadata.py",
        "framework_resolution.py",
        "python_framework_adapters.py",
    }
    assert _py(resolution / "architecture") == {
        "javascript_architecture_resolution.py",
        "managed_architecture_resolution.py",
        "python_architecture_resolution.py",
        "redux_extended_resolution.py",
    }
    assert _py(resolution / "dispatch") == {
        "generic_dispatch_resolution.py",
        "protocol_resolution.py",
    }


def _assert_importable(module_name: str) -> None:
    assert importlib.import_module(module_name).__file__


def _assert_removed(module_name: str) -> None:
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module(module_name)


def test_flat_graph_resolution_imports_are_removed() -> None:
    _assert_removed("tools.common.capabilities.evidence.graph.resolution.api_boundary_resolution")
    _assert_removed("tools.common.capabilities.evidence.graph.resolution.framework_links")
    _assert_removed("tools.common.capabilities.evidence.graph.resolution.python_architecture_resolution")
    _assert_removed("tools.common.capabilities.evidence.graph.resolution.generic_dispatch_resolution")

    _assert_importable("tools.common.capabilities.evidence.graph.resolution.boundary.api_boundary_resolution")
    _assert_importable("tools.common.capabilities.evidence.graph.resolution.framework.framework_links")
    _assert_importable(
        "tools.common.capabilities.evidence.graph.resolution.architecture.python_architecture_resolution"
    )
    _assert_importable("tools.common.capabilities.evidence.graph.resolution.dispatch.generic_dispatch_resolution")


def test_resolution_relative_graph_schema_import_alias_is_removed() -> None:
    _assert_removed("tools.common.capabilities.evidence.graph.resolution.architecture.models")
    _assert_importable("tools.common.capabilities.evidence.graph.schema.models")
