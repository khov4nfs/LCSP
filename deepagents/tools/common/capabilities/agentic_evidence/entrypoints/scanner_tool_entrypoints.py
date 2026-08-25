"""Canonical same-name execution entrypoints for AO-1 scanner tools.

Every function in this module intentionally has the exact canonical tool name.
The functions are thin adapters only: they make runtime ownership discoverable
while preserving the existing scanner implementations and their tests.

This module deliberately avoids importing scanner boundary modules at
module-import time. ``scanner.__init__`` exports ``ScanBoundary`` eagerly, so
keeping scanner dependencies in the execution context (and lazy imports for
scanner-owned implementations) prevents a package initialization cycle.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping


@dataclass(frozen=True)
class ScannerToolExecutionContext:
    """Trusted local scanner dependencies used by AO-1 canonical entrypoints."""

    workspace: Any
    language_classifier: Any
    syft_tool: Any
    semgrep_tool: Any
    knip_tool: Any
    deptry_tool: Any
    ts_js_bridge_factory: Callable[[Path], Any]
    structural_augmentor: Any
    evidence_graph_assembler: Any


ScannerToolInput = Mapping[str, Any]


def _required(request: ScannerToolInput, name: str) -> Any:
    if name not in request:
        raise ValueError(f"scanner tool input missing required field: {name}")
    return request[name]


def _workspace_path(request: ScannerToolInput) -> Path:
    value = _required(request, "workspace_path")
    return value if isinstance(value, Path) else Path(str(value))


def materialize_snapshot(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
):
    """Materialize one trusted snapshot archive into the bounded scanner workspace."""
    return context.workspace.materialize(
        str(_required(request, "scan_job_id")),
        _required(request, "archive"),
        snapshot_id=str(_required(request, "snapshot_id")),
    )


def classify_workspace_languages(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
):
    """Classify files in one materialized workspace for analyzer routing."""
    return context.language_classifier.classify_workspace(_workspace_path(request))


def run_syft_inventory(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
):
    """Run the pinned Syft implementation over one trusted workspace."""
    return context.syft_tool.run(_workspace_path(request))


def run_semgrep_rules(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
):
    """Run the configured Semgrep rules over one trusted workspace."""
    include_files = request.get("include_files")
    if include_files is None:
        return context.semgrep_tool.run(_workspace_path(request))
    return context.semgrep_tool.run(
        _workspace_path(request),
        include_files=list(include_files),
    )


def run_knip_usage_analysis(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
):
    """Run Knip usage analysis through the existing Python wrapper."""
    return context.knip_tool.run(_workspace_path(request))


def run_deptry_usage_analysis(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
):
    """Run Deptry usage analysis through the existing Python wrapper."""
    return context.deptry_tool.run(_workspace_path(request))


def run_ts_js_semantic_analysis(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
):
    """Run the TS/JS semantic bridge for a bounded file set."""
    include_files = request.get("include_files")
    return asyncio.run(
        context.ts_js_bridge_factory(_workspace_path(request)).analyze(
            include_files=list(include_files) if include_files is not None else None
        )
    )


def run_python_semantic_analysis(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
):
    """Run Python semantic analysis for a bounded file set."""
    from tools.common.capabilities.evidence.scanner.analyzers.python_analysis.python_analyzer import PythonAnalyzer

    include_files = request.get("include_files")
    return PythonAnalyzer(_workspace_path(request)).analyze(
        include_files=list(include_files) if include_files is not None else None
    )


def run_structural_augmentation(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
):
    """Run structural augmentation through the existing deterministic augmentor."""
    return context.structural_augmentor.augment(
        files=list(_required(request, "files")),
        finding_ids=list(_required(request, "finding_ids")),
    )


def build_evidence_graph(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
):
    """Build the scanner evidence graph through its existing assembler."""
    return context.evidence_graph_assembler.assemble(
        scan_job_id=str(_required(request, "scan_job_id")),
        snapshot_id=str(_required(request, "snapshot_id")),
        commit_sha=str(request.get("commit_sha") or ""),
        workspace_path=_workspace_path(request),
        technical_findings=list(_required(request, "technical_findings")),
        structural_facts=list(request.get("structural_facts") or []),
        package_dependencies=list(request.get("package_dependencies") or []),
        coverage_notes=list(request.get("coverage_notes") or []),
    )


def validate_evidence_report(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
) -> dict[str, str]:
    """Run the scanner schema, privacy, and quality gates behind one tool boundary."""
    del context  # Validation is deterministic and does not require injected services.

    from tools.common.capabilities.evidence.scanner.evidence.quality.privacy_gate import assert_privacy_flags
    from tools.common.capabilities.evidence.scanner.evidence.quality.quality_gate import classify_quality
    from tools.common.capabilities.evidence.scanner.evidence.contract.schema_validator import validate_schema

    payload = dict(_required(request, "payload"))
    tool_provenance = list(_required(request, "tool_provenance"))

    validate_schema(payload, tool_provenance)
    assert_privacy_flags(payload)
    quality_state = classify_quality(
        list(payload.get("findings") or []),
        tool_provenance,
    )
    return {"quality_state": quality_state}
