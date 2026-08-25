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


def test_scanner_tools_are_grouped_by_tool_name() -> None:
    tools = PROJECT_ROOT / "tools" / "common" / "capabilities" / "evidence" / "scanner" / "tools"

    assert _dirs(tools) == {"common", "deptry", "knip", "semgrep", "syft"}
    assert _py(tools) == set()
    assert _py(tools / "common") == {"tool_base.py"}
    assert _py(tools / "deptry") == {"deptry_tool.py"}
    assert _py(tools / "knip") == {"knip_tool.py"}
    assert _py(tools / "semgrep") == {"semgrep_tool.py"}
    assert _py(tools / "syft") == {"syft_tool.py"}


def _assert_import_blocked(module_name: str) -> None:
    try:
        importlib.import_module(module_name)
    except ModuleNotFoundError:
        return
    raise AssertionError(f"legacy import unexpectedly resolved: {module_name}")


def test_flat_scanner_tool_imports_are_not_supported() -> None:
    for module_name in (
        "tools.common.capabilities.evidence.scanner.tools.tool_base",
        "tools.common.capabilities.evidence.scanner.tools.deptry_tool",
        "tools.common.capabilities.evidence.scanner.tools.knip_tool",
        "tools.common.capabilities.evidence.scanner.tools.semgrep_tool",
        "tools.common.capabilities.evidence.scanner.tools.syft_tool",
    ):
        _assert_import_blocked(module_name)
