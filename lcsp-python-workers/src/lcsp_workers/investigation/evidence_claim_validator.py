"""Fail closed when an LLM claim is not backed by immutable graph/source provenance."""
from __future__ import annotations
from lcsp_workers.scanner.program_graph.models import ProgramEvidenceGraph
from .models import EvidenceClaim

class EvidenceClaimValidationError(ValueError):
    pass

class EvidenceClaimValidator:
    """Validate claims against persisted graph identities; never trust invented path refs."""
    def validate(self, claim: EvidenceClaim, graph: ProgramEvidenceGraph | dict) -> EvidenceClaim:
        value = graph if isinstance(graph, ProgramEvidenceGraph) else ProgramEvidenceGraph.from_dict(graph)
        anchors = {str(a["anchor_id"]) for a in value.source_anchors}
        nodes = {str(n["node_id"]) for n in value.nodes}
        edges = {str(e["edge_id"]) for e in value.edges}
        known = set(value.evidence_refs) | anchors | nodes | edges
        if not claim.evidence_refs:
            raise EvidenceClaimValidationError("claim requires evidence refs")
        missing = [ref for ref in claim.evidence_refs if ref not in known]
        if missing:
            raise EvidenceClaimValidationError(f"unknown evidence refs: {missing}")
        missing_anchors = set(claim.source_anchor_refs) - anchors
        if missing_anchors:
            raise EvidenceClaimValidationError(f"source anchor does not resolve: {sorted(missing_anchors)}")
        # ProgramGraph v2 does not persist a separate path registry yet. Until a path
        # artifact exists, only node/edge/anchor identities may prove a claim; opaque
        # `graph-path:*` strings are rejected instead of being accepted on prefix alone.
        unknown_paths = [ref for ref in claim.graph_path_refs if ref not in known]
        if unknown_paths:
            raise EvidenceClaimValidationError(f"graph path ref does not resolve: {unknown_paths}")
        if not 0 <= claim.confidence <= 1:
            raise EvidenceClaimValidationError("claim confidence out of range")
        return claim
