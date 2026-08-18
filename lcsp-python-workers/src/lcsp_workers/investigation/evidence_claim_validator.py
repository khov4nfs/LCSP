"""Fail closed when an LLM claim is not backed by immutable graph/source provenance."""
from __future__ import annotations

from lcsp_workers.scanner.program_graph.models import ProgramEvidenceGraph

from .models import EvidenceClaim


class EvidenceClaimValidationError(ValueError):
    pass


class EvidenceClaimValidator:
    """Validate claim provenance against persisted graph identities."""

    def validate(
        self,
        claim: EvidenceClaim,
        graph: ProgramEvidenceGraph | dict,
    ) -> EvidenceClaim:
        value = (
            graph
            if isinstance(graph, ProgramEvidenceGraph)
            else ProgramEvidenceGraph.from_dict(graph)
        )
        anchors = {str(anchor["anchor_id"]) for anchor in value.source_anchors}
        nodes = {str(node["node_id"]) for node in value.nodes}
        edges = {str(edge["edge_id"]) for edge in value.edges}
        known = set(value.evidence_refs) | anchors | nodes | edges

        supplied_refs = {
            *claim.evidence_refs,
            *claim.graph_path_refs,
            *claim.source_anchor_refs,
        }
        if not supplied_refs:
            raise EvidenceClaimValidationError("claim requires graph/source evidence refs")

        missing = [ref for ref in claim.evidence_refs if ref not in known]
        if missing:
            raise EvidenceClaimValidationError(f"unknown evidence refs: {missing}")

        missing_anchors = set(claim.source_anchor_refs) - anchors
        if missing_anchors:
            raise EvidenceClaimValidationError(
                f"source anchor does not resolve: {sorted(missing_anchors)}"
            )

        # ProgramGraph v2 has no separate path registry. A graphPathRef therefore
        # must currently resolve to a persisted node/edge/anchor/evidence identity;
        # opaque invented path strings are rejected.
        unknown_paths = [ref for ref in claim.graph_path_refs if ref not in known]
        if unknown_paths:
            raise EvidenceClaimValidationError(
                f"graph path ref does not resolve: {unknown_paths}"
            )

        if not 0 <= claim.confidence <= 1:
            raise EvidenceClaimValidationError("claim confidence out of range")
        return claim
