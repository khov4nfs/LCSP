"""Fail-closed structural/privacy validation for Program Evidence Graph artifacts."""
from __future__ import annotations
from .models import ProgramEvidenceGraph
from .vocabulary import EDGE_TYPES, NODE_TYPES, PROGRAM_GRAPH_SCHEMA_VERSION

FORBIDDEN = {"source_code", "raw_source", "raw_content", "full_source", "prompt", "full_prompt", "ast_body", "full_ast", "secret", "token", "api_key", "authorization", "credential", "password", "private_key"}
class ProgramGraphValidationError(ValueError): pass

def validate_program_graph(graph: ProgramEvidenceGraph | dict) -> ProgramEvidenceGraph:
    value = graph if isinstance(graph, ProgramEvidenceGraph) else ProgramEvidenceGraph.from_dict(graph)
    if value.schema_version != PROGRAM_GRAPH_SCHEMA_VERSION: raise ProgramGraphValidationError("unsupported graph schema")
    if value.node_count != len(value.nodes) or value.edge_count != len(value.edges): raise ProgramGraphValidationError("graph count mismatch")
    node_ids: set[str] = set(); anchor_ids = {str(a["anchor_id"]) for a in value.source_anchors}
    for node in value.nodes:
        nid = str(node.get("node_id") or "")
        if not nid or nid in node_ids: raise ProgramGraphValidationError("duplicate/missing node id")
        node_ids.add(nid)
        if node.get("node_type") not in NODE_TYPES: raise ProgramGraphValidationError("unknown node type")
        _safe(node.get("attributes") or {})
        if node.get("source_anchor_ref") and str(node["source_anchor_ref"]) not in anchor_ids: raise ProgramGraphValidationError("unresolved source anchor")
    edge_ids: set[str] = set()
    for edge in value.edges:
        eid = str(edge.get("edge_id") or "")
        if not eid or eid in edge_ids: raise ProgramGraphValidationError("duplicate/missing edge id")
        edge_ids.add(eid)
        if edge.get("edge_type") not in EDGE_TYPES: raise ProgramGraphValidationError("unknown edge type")
        if str(edge.get("source_node_id")) not in node_ids or str(edge.get("target_node_id")) not in node_ids: raise ProgramGraphValidationError("unresolved edge endpoint")
        _safe(edge.get("attributes") or {})
    if not value.graph_hash.startswith("sha256:"): raise ProgramGraphValidationError("graph hash missing")
    return value

def _safe(value: object) -> None:
    if isinstance(value, str):
        if "\n" in value or "\r" in value: raise ProgramGraphValidationError("multiline source-like attribute")
        return
    if isinstance(value, list):
        for item in value: _safe(item)
        return
    if not isinstance(value, dict): return
    for key, item in value.items():
        if str(key).lower().replace("-", "_") in FORBIDDEN: raise ProgramGraphValidationError("forbidden graph attribute")
        _safe(item)
