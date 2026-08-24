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
    tools = PROJECT_ROOT / "runtime" / "evidence" / "scanner" / "tools"

    assert _dirs(tools) == {"common", "deptry", "knip", "semgrep", "syft"}
    assert _py(tools) == set()
    assert _py(tools / "common") == {"tool_base.py"}
    assert _py(tools / "deptry") == {"deptry_tool.py"}
    assert _py(tools / "knip") == {"knip_tool.py"}
    assert _py(tools / "semgrep") == {"semgrep_tool.py"}
    assert _py(tools / "syft") == {"syft_tool.py"}


def _assert_alias(legacy: str, canonical: str) -> None:
    legacy_module = importlib.import_module(legacy)
    canonical_module = importlib.import_module(canonical)
    assert Path(str(legacy_module.__file__)).resolve() == Path(
        str(canonical_module.__file__)
    ).resolve()


def test_flat_scanner_tool_imports_route_to_tool_packages() -> None:
    _assert_alias(
        "runtime.evidence.scanner.tools.tool_base",
        "runtime.evidence.scanner.tools.common.tool_base",
    )
    _assert_alias(
        "runtime.evidence.scanner.tools.deptry_tool",
        "runtime.evidence.scanner.tools.deptry.deptry_tool",
    )
    _assert_alias(
        "runtime.evidence.scanner.tools.knip_tool",
        "runtime.evidence.scanner.tools.knip.knip_tool",
    )
    _assert_alias(
        "runtime.evidence.scanner.tools.semgrep_tool",
        "runtime.evidence.scanner.tools.semgrep.semgrep_tool",
    )
    _assert_alias(
        "runtime.evidence.scanner.tools.syft_tool",
        "runtime.evidence.scanner.tools.syft.syft_tool",
    )
