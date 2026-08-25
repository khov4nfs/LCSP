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


def test_reporting_tools_are_grouped_by_capability() -> None:
    report = PROJECT_ROOT / "tools" / "common" / "capabilities" / "reporting" / "report"

    assert _dirs(report) == {
        "audit_export",
        "final_report",
        "projection",
        "delivery",
        "dossiers",
    }
    assert _py(report) == set()
    assert _py(report / "audit_export") == {
        "audit_export_boundary.py",
        "audit_export_generator.py",
    }
    assert _py(report / "final_report") == {
        "final_report_boundary.py",
        "final_report_generator.py",
        "output_guardrail.py",
    }
    assert _py(report / "projection") == {"classification_data_projection.py"}
    assert _py(report / "delivery") == {
        "document_runtime_client.py",
        "storage_uploader.py",
    }


def _assert_import_blocked(module_name: str) -> None:
    try:
        importlib.import_module(module_name)
    except ModuleNotFoundError:
        return
    raise AssertionError(f"legacy import unexpectedly resolved: {module_name}")


def test_flat_reporting_imports_are_not_supported() -> None:
    for module_name in (
        "tools.common.capabilities.reporting.report.final_report_boundary",
        "tools.common.capabilities.reporting.report.audit_export_boundary",
        "tools.common.capabilities.reporting.report.classification_data_projection",
        "tools.common.capabilities.reporting.report.storage_uploader",
    ):
        _assert_import_blocked(module_name)
