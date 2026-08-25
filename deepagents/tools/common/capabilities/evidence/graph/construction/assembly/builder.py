"""Deterministic builder for immutable Unified System Evidence Graph artifacts."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from tools.common.capabilities.evidence.graph.schema.models import (
    ProgramEdge,
    ProgramEvidenceGraph,
    ProgramNode,
    SourceEvidenceAnchor,
    SourceLocation,
)
from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from tools.common.capabilities.evidence.graph.schema.vocabulary import (
    DATA_FLOW_EDGES,
    EDGE_TYPES,
    EVIDENCE_ORIGINS,
    NODE_TYPES,
    PROGRAM_GRAPH_SCHEMA_VERSION,
    RESOLUTION_STATES,
)

MAX_COVERAGE_REASON_LENGTH = 240
FORBIDDEN_ATTRIBUTES = {
    "source",
    "source_code",
    "raw_source",
    "raw_content",
    "full_source",
    "prompt",
    "prompt_text",
    "full_prompt",
    "ast_body",
    "full_ast",
    "secret",
    "token",
    "api_key",
    "authorization",
    "credential",
    "password",
    "private_key",
}
SEMANTIC_DATA_PREFIXES = ("PII.", "SENSITIVE.", "SECRET")


class ProgramGraphValidationError(ValueError):
    pass


class ProgramGraphBuilder:
    def __init__(
        self,
        workspace_path: str | Path,
        *,
        scan_job_id: str,
        snapshot_id: str,
        commit_sha: str,
        tool_version: str = "unified-system-evidence-graph/3.0.0",
        config_hash: str = "",
    ) -> None:
        self.workspace = Path(workspace_path).resolve(strict=False)
        self.scan_job_id = scan_job_id
        self.snapshot_id = snapshot_id
        self.commit_sha = commit_sha
        self.provenance = {
            "scan_job_id": scan_job_id,
            "snapshot_id": snapshot_id,
            "commit_sha": commit_sha,
            "tool_version": tool_version,
            "config_hash": config_hash,
        }
        self._nodes: dict[str, ProgramNode] = {}
        self._by_key: dict[str, str] = {}
        self._edges: dict[str, ProgramEdge] = {}
        self._anchors: dict[str, SourceEvidenceAnchor] = {}
        self._coverage: list[str] = []
        self._unresolved: list[str] = []

    def add_program(self, program: SemanticProgram) -> None:
        for item in program.nodes:
            self._add_node(item)
        for item in program.edges:
            self._add_edge(item)
        self._coverage.extend(program.coverage_notes)
        # Semantic passes own human-readable/stable IR keys while persisted graph
        # traversal owns stable node IDs. Resolve known frontier keys here so v3
        # callers never have to translate an explicit UNRESOLVED_DYNAMIC_TARGET back
        # through SemanticProgram internals. Non-node diagnostics remain unchanged.
        self._unresolved.extend(
            self._by_key.get(str(value), str(value))
            for value in program.unresolved_frontiers
        )

    def add_coverage_note(self, note: str) -> None:
        if note:
            self._coverage.append(str(note))

    def _add_node(self, fact: SemanticNodeFact) -> str:
        if fact.node_type not in NODE_TYPES:
            raise ProgramGraphValidationError(f"unknown node type: {fact.node_type}")
        origin = self._origin(fact.origin)
        resolution_state = self._resolution_state(
            "UNRESOLVED"
            if fact.node_type == "UNRESOLVED_DYNAMIC_TARGET"
            else fact.resolution_state
        )
        safe_attrs = self._safe(fact.attributes)
        existing_id = self._by_key.get(fact.key)
        if existing_id:
            existing = self._nodes[existing_id]
            existing.semantic_types = sorted(
                set(existing.semantic_types) | set(fact.semantic_types)
            )
            existing.evidence_refs = sorted(
                set(existing.evidence_refs) | set(fact.evidence_refs)
            )
            existing.support_refs = sorted(
                set(existing.support_refs) | set(fact.support_refs)
            )
            existing.attributes.update(safe_attrs)
            if existing.origin != origin:
                additional = set(existing.attributes.get("additionalOrigins") or [])
                additional.update({existing.origin, origin})
                existing.attributes["additionalOrigins"] = sorted(additional)
            existing.resolution_state = self._merge_resolution_state(
                existing.resolution_state, resolution_state
            )
            if (
                existing.coverage_state != "LIMITED"
                and fact.coverage_state == "LIMITED"
            ):
                existing.coverage_state = "LIMITED"
            return existing_id

        location = None
        if fact.file_path:
            relative = self._relative(fact.file_path)
            location = SourceLocation(
                relative,
                fact.start_line,
                fact.end_line,
                fact.symbol_ref,
                self._file_hash(relative),
            )
        node_id = self._stable_id(
            "node",
            {
                "snapshot": self.snapshot_id,
                "key": fact.key,
                "type": fact.node_type,
                "file": fact.file_path,
                "line": fact.start_line,
            },
        )
        node = ProgramNode(
            node_id=node_id,
            node_type=fact.node_type,
            label=fact.label,
            source=location,
            attributes=safe_attrs,
            semantic_types=sorted(set(fact.semantic_types)),
            evidence_refs=sorted(set(fact.evidence_refs)),
            coverage_state=fact.coverage_state,
            origin=origin,
            resolution_state=resolution_state,
            support_refs=sorted(set(fact.support_refs)),
        )
        self._nodes[node_id] = node
        self._by_key[fact.key] = node_id
        if location and location.source_hash:
            anchor_id = self._stable_id(
                "source-anchor",
                {
                    "snapshot": self.snapshot_id,
                    "commit": self.commit_sha,
                    "file": location.file_path,
                    "symbol": location.symbol_ref,
                    "start": location.start_line,
                    "end": location.end_line,
                    "hash": location.source_hash,
                    "node": node_id,
                },
            )
            self._anchors[anchor_id] = SourceEvidenceAnchor(
                anchor_id,
                self.snapshot_id,
                self.commit_sha,
                location.file_path,
                location.symbol_ref,
                location.start_line,
                location.end_line,
                location.source_hash,
                node_id,
            )
            node.source_anchor_ref = anchor_id
            node.evidence_refs = sorted(set(node.evidence_refs) | {anchor_id})
        return node_id

    def _add_edge(self, fact: SemanticEdgeFact) -> None:
        if fact.edge_type not in EDGE_TYPES:
            raise ProgramGraphValidationError(f"unknown edge type: {fact.edge_type}")
        source = self._by_key.get(fact.source_key)
        target = self._by_key.get(fact.target_key)
        if not source or not target:
            self._unresolved.append(
                f"missing_graph_node:{fact.source_key if not source else fact.target_key}"
            )
            return
        origin = self._origin(fact.origin)
        resolution_state = self._resolution_state(fact.resolution_state)
        attrs = self._safe(fact.attributes)
        edge_id = self._stable_id(
            "edge",
            {
                "type": fact.edge_type,
                "source": source,
                "target": target,
                "attrs": attrs,
                "origin": origin,
                "resolutionState": resolution_state,
            },
        )
        existing = self._edges.get(edge_id)
        if existing:
            existing.evidence_refs = sorted(
                set(existing.evidence_refs) | set(fact.evidence_refs)
            )
            existing.support_refs = sorted(
                set(existing.support_refs) | set(fact.support_refs)
            )
            return
        self._edges[edge_id] = ProgramEdge(
            edge_id=edge_id,
            edge_type=fact.edge_type,
            source_node_id=source,
            target_node_id=target,
            confidence=max(0.0, min(1.0, float(fact.confidence))),
            attributes=attrs,
            evidence_refs=sorted(set(fact.evidence_refs)),
            coverage_state=fact.coverage_state,
            origin=origin,
            resolution_state=resolution_state,
            support_refs=sorted(set(fact.support_refs)),
        )

    def build(self) -> ProgramEvidenceGraph:
        self._propagate_semantic_data()
        nodes = [self._nodes[key].to_dict() for key in sorted(self._nodes)]
        edges = [self._edges[key].to_dict() for key in sorted(self._edges)]
        anchors = [self._anchors[key].__dict__ for key in sorted(self._anchors)]
        indexes: dict[str, list[str]] = {}
        for node in nodes:
            indexes.setdefault(f"node:{node['node_type']}", []).append(
                str(node["node_id"])
            )
            indexes.setdefault(f"origin:{node.get('origin')}", []).append(
                str(node["node_id"])
            )
            indexes.setdefault(
                f"resolution:{node.get('resolution_state')}", []
            ).append(str(node["node_id"]))
            for semantic in node.get("semantic_types") or []:
                indexes.setdefault(f"semantic:{semantic}", []).append(
                    str(node["node_id"])
                )
        indexes = {
            key: sorted(set(value)) for key, value in sorted(indexes.items())
        }
        refs = sorted(
            {
                str(ref)
                for item in [*nodes, *edges]
                for ref in [
                    *(item.get("evidence_refs") or []),
                    *(item.get("support_refs") or []),
                ]
            }
        )
        coverage = sorted(
            {self._one_line(note) for note in self._coverage if note}
        )
        unresolved = sorted(set(self._unresolved))
        body = {
            "schema_version": PROGRAM_GRAPH_SCHEMA_VERSION,
            "snapshot_id": self.snapshot_id,
            "commit_sha": self.commit_sha,
            "nodes": nodes,
            "edges": edges,
            "source_anchors": anchors,
            "indexes": indexes,
            "unresolved_frontiers": unresolved,
            "coverage_state": "LIMITED" if coverage or unresolved else "SUFFICIENT",
            "coverage_notes": coverage,
            "provenance": self.provenance,
            "evidence_refs": refs,
        }
        graph_hash = "sha256:" + hashlib.sha256(
            json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        return ProgramEvidenceGraph(
            self._stable_id("program-graph", body),
            self.snapshot_id,
            self.commit_sha,
            len(nodes),
            len(edges),
            nodes,
            edges,
            anchors,
            indexes,
            unresolved,
            body["coverage_state"],
            coverage,
            dict(self.provenance),
            refs,
            graph_hash,
        )

    def _propagate_semantic_data(self) -> None:
        """Propagate only trusted data semantics along deterministic lineage edges.

        Identifier/contract taxonomy may intentionally exist as ``INFERRED`` seed data.
        Those semantics stay local until another analyzer corroborates processing or
        lineage; otherwise a weak field name could incorrectly promote a DB/table/model
        sink into trusted sensitive-data evidence.
        """
        changed = True
        rounds = 0
        while changed and rounds < max(1, len(self._nodes)):
            changed = False
            rounds += 1
            for edge in self._edges.values():
                if edge.edge_type not in DATA_FLOW_EDGES:
                    continue
                source = self._nodes.get(edge.source_node_id)
                target = self._nodes.get(edge.target_node_id)
                if not source or not target:
                    continue
                if source.resolution_state not in {"OBSERVED", "CORROBORATED"}:
                    continue
                propagated = {
                    value
                    for value in source.semantic_types
                    if value == "SECRET" or value.startswith(SEMANTIC_DATA_PREFIXES[:2])
                }
                if propagated - set(target.semantic_types):
                    target.semantic_types = sorted(
                        set(target.semantic_types) | propagated
                    )
                    if target.resolution_state != "UNRESOLVED":
                        target.resolution_state = "CORROBORATED"
                    changed = True

    def _relative(self, value: str) -> str:
        path = Path(value)
        path = path if path.is_absolute() else self.workspace / path
        try:
            return path.resolve(strict=False).relative_to(self.workspace).as_posix()
        except ValueError:
            return Path(value).as_posix()

    def _file_hash(self, relative: str) -> str:
        try:
            return "sha256:" + hashlib.sha256(
                (self.workspace / relative).read_bytes()
            ).hexdigest()
        except OSError:
            return "sha256:" + hashlib.sha256(relative.encode()).hexdigest()

    @staticmethod
    def _safe(attrs: dict[str, object]) -> dict[str, object]:
        result = {}
        for key, value in attrs.items():
            normalized = str(key).lower().replace("-", "_")
            if normalized in FORBIDDEN_ATTRIBUTES:
                raise ProgramGraphValidationError(
                    f"forbidden graph attribute: {normalized}"
                )
            if isinstance(value, str) and ("\n" in value or "\r" in value):
                raise ProgramGraphValidationError(
                    f"multiline graph attribute: {normalized}"
                )
            result[str(key)] = value
        return result

    @staticmethod
    def _origin(value: str) -> str:
        if value not in EVIDENCE_ORIGINS:
            raise ProgramGraphValidationError(f"unknown evidence origin: {value}")
        return value

    @staticmethod
    def _resolution_state(value: str) -> str:
        if value not in RESOLUTION_STATES:
            raise ProgramGraphValidationError(f"unknown resolution state: {value}")
        return value

    @staticmethod
    def _merge_resolution_state(current: str, incoming: str) -> str:
        # Never allow a later weak observation to erase known uncertainty. Otherwise,
        # deterministic corroboration is stronger than a single observation/inference.
        order = {
            "INFERRED": 0,
            "OBSERVED": 1,
            "CORROBORATED": 2,
            "UNRESOLVED": 3,
        }
        return max((current, incoming), key=lambda value: order[value])

    @staticmethod
    def _one_line(value: str) -> str:
        first = value.splitlines()[0].strip()
        return (
            first
            if len(first) <= MAX_COVERAGE_REASON_LENGTH
            else first[:MAX_COVERAGE_REASON_LENGTH] + "... [truncated]"
        )

    @staticmethod
    def _stable_id(kind: str, payload: object) -> str:
        encoded = json.dumps(
            payload, sort_keys=True, separators=(",", ":"), default=str
        ).encode()
        return f"{kind}:" + hashlib.sha256(encoded).hexdigest()[:32]
