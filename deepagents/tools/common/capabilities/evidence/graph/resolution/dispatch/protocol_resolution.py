"""Resolve protocol contract boundaries to concrete repository implementations."""
from __future__ import annotations

import re

from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram

_CONCRETE_TYPES = frozenset({"FUNCTION", "METHOD"})


class ProtocolBoundaryResolver:
    """Resolve gRPC contract methods or expose an explicit unresolved frontier.

    A protocol declaration is not an end of business flow. Exact unique method/function
    name matches continue to repository implementation. Ambiguous/missing matches remain
    an UNRESOLVED_DYNAMIC_TARGET so absence reasoning cannot stop at the .proto file.
    """

    def enrich(self, program: SemanticProgram) -> SemanticProgram:
        methods = [node for node in program.nodes if node.node_type == "GRPC_METHOD"]
        concrete = [node for node in program.nodes if node.node_type in _CONCRETE_TYPES]
        for method in methods:
            if self._already_resolved(program, method.key):
                continue
            candidates = self._candidates(method.label, concrete)
            if len(candidates) == 1:
                program.add_edge(
                    SemanticEdgeFact(
                        "RESOLVES_TO",
                        method.key,
                        candidates[0].key,
                        attributes={"frameworkBoundary": "GRPC"},
                        origin="FRAMEWORK_RESOLUTION",
                        resolution_state="CORROBORATED",
                    )
                )
                continue
            self._mark_unresolved(program, method, candidates)
        return program

    @staticmethod
    def _already_resolved(program: SemanticProgram, method_key: str) -> bool:
        return any(
            edge.source_key == method_key and edge.edge_type == "RESOLVES_TO"
            for edge in program.edges
        )

    @staticmethod
    def _candidates(label: str, concrete: list[SemanticNodeFact]) -> list[SemanticNodeFact]:
        canonical = _canonical(label)
        exact = [node for node in concrete if _canonical(node.label) == canonical]
        if exact:
            return exact
        # Common generated-service naming keeps the RPC identity but adds a suffix.
        return [
            node
            for node in concrete
            if _canonical(node.label) in {f"{canonical}handler", f"handle{canonical}"}
        ]

    @staticmethod
    def _mark_unresolved(
        program: SemanticProgram,
        method: SemanticNodeFact,
        candidates: list[SemanticNodeFact],
    ) -> None:
        key = f"framework-unresolved:GRPC:{_safe(method.label)}:{method.key}"
        program.add_node(
            SemanticNodeFact(
                key,
                "UNRESOLVED_DYNAMIC_TARGET",
                f"GRPC:{method.label}",
                method.file_path,
                method.start_line,
                method.end_line,
                attributes={
                    "frameworkBoundary": "GRPC",
                    "boundaryIdentity": method.label,
                    "resolutionState": "UNRESOLVED",
                    "candidateCount": len(candidates),
                },
                coverage_state="LIMITED",
                origin="FRAMEWORK_RESOLUTION",
                resolution_state="UNRESOLVED",
            )
        )
        program.add_edge(
            SemanticEdgeFact(
                "RESOLVES_TO",
                method.key,
                key,
                attributes={"frameworkBoundary": "GRPC"},
                coverage_state="LIMITED",
                origin="FRAMEWORK_RESOLUTION",
                resolution_state="UNRESOLVED",
            )
        )
        if key not in program.unresolved_frontiers:
            program.unresolved_frontiers.append(key)


def _canonical(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _safe(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.:-]+", "_", value)[:120] or "unknown"
