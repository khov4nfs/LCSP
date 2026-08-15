from __future__ import annotations

from pathlib import Path
from typing import Iterable

from .graph_builder import EvidenceGraphBuilder
from .graph_serializer import ScanGraph

MAX_COVERAGE_REASON_LENGTH = 240


class EvidenceGraphAssembler:
    """Build the scan-local, sanitized graph persisted with an evidence report."""

    @staticmethod
    def _graph_safe_coverage_note(note: str) -> str:
        """Collapse a coverage note to one bounded line before graph persistence."""
        first_line = str(note).splitlines()[0].strip()
        if len(first_line) > MAX_COVERAGE_REASON_LENGTH:
            return f"{first_line[:MAX_COVERAGE_REASON_LENGTH]}... [truncated]"
        if first_line != str(note).strip():
            return f"{first_line}... [truncated]"
        return first_line

    def assemble(
        self,
        *,
        scan_job_id: str,
        snapshot_id: str,
        commit_sha: str,
        workspace_path: Path,
        technical_findings: Iterable[object],
        structural_facts: Iterable[object],
        package_dependencies: Iterable[object],
        coverage_notes: Iterable[str],
        config_hash: str = "",
    ) -> ScanGraph:
        """Join scan findings, code structure, packages, and coverage gaps into a graph.

        The graph is intentionally evidence-oriented rather than a raw code graph: it
        stores references, normalized labels, and bounded metadata so downstream legal
        or reconciliation logic can traverse relationships without receiving source.

        Args:
            scan_job_id: Scan job that owns the graph.
            snapshot_id: Immutable repository snapshot identifier.
            commit_sha: Commit pinned by the snapshot.
            workspace_path: Extracted workspace used only to normalize graph paths.
            technical_findings: AI invocation and technical evidence records.
            structural_facts: Parsed functions/classes/control structures linked to findings.
            package_dependencies: Normalized dependency evidence.
            coverage_notes: Explicit analysis limitations that become coverage-gap nodes.
            config_hash: Optional scanner configuration hash for graph provenance.

        Returns:
            A sanitized ``ScanGraph`` with provenance and stable evidence references.
        """
        builder = EvidenceGraphBuilder(
            str(workspace_path),
            scan_job_id=scan_job_id,
            repository_ref=f"snapshot:{snapshot_id}",
            snapshot_id=snapshot_id,
            commit_sha=commit_sha,
            tool_version="evidence-graph-assembler/1.0.0",
            config_hash=config_hash,
        )
        repo_id = builder.add_node("REPOSITORY", f"scan:{scan_job_id}")
        files: dict[str, str] = {}
        invocations: dict[str, str] = {}

        def file_node(path: str) -> str | None:
            """Return one deduplicated FILE node and attach it to the repository."""
            if path not in files:
                files[path] = builder.add_node("FILE", path, path)  # type: ignore[assignment]
                if repo_id and files[path]:
                    builder.add_edge("CONTAINS", repo_id, files[path])
            return files[path]

        for finding in technical_findings:
            finding_id = getattr(finding, "finding_id", "")
            path = getattr(finding, "file_path", "")
            label = getattr(finding, "finding_type", "AI_MODEL_INVOCATION")
            invocation = builder.add_node(
                "AI_MODEL_INVOCATION",
                label,
                path,
                getattr(finding, "line_number", None),
                attributes={"analysis_level": getattr(finding, "analysis_level", "")},
                finding_ids=[finding_id] if finding_id else [],
                evidence_refs=[f"evidence:{finding_id}"] if finding_id else [],
            )
            if finding_id and invocation:
                invocations[finding_id] = invocation
            parent = file_node(path)
            if parent and invocation:
                builder.add_edge("CALLS", parent, invocation, evidence_refs=[f"evidence:{finding_id}"] if finding_id else [])

        for fact in structural_facts:
            path = getattr(fact, "file_path", "")
            fact_id = builder.add_node(
                getattr(fact, "graph_node_type", "FUNCTION"),
                getattr(fact, "name", "symbol"),
                path,
                getattr(fact, "line_number", None),
                attributes={"pattern_type": getattr(fact, "pattern_type", "")},
                finding_ids=list(getattr(fact, "ai_finding_ids", [])),
                evidence_refs=[f"evidence:{item}" for item in getattr(fact, "ai_finding_ids", [])],
            )
            parent = file_node(path)
            if parent and fact_id:
                builder.add_edge("CONTAINS", parent, fact_id)
            for finding_id in getattr(fact, "ai_finding_ids", []):
                if fact_id and finding_id in invocations:
                    builder.add_edge("CALLS", fact_id, invocations[finding_id], evidence_refs=[f"evidence:{finding_id}"])

        for dependency in package_dependencies:
            dependency_id = builder.add_node(
                "PACKAGE_DEPENDENCY", getattr(dependency, "name", "package"),
                attributes={"ecosystem": getattr(dependency, "ecosystem", "")},
            )
            for invocation in invocations.values():
                if dependency_id:
                    builder.add_edge("CORROBORATES", dependency_id, invocation)

        for note in coverage_notes:
            builder.add_node(
                "COVERAGE_GAP",
                "Coverage limitation",
                attributes={"reason": self._graph_safe_coverage_note(note)},
                coverage_state="LIMITED",
            )
        return builder.build_scan_graph()
