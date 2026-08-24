"""Reporting runtime grouped by owned report capabilities."""
from __future__ import annotations

import importlib.abc
import importlib.util
import sys
from typing import Final

_CAPABILITY_MODULES: Final[dict[str, frozenset[str]]] = {
    "audit_export": frozenset({"audit_export_boundary", "audit_export_generator"}),
    "final_report": frozenset(
        {"final_report_boundary", "final_report_generator", "output_guardrail"}
    ),
    "projection": frozenset({"classification_data_projection"}),
    "delivery": frozenset({"document_runtime_client", "storage_uploader"}),
}
_PREFIX = f"{__name__}."


def _owner(module: str) -> str | None:
    for capability, modules in _CAPABILITY_MODULES.items():
        if module in modules:
            return capability
    return None


def _canonical_report_name(fullname: str) -> str | None:
    if not fullname.startswith(_PREFIX):
        return None
    parts = fullname[len(_PREFIX) :].split(".")
    if not parts or parts[0] == "dossiers":
        return None
    if parts[0] in _CAPABILITY_MODULES:
        if len(parts) >= 2:
            owner = _owner(parts[1])
            if owner is not None and owner != parts[0]:
                target = f"{_PREFIX}{owner}.{parts[1]}"
                tail = ".".join(parts[2:])
                return f"{target}.{tail}" if tail else target
        return None
    owner = _owner(parts[0])
    if owner is None:
        return None
    target = f"{_PREFIX}{owner}.{parts[0]}"
    tail = ".".join(parts[1:])
    return f"{target}.{tail}" if tail else target


class _ReportingCapabilityAliasFinder(importlib.abc.MetaPathFinder):
    """Route migration-era flat reporting imports to capability packages."""

    def find_spec(self, fullname: str, path=None, target=None):  # type: ignore[override]
        canonical = _canonical_report_name(fullname)
        if canonical is None or canonical == fullname:
            return None
        spec = importlib.util.find_spec(canonical)
        if spec is None or spec.origin is None:
            return None
        locations = spec.submodule_search_locations
        return importlib.util.spec_from_file_location(
            fullname,
            spec.origin,
            submodule_search_locations=list(locations) if locations is not None else None,
        )


if not any(isinstance(finder, _ReportingCapabilityAliasFinder) for finder in sys.meta_path):
    sys.meta_path.insert(0, _ReportingCapabilityAliasFinder())
