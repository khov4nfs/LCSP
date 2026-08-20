"""Connect contract field identities into protocol/request execution flow."""
from __future__ import annotations

from .semantic_ir import SemanticEdgeFact, SemanticProgram


class ContractLineageFlowFinalizer:
    """Make contract DATA_OBJECT values flow into their owning protocol boundary.

    Contract extractors deliberately model ``owner CARRIES_DATA field`` as containment.
    Traversal also needs the execution direction ``field FLOWS_TO owner`` so a generic
    OpenAPI/GraphQL/protobuf payload can continue through route/RPC resolution into code.
    This pass is language/protocol neutral and therefore covers all contract adapters.
    """

    def enrich(self, program: SemanticProgram) -> SemanticProgram:
        nodes = {node.key: node for node in program.nodes}
        existing = {
            (edge.edge_type, edge.source_key, edge.target_key)
            for edge in program.edges
        }
        additions: list[SemanticEdgeFact] = []
        for edge in tuple(program.edges):
            if edge.edge_type != "CARRIES_DATA":
                continue
            owner = nodes.get(edge.source_key)
            data = nodes.get(edge.target_key)
            if not owner or not data or data.node_type != "DATA_OBJECT":
                continue
            if data.origin != "CONTRACT_ANALYSIS":
                continue
            key = ("FLOWS_TO", data.key, owner.key)
            if key in existing:
                continue
            existing.add(key)
            additions.append(
                SemanticEdgeFact(
                    "FLOWS_TO",
                    data.key,
                    owner.key,
                    origin="CONTRACT_ANALYSIS",
                    resolution_state=(
                        "CORROBORATED"
                        if data.resolution_state == "CORROBORATED"
                        else "OBSERVED"
                    ),
                )
            )
        program.add_edges(additions)
        return program
