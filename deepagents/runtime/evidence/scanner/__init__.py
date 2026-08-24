"""Scanner runtime grouped by owned scanning capabilities."""
from __future__ import annotations

import importlib.abc
import importlib.util
import sys
from typing import Any, Final

_CAPABILITY_MODULES: Final[dict[str, frozenset[str]]] = {
    "scanning": frozenset({"scan_boundary", "targeted_reanalysis_boundary", "worker"}),
    "snapshot": frozenset({"snapshot_service_client", "workspace"}),
    "assembly": frozenset({"evidence_assembler"}),
    "toolchain": frozenset({"tool_registry", "toolchain_execution"}),
}
_ROOT_PACKAGES: Final[frozenset[str]] = frozenset(
    {
        "analyzers",
        "dependencies",
        "evidence",
        "inventory",
        "parsers",
        "rulesets",
        "tools",
        "ts_js_bridge",
    }
)
_PREFIX = f"{__name__}."


def _owner(module: str) -> str | None:
    for capability, modules in _CAPABILITY_MODULES.items():
        if module in modules:
            return capability
    return None


def _graph_target(tail: list[str]) -> str:
    suffix = ".".join(tail)
    return f"runtime.evidence.graph.{suffix}" if suffix else "runtime.evidence.graph"


def _canonical_scanner_name(fullname: str) -> str | None:
    if not fullname.startswith(_PREFIX):
        return None
    parts = fullname[len(_PREFIX) :].split(".")
    if not parts:
        return None

    if parts[0] == "program_graph":
        return _graph_target(parts[1:])

    if parts[0] in _CAPABILITY_MODULES:
        if len(parts) < 2:
            return None
        nested = parts[1]
        tail = parts[2:]
        if nested == "program_graph":
            return _graph_target(tail)
        if nested in _ROOT_PACKAGES:
            suffix = ".".join(tail)
            target = f"{_PREFIX}{nested}"
            return f"{target}.{suffix}" if suffix else target
        owner = _owner(nested)
        if owner is not None and owner != parts[0]:
            target = f"{_PREFIX}{owner}.{nested}"
            suffix = ".".join(tail)
            return f"{target}.{suffix}" if suffix else target
        return None

    if parts[0] in _ROOT_PACKAGES:
        return None

    owner = _owner(parts[0])
    if owner is None:
        return None
    target = f"{_PREFIX}{owner}.{parts[0]}"
    suffix = ".".join(parts[1:])
    return f"{target}.{suffix}" if suffix else target


class _ScannerCapabilityAliasFinder(importlib.abc.MetaPathFinder):
    """Route flat and moved-relative scanner imports to canonical owners."""

    def find_spec(self, fullname: str, path=None, target=None):  # type: ignore[override]
        canonical = _canonical_scanner_name(fullname)
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


if not any(isinstance(finder, _ScannerCapabilityAliasFinder) for finder in sys.meta_path):
    sys.meta_path.insert(0, _ScannerCapabilityAliasFinder())

__all__ = [
    "ScanBoundary",
    "TargetedReanalysisBoundary",
    "SnapshotArchiveRequest",
    "SnapshotServiceClient",
    "ScannerWorker",
    "ArchiveMaterializationError",
    "MaterializationResult",
    "ScannerWorkspace",
]


def __getattr__(name: str) -> Any:
    if name == "ScanBoundary":
        from .scanning.scan_boundary import ScanBoundary
        return ScanBoundary
    if name == "TargetedReanalysisBoundary":
        from .scanning.targeted_reanalysis_boundary import TargetedReanalysisBoundary
        return TargetedReanalysisBoundary
    if name in {"SnapshotArchiveRequest", "SnapshotServiceClient"}:
        from .snapshot.snapshot_service_client import SnapshotArchiveRequest, SnapshotServiceClient
        return {"SnapshotArchiveRequest": SnapshotArchiveRequest, "SnapshotServiceClient": SnapshotServiceClient}[name]
    if name == "ScannerWorker":
        from .scanning.worker import ScannerWorker
        return ScannerWorker
    if name in {"ArchiveMaterializationError", "MaterializationResult", "ScannerWorkspace"}:
        from .snapshot.workspace import ArchiveMaterializationError, MaterializationResult, ScannerWorkspace
        return {"ArchiveMaterializationError": ArchiveMaterializationError, "MaterializationResult": MaterializationResult, "ScannerWorkspace": ScannerWorkspace}[name]
    raise AttributeError(name)
