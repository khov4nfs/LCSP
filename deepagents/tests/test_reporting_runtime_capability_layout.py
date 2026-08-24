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


def test_reporting_runtime_is_grouped_by_capability() -> None:
    report = PROJECT_ROOT / "runtime" / "reporting" / "report"

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


def _assert_alias(legacy: str, canonical: str) -> None:
    legacy_module = importlib.import_module(legacy)
    canonical_module = importlib.import_module(canonical)
    assert Path(str(legacy_module.__file__)).resolve() == Path(
        str(canonical_module.__file__)
    ).resolve()


def test_flat_reporting_imports_route_to_owner_packages() -> None:
    _assert_alias(
        "runtime.reporting.report.final_report_boundary",
        "runtime.reporting.report.final_report.final_report_boundary",
    )
    _assert_alias(
        "runtime.reporting.report.audit_export_boundary",
        "runtime.reporting.report.audit_export.audit_export_boundary",
    )
    _assert_alias(
        "runtime.reporting.report.classification_data_projection",
        "runtime.reporting.report.projection.classification_data_projection",
    )
    _assert_alias(
        "runtime.reporting.report.storage_uploader",
        "runtime.reporting.report.delivery.storage_uploader",
    )
