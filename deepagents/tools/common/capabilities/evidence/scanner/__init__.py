"""Scanner runtime grouped by owned scanning capabilities."""

from __future__ import annotations

from typing import Any

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
        from .snapshot.snapshot_service_client import (
            SnapshotArchiveRequest,
            SnapshotServiceClient,
        )

        return {
            "SnapshotArchiveRequest": SnapshotArchiveRequest,
            "SnapshotServiceClient": SnapshotServiceClient,
        }[name]
    if name == "ScannerWorker":
        from .scanning.worker import ScannerWorker

        return ScannerWorker
    if name in {
        "ArchiveMaterializationError",
        "MaterializationResult",
        "ScannerWorkspace",
    }:
        from .snapshot.workspace import (
            ArchiveMaterializationError,
            MaterializationResult,
            ScannerWorkspace,
        )

        return {
            "ArchiveMaterializationError": ArchiveMaterializationError,
            "MaterializationResult": MaterializationResult,
            "ScannerWorkspace": ScannerWorkspace,
        }[name]
    raise AttributeError(name)
