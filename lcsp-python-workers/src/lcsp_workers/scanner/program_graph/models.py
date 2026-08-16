"""Typed persisted contracts for Program Evidence Graph artifacts."""
from __future__ import annotations
from dataclasses import asdict, dataclass, field
from typing import Any
from .vocabulary import PROGRAM_GRAPH_SCHEMA_VERSION

@dataclass(frozen=True)
class SourceLocation:
    file_path: str
    start_line: int | None = None
    end_line: int | None = None
    symbol_ref: str | None = None
    source_hash: str | None = None

@dataclass
class ProgramNode:
    node_id: str
    node_type: str
    label: str
    source: SourceLocation | None = None
    attributes: dict[str, Any] = field(default_factory=dict)
    semantic_types: list[str] = field(default_factory=list)
    evidence_refs: list[str] = field(default_factory=list)
    coverage_state: str = "SUFFICIENT"
    source_anchor_ref: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

@dataclass
class ProgramEdge:
    edge_id: str
    edge_type: str
    source_node_id: str
    target_node_id: str
    confidence: float = 1.0
    attributes: dict[str, Any] = field(default_factory=dict)
    evidence_refs: list[str] = field(default_factory=list)
    coverage_state: str = "SUFFICIENT"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

@dataclass(frozen=True)
class SourceEvidenceAnchor:
    anchor_id: str
    snapshot_id: str
    commit_sha: str
    file_path: str
    symbol_ref: str | None
    start_line: int | None
    end_line: int | None
    source_hash: str
    graph_node_id: str

@dataclass
class ProgramEvidenceGraph:
    graph_id: str
    snapshot_id: str
    commit_sha: str
    node_count: int
    edge_count: int
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    source_anchors: list[dict[str, Any]] = field(default_factory=list)
    indexes: dict[str, list[str]] = field(default_factory=dict)
    unresolved_frontiers: list[str] = field(default_factory=list)
    coverage_state: str = "SUFFICIENT"
    coverage_notes: list[str] = field(default_factory=list)
    provenance: dict[str, str] = field(default_factory=dict)
    evidence_refs: list[str] = field(default_factory=list)
    graph_hash: str = ""
    schema_version: str = PROGRAM_GRAPH_SCHEMA_VERSION

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "ProgramEvidenceGraph":
        import json
        import os
        ref = payload.get("evidence_graph_ref") or payload.get("evidenceGraphRef")
        if ref and isinstance(ref, str) and os.path.exists(ref):
            try:
                with open(ref, "r") as f:
                    file_payload = json.load(f)
                    if isinstance(file_payload, dict):
                        for k, v in file_payload.items():
                            if k not in payload or payload[k] in ([], {}, None, ""):
                                payload[k] = v
            except Exception:
                pass

        def pick(snake: str, camel: str, default=None):
            value = payload.get(snake)
            return payload.get(camel, default) if value is None else value
        return cls(
            graph_id=str(pick("graph_id", "graphId", "")),
            snapshot_id=str(pick("snapshot_id", "snapshotId", "")),
            commit_sha=str(pick("commit_sha", "commitSha", "")),
            node_count=int(pick("node_count", "nodeCount", len(payload.get("nodes") or []))),
            edge_count=int(pick("edge_count", "edgeCount", len(payload.get("edges") or []))),
            nodes=list(payload.get("nodes") or []), edges=list(payload.get("edges") or []),
            source_anchors=list(pick("source_anchors", "sourceAnchors", []) or []),
            indexes={str(k): list(v) for k, v in dict(payload.get("indexes") or {}).items()},
            unresolved_frontiers=list(pick("unresolved_frontiers", "unresolvedFrontiers", []) or []),
            coverage_state=str(pick("coverage_state", "coverageState", "SUFFICIENT")),
            coverage_notes=list(pick("coverage_notes", "coverageNotes", []) or []),
            provenance={str(k): str(v) for k, v in dict(payload.get("provenance") or {}).items()},
            evidence_refs=list(pick("evidence_refs", "evidenceRefs", []) or []),
            graph_hash=str(pick("graph_hash", "graphHash", "")),
            schema_version=str(pick("schema_version", "schemaVersion", PROGRAM_GRAPH_SCHEMA_VERSION)),
        )
