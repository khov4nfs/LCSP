"""Deterministic builder for immutable Program Evidence Graph artifacts."""
from __future__ import annotations
import hashlib, json
from pathlib import Path
from .models import ProgramEdge, ProgramEvidenceGraph, ProgramNode, SourceEvidenceAnchor, SourceLocation
from .semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from .vocabulary import DATA_FLOW_EDGES, EDGE_TYPES, NODE_TYPES, PROGRAM_GRAPH_SCHEMA_VERSION
MAX_COVERAGE_REASON_LENGTH = 240
FORBIDDEN_ATTRIBUTES = {"source", "source_code", "raw_source", "raw_content", "full_source", "prompt", "prompt_text", "full_prompt", "ast_body", "full_ast", "secret", "token", "api_key", "authorization", "credential", "password", "private_key"}
SEMANTIC_DATA_PREFIXES = ("PII.", "SENSITIVE.", "SECRET")
class ProgramGraphValidationError(ValueError): pass

class ProgramGraphBuilder:
    def __init__(self, workspace_path: str | Path, *, scan_job_id: str, snapshot_id: str, commit_sha: str, tool_version: str = "program-evidence-graph/2.0.0", config_hash: str = "") -> None:
        self.workspace = Path(workspace_path).resolve(strict=False); self.scan_job_id, self.snapshot_id, self.commit_sha = scan_job_id, snapshot_id, commit_sha
        self.provenance = {"scan_job_id": scan_job_id, "snapshot_id": snapshot_id, "commit_sha": commit_sha, "tool_version": tool_version, "config_hash": config_hash}
        self._nodes: dict[str, ProgramNode] = {}; self._by_key: dict[str, str] = {}; self._edges: dict[str, ProgramEdge] = {}; self._anchors: dict[str, SourceEvidenceAnchor] = {}; self._coverage: list[str] = []; self._unresolved: list[str] = []

    def add_program(self, program: SemanticProgram) -> None:
        for item in program.nodes: self._add_node(item)
        for item in program.edges: self._add_edge(item)
        self._coverage.extend(program.coverage_notes); self._unresolved.extend(program.unresolved_frontiers)
    def add_coverage_note(self, note: str) -> None:
        if note: self._coverage.append(str(note))

    def _add_node(self, fact: SemanticNodeFact) -> str:
        if fact.node_type not in NODE_TYPES: raise ProgramGraphValidationError(f"unknown node type: {fact.node_type}")
        existing_id = self._by_key.get(fact.key)
        safe_attrs = self._safe(fact.attributes)
        if existing_id:
            existing = self._nodes[existing_id]; existing.semantic_types = sorted(set(existing.semantic_types) | set(fact.semantic_types)); existing.evidence_refs = sorted(set(existing.evidence_refs) | set(fact.evidence_refs)); existing.attributes.update(safe_attrs)
            if existing.coverage_state != "LIMITED" and fact.coverage_state == "LIMITED": existing.coverage_state = "LIMITED"
            return existing_id
        location = None
        if fact.file_path:
            relative = self._relative(fact.file_path); location = SourceLocation(relative, fact.start_line, fact.end_line, fact.symbol_ref, self._file_hash(relative))
        node_id = self._stable_id("node", {"snapshot": self.snapshot_id, "key": fact.key, "type": fact.node_type, "file": fact.file_path, "line": fact.start_line})
        node = ProgramNode(node_id, fact.node_type, fact.label, location, safe_attrs, sorted(set(fact.semantic_types)), sorted(set(fact.evidence_refs)), fact.coverage_state)
        self._nodes[node_id] = node; self._by_key[fact.key] = node_id
        if location and location.source_hash:
            anchor_id = self._stable_id("source-anchor", {"snapshot": self.snapshot_id, "commit": self.commit_sha, "file": location.file_path, "symbol": location.symbol_ref, "start": location.start_line, "end": location.end_line, "hash": location.source_hash, "node": node_id})
            self._anchors[anchor_id] = SourceEvidenceAnchor(anchor_id, self.snapshot_id, self.commit_sha, location.file_path, location.symbol_ref, location.start_line, location.end_line, location.source_hash, node_id); node.source_anchor_ref = anchor_id; node.evidence_refs = sorted(set(node.evidence_refs) | {anchor_id})
        return node_id

    def _add_edge(self, fact: SemanticEdgeFact) -> None:
        if fact.edge_type not in EDGE_TYPES: raise ProgramGraphValidationError(f"unknown edge type: {fact.edge_type}")
        source, target = self._by_key.get(fact.source_key), self._by_key.get(fact.target_key)
        if not source or not target: self._unresolved.append(f"missing_graph_node:{fact.source_key if not source else fact.target_key}"); return
        attrs = self._safe(fact.attributes); edge_id = self._stable_id("edge", {"type": fact.edge_type, "source": source, "target": target, "attrs": attrs})
        existing = self._edges.get(edge_id)
        if existing:
            existing.evidence_refs = sorted(set(existing.evidence_refs) | set(fact.evidence_refs)); return
        self._edges[edge_id] = ProgramEdge(edge_id, fact.edge_type, source, target, max(0.0, min(1.0, float(fact.confidence))), attrs, sorted(set(fact.evidence_refs)), fact.coverage_state)

    def build(self) -> ProgramEvidenceGraph:
        self._propagate_semantic_data()
        nodes = [self._nodes[k].to_dict() for k in sorted(self._nodes)]; edges = [self._edges[k].to_dict() for k in sorted(self._edges)]; anchors = [self._anchors[k].__dict__ for k in sorted(self._anchors)]
        indexes: dict[str, list[str]] = {}
        for node in nodes:
            # Index keys are namespace-qualified because canonical node vocabulary
            # intentionally includes values such as SECRET. A raw key named
            # ``SECRET`` is semantically a node category, but generic evidence
            # privacy guards correctly reserve that JSON field name for credential
            # material. Namespacing removes the ambiguity without weakening the
            # privacy boundary or changing the canonical node_type itself.
            indexes.setdefault(f"node:{node['node_type']}", []).append(str(node["node_id"]))
            for semantic in node.get("semantic_types") or []: indexes.setdefault(f"semantic:{semantic}", []).append(str(node["node_id"]))
        indexes = {k: sorted(set(v)) for k, v in sorted(indexes.items())}
        refs = sorted({str(ref) for item in [*nodes, *edges] for ref in item.get("evidence_refs") or []}); coverage = sorted({self._one_line(n) for n in self._coverage if n}); unresolved = sorted(set(self._unresolved))
        body = {"schema_version": PROGRAM_GRAPH_SCHEMA_VERSION, "snapshot_id": self.snapshot_id, "commit_sha": self.commit_sha, "nodes": nodes, "edges": edges, "source_anchors": anchors, "indexes": indexes, "unresolved_frontiers": unresolved, "coverage_state": "LIMITED" if coverage or unresolved else "SUFFICIENT", "coverage_notes": coverage, "provenance": self.provenance, "evidence_refs": refs}
        graph_hash = "sha256:" + hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        return ProgramEvidenceGraph(self._stable_id("program-graph", body), self.snapshot_id, self.commit_sha, len(nodes), len(edges), nodes, edges, anchors, indexes, unresolved, body["coverage_state"], coverage, dict(self.provenance), refs, graph_hash)

    def _propagate_semantic_data(self) -> None:
        """Propagate data-category labels along value/data edges without claiming anonymization."""
        changed = True; rounds = 0
        while changed and rounds < max(1, len(self._nodes)):
            changed = False; rounds += 1
            for edge in self._edges.values():
                if edge.edge_type not in DATA_FLOW_EDGES: continue
                source, target = self._nodes.get(edge.source_node_id), self._nodes.get(edge.target_node_id)
                if not source or not target: continue
                propagated = {value for value in source.semantic_types if value == "SECRET" or value.startswith(SEMANTIC_DATA_PREFIXES[:2])}
                if propagated - set(target.semantic_types): target.semantic_types = sorted(set(target.semantic_types) | propagated); changed = True

    def _relative(self, value: str) -> str:
        path = Path(value); path = path if path.is_absolute() else self.workspace / path
        try: return path.resolve(strict=False).relative_to(self.workspace).as_posix()
        except ValueError: return Path(value).as_posix()
    def _file_hash(self, relative: str) -> str:
        try: return "sha256:" + hashlib.sha256((self.workspace / relative).read_bytes()).hexdigest()
        except OSError: return "sha256:" + hashlib.sha256(relative.encode()).hexdigest()
    @staticmethod
    def _safe(attrs: dict[str, object]) -> dict[str, object]:
        result = {}
        for key, value in attrs.items():
            normalized = str(key).lower().replace("-", "_")
            if normalized in FORBIDDEN_ATTRIBUTES: raise ProgramGraphValidationError(f"forbidden graph attribute: {normalized}")
            if isinstance(value, str) and ("\n" in value or "\r" in value): raise ProgramGraphValidationError(f"multiline graph attribute: {normalized}")
            result[str(key)] = value
        return result
    @staticmethod
    def _one_line(value: str) -> str:
        first = value.splitlines()[0].strip(); return first if len(first) <= MAX_COVERAGE_REASON_LENGTH else first[:MAX_COVERAGE_REASON_LENGTH] + "... [truncated]"
    @staticmethod
    def _stable_id(kind: str, payload: object) -> str:
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode(); return f"{kind}:" + hashlib.sha256(encoded).hexdigest()[:32]
