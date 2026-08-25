"""Fail-closed structural/privacy validation for Program Evidence Graph artifacts."""
from __future__ import annotations

from tools.common.capabilities.evidence.graph.schema.models import ProgramEvidenceGraph
from tools.common.capabilities.evidence.graph.schema.vocabulary import (
    EDGE_TYPES,
    EVIDENCE_ORIGINS,
    NODE_TYPES,
    RESOLUTION_STATES,
    SUPPORTED_PROGRAM_GRAPH_SCHEMA_VERSIONS,
)

FORBIDDEN = {
    "source_code",
    "raw_source",
    "raw_content",
    "full_source",
    "prompt",
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


class ProgramGraphValidationError(ValueError):
    pass


def validate_program_graph(graph: ProgramEvidenceGraph | dict) -> ProgramEvidenceGraph:
    value = (
        graph
        if isinstance(graph, ProgramEvidenceGraph)
        else ProgramEvidenceGraph.from_dict(graph)
    )
    if value.schema_version not in SUPPORTED_PROGRAM_GRAPH_SCHEMA_VERSIONS:
        raise ProgramGraphValidationError("unsupported graph schema")
    if value.node_count != len(value.nodes) or value.edge_count != len(value.edges):
        raise ProgramGraphValidationError("graph count mismatch")

    is_v3 = value.schema_version == "3.0.0"
    node_ids: set[str] = set()
    anchor_ids = {str(anchor["anchor_id"]) for anchor in value.source_anchors}
    for node in value.nodes:
        node_id = str(node.get("node_id") or "")
        if not node_id or node_id in node_ids:
            raise ProgramGraphValidationError("duplicate/missing node id")
        node_ids.add(node_id)
        if node.get("node_type") not in NODE_TYPES:
            raise ProgramGraphValidationError("unknown node type")
        _safe(node.get("attributes") or {})
        if node.get("source_anchor_ref") and str(node["source_anchor_ref"]) not in anchor_ids:
            raise ProgramGraphValidationError("unresolved source anchor")
        if is_v3:
            _validate_trust_metadata(node)

    edge_ids: set[str] = set()
    for edge in value.edges:
        edge_id = str(edge.get("edge_id") or "")
        if not edge_id or edge_id in edge_ids:
            raise ProgramGraphValidationError("duplicate/missing edge id")
        edge_ids.add(edge_id)
        if edge.get("edge_type") not in EDGE_TYPES:
            raise ProgramGraphValidationError("unknown edge type")
        if (
            str(edge.get("source_node_id")) not in node_ids
            or str(edge.get("target_node_id")) not in node_ids
        ):
            raise ProgramGraphValidationError("unresolved edge endpoint")
        _safe(edge.get("attributes") or {})
        if is_v3:
            _validate_trust_metadata(edge)

    if is_v3:
        known_support_refs = node_ids | edge_ids | anchor_ids
        for item in [*value.nodes, *value.edges]:
            for ref in item.get("support_refs") or []:
                text = str(ref)
                if text.startswith(("node:", "edge:", "source-anchor:")) and text not in known_support_refs:
                    raise ProgramGraphValidationError("unresolved support ref")

    if not value.graph_hash.startswith("sha256:"):
        raise ProgramGraphValidationError("graph hash missing")
    return value


def _validate_trust_metadata(item: dict) -> None:
    if item.get("origin") not in EVIDENCE_ORIGINS:
        raise ProgramGraphValidationError("invalid graph evidence origin")
    if item.get("resolution_state") not in RESOLUTION_STATES:
        raise ProgramGraphValidationError("invalid graph resolution state")
    support_refs = item.get("support_refs")
    if support_refs is None or not isinstance(support_refs, list):
        raise ProgramGraphValidationError("invalid graph support refs")


def _safe(value: object) -> None:
    if isinstance(value, str):
        if "\n" in value or "\r" in value:
            raise ProgramGraphValidationError("multiline source-like attribute")
        return
    if isinstance(value, list):
        for item in value:
            _safe(item)
        return
    if not isinstance(value, dict):
        return
    for key, item in value.items():
        if str(key).lower().replace("-", "_") in FORBIDDEN:
            raise ProgramGraphValidationError("forbidden graph attribute")
        _safe(item)
