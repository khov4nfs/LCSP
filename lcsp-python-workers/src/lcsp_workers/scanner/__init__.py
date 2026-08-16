"""Scanner worker package with lazy public exports.

Scanner internals are imported by the canonical agentic runtime. Eagerly importing
`ScanConsumer` here creates a dispatcher -> program_graph -> scanner -> dispatcher
cycle, so package-level exports resolve lazily instead.
"""
from __future__ import annotations
from typing import Any

__all__ = [
    "ScanConsumer",
    "TargetedReanalysisConsumer",
    "SnapshotArchiveRequest",
    "SnapshotServiceClient",
    "ScannerWorker",
    "ArchiveMaterializationError",
    "MaterializationResult",
    "ScannerWorkspace",
]


def __getattr__(name: str) -> Any:
    if name == "ScanConsumer":
        from .scan_consumer import ScanConsumer
        return ScanConsumer
    if name == "TargetedReanalysisConsumer":
        from .targeted_reanalysis_consumer import TargetedReanalysisConsumer
        return TargetedReanalysisConsumer
    if name in {"SnapshotArchiveRequest", "SnapshotServiceClient"}:
        from .snapshot_service_client import SnapshotArchiveRequest, SnapshotServiceClient
        return {"SnapshotArchiveRequest": SnapshotArchiveRequest, "SnapshotServiceClient": SnapshotServiceClient}[name]
    if name == "ScannerWorker":
        from .worker import ScannerWorker
        return ScannerWorker
    if name in {"ArchiveMaterializationError", "MaterializationResult", "ScannerWorkspace"}:
        from .workspace import ArchiveMaterializationError, MaterializationResult, ScannerWorkspace
        return {"ArchiveMaterializationError": ArchiveMaterializationError, "MaterializationResult": MaterializationResult, "ScannerWorkspace": ScannerWorkspace}[name]
    raise AttributeError(name)
