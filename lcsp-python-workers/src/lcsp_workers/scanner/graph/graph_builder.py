import hashlib
import json
from typing import Dict, List, Optional
from dataclasses import asdict

from lcsp_workers.scanner.graph.node_types import GraphNode, NODE_TYPES
from lcsp_workers.scanner.graph.edge_types import GraphEdge, EDGE_TYPES
from lcsp_workers.scanner.graph.graph_serializer import ScanGraph

MAX_NODES = 10000
MAX_EDGES = 50000

class EvidenceGraphBuilder:
    def __init__(
        self,
        workspace_path: str = "",
        *,
        scan_job_id: str = "",
        repository_ref: str = "",
        snapshot_id: str = "",
        commit_sha: str = "",
        tool_version: str = "",
        config_hash: str = "",
    ):
        self.workspace_path = workspace_path.replace('\\', '/') if workspace_path else ""
        self.provenance = {
            "scan_job_id": scan_job_id,
            "repository_ref": repository_ref,
            "snapshot_id": snapshot_id,
            "commit_sha": commit_sha,
            "tool_version": tool_version,
            "config_hash": config_hash,
        }
        self.nodes: Dict[str, GraphNode] = {}
        self.edges: Dict[str, GraphEdge] = {}
        self.node_dedup_map: Dict[str, str] = {}
        self.edge_dedup_map: Dict[str, str] = {}
        self.coverage_gap_emitted = False
        self.coverage_gap_edge_emitted = False
        self.ai_provider_nodes: List[str] = []
        self.ai_invocation_nodes: List[str] = []
        self.coverage_gap_nodes: List[str] = []
        self.unsupported_flow_nodes: List[str] = []

    def _make_relative(self, path: Optional[str]) -> Optional[str]:
        if not path:
            return path
        
        path_norm = path.replace('\\', '/')
        if self.workspace_path and path_norm.startswith(self.workspace_path):
            rel = path_norm[len(self.workspace_path):]
            if rel.startswith('/'):
                rel = rel[1:]
            return rel
        return path_norm

    def _assert_no_raw_source(self, attributes: dict):
        for k, v in attributes.items():
            if k in {"source_code", "raw_content", "prompt", "ast_body", "full_ast"}:
                raise AssertionError(f"Raw source code found in attribute {k}")
            if isinstance(v, str) and ("def " in v or "class " in v or "import " in v or "\n" in v):
                if k not in ["purl", "name", "rule_id", "kwarg_names", "label"]: 
                    raise AssertionError(f"Raw source code found in attribute {k}: {v}")

    @staticmethod
    def _stable_id(kind: str, payload: dict) -> str:
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        return f"{kind}:{digest[:32]}"

    @staticmethod
    def _sorted_refs(refs: Optional[List[str]]) -> List[str]:
        return sorted(set(refs or []))

    def add_node(self, node_type: str, label: str, file_path: Optional[str] = None, 
                 line_number: Optional[int] = None, attributes: Optional[dict] = None, 
                 finding_ids: Optional[List[str]] = None,
                 provenance: Optional[dict] = None,
                 coverage_state: str = "SUFFICIENT",
                 evidence_refs: Optional[List[str]] = None) -> Optional[str]:
        if node_type not in NODE_TYPES:
            raise ValueError(f"Invalid node type: {node_type}")
            
        attributes = attributes or {}
        finding_ids = self._sorted_refs(finding_ids)
        evidence_refs = self._sorted_refs(evidence_refs)
        
        self._assert_no_raw_source(attributes)
        
        rel_path = self._make_relative(file_path)
        
        # Deduplication key
        dedup_key = f"{rel_path or ''}::{node_type}::{label}"
        
        if dedup_key in self.node_dedup_map:
            existing_id = self.node_dedup_map[dedup_key]
            existing_node = self.nodes[existing_id]
            for fid in finding_ids:
                if fid not in existing_node.finding_ids:
                    existing_node.finding_ids.append(fid)
            existing_node.finding_ids.sort()
            existing_node.evidence_refs = self._sorted_refs(
                [*existing_node.evidence_refs, *evidence_refs]
            )
            return existing_id
            
        if len(self.nodes) >= MAX_NODES:
            if not self.coverage_gap_emitted:
                self._emit_coverage_gap("Max nodes limit reached (10,000)")
                self.coverage_gap_emitted = True
            return None
            
        node_id = self._stable_id(
            "node",
            {
                "scan_job_id": self.provenance["scan_job_id"],
                "file_path": rel_path,
                "node_type": node_type,
                "label": label,
                "line_number": line_number,
            },
        )
        new_node = GraphNode(
            node_id=node_id,
            node_type=node_type,
            label=label,
            file_path=rel_path,
            line_number=line_number,
            attributes=attributes,
            finding_ids=finding_ids,
            provenance={**self.provenance, **(provenance or {})},
            coverage_state=coverage_state,
            evidence_refs=evidence_refs,
        )
        
        self.nodes[node_id] = new_node
        self.node_dedup_map[dedup_key] = node_id
        
        if node_type == "AI_PROVIDER":
            self.ai_provider_nodes.append(node_id)
        elif node_type == "AI_MODEL_INVOCATION":
            self.ai_invocation_nodes.append(node_id)
        elif node_type == "UNSUPPORTED_FLOW":
            self.unsupported_flow_nodes.append(node_id)
        elif node_type == "COVERAGE_GAP":
            self.coverage_gap_nodes.append(node_id)
            
        return node_id

    def add_edge(self, edge_type: str, source_node_id: str, target_node_id: str, 
                 confidence: float = 1.0, attributes: Optional[dict] = None,
                 provenance: Optional[dict] = None,
                 coverage_state: str = "SUFFICIENT",
                 evidence_refs: Optional[List[str]] = None) -> Optional[str]:
        if edge_type not in EDGE_TYPES:
            raise ValueError(f"Invalid edge type: {edge_type}")
            
        attributes = attributes or {}
        self._assert_no_raw_source(attributes)
        evidence_refs = self._sorted_refs(evidence_refs)
        
        if source_node_id not in self.nodes or target_node_id not in self.nodes:
            return None

        dedup_key = json.dumps(
            {
                "edge_type": edge_type,
                "source": source_node_id,
                "target": target_node_id,
                "attributes": attributes,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        if dedup_key in self.edge_dedup_map:
            existing = self.edges[self.edge_dedup_map[dedup_key]]
            existing.evidence_refs = self._sorted_refs(
                [*existing.evidence_refs, *evidence_refs]
            )
            return existing.edge_id
            
        if len(self.edges) >= MAX_EDGES:
            if not self.coverage_gap_edge_emitted:
                self._emit_coverage_gap("Max edges limit reached (50,000)")
                self.coverage_gap_edge_emitted = True
            return None
            
        edge_id = self._stable_id("edge", json.loads(dedup_key))
        new_edge = GraphEdge(
            edge_id=edge_id,
            edge_type=edge_type,
            source_node_id=source_node_id,
            target_node_id=target_node_id,
            confidence=confidence,
            attributes=attributes,
            provenance={**self.provenance, **(provenance or {})},
            coverage_state=coverage_state,
            evidence_refs=evidence_refs,
        )
        
        self.edges[edge_id] = new_edge
        self.edge_dedup_map[dedup_key] = edge_id
        return edge_id

    def _emit_coverage_gap(self, reason: str):
        node_id = self._stable_id(
            "node",
            {
                "scan_job_id": self.provenance["scan_job_id"],
                "node_type": "COVERAGE_GAP",
                "label": "Truncation",
                "reason": reason,
            },
        )
        gap_node = GraphNode(
            node_id=node_id,
            node_type="COVERAGE_GAP",
            label="Truncation",
            file_path=None,
            line_number=None,
            attributes={"reason": reason},
            finding_ids=[],
            provenance=self.provenance,
            coverage_state="LIMITED",
            evidence_refs=[],
        )
        self.nodes[node_id] = gap_node
        self.coverage_gap_nodes.append(node_id)

    def build_scan_graph(self) -> ScanGraph:
        nodes = [asdict(self.nodes[node_id]) for node_id in sorted(self.nodes)]
        edges = [asdict(self.edges[edge_id]) for edge_id in sorted(self.edges)]
        evidence_refs = self._sorted_refs(
            [
                *(ref for node in nodes for ref in node["evidence_refs"]),
                *(ref for edge in edges for ref in edge["evidence_refs"]),
            ]
        )
        coverage_state = "LIMITED" if self.coverage_gap_nodes else "SUFFICIENT"
        graph_body = {
            "schema_version": "1.0.0",
            "provenance": self.provenance,
            "coverage_state": coverage_state,
            "evidence_refs": evidence_refs,
            "nodes": nodes,
            "edges": edges,
        }
        graph_hash = "sha256:" + hashlib.sha256(
            json.dumps(graph_body, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        return ScanGraph(
            graph_id=self._stable_id("graph", graph_body),
            schema_version="1.0.0",
            node_count=len(self.nodes),
            edge_count=len(self.edges),
            nodes=nodes,
            edges=edges,
            ai_provider_nodes=sorted(self.ai_provider_nodes),
            ai_invocation_nodes=sorted(self.ai_invocation_nodes),
            coverage_gap_nodes=sorted(self.coverage_gap_nodes),
            unsupported_flow_nodes=sorted(self.unsupported_flow_nodes),
            provenance=self.provenance,
            coverage_state=coverage_state,
            evidence_refs=evidence_refs,
            graph_hash=graph_hash,
        )
