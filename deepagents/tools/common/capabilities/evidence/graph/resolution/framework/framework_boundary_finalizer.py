"""Fail closed on framework boundaries after source-role filtering.

Framework resolvers run before test/spec removal so they can use complete static wiring
information. Filtering can legitimately remove a test-only handler/provider and its
incident edge. This final pass runs afterwards and guarantees that a production
EVENT/QUEUE/COMMAND/QUERY/DI/dispatch boundary never becomes a silent endpoint: it
must either continue to a concrete product symbol or terminate in an explicit
UNRESOLVED_DYNAMIC_TARGET frontier.
"""
from __future__ import annotations

import re

from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram

_BOUNDARY_SPECS = {
    "EVENT": ("PUBLISHES_EVENT", "CONSUMES_EVENT"),
    "QUEUE": ("PUBLISHES_TO_QUEUE", "CONSUMES_FROM_QUEUE"),
    "COMMAND": ("PUBLISHES_COMMAND", "HANDLES_COMMAND"),
    "QUERY": ("PUBLISHES_QUERY", "HANDLES_QUERY"),
}
_CONCRETE_NODE_TYPES = frozenset({"CLASS", "METHOD", "FUNCTION"})
_FRAMEWORK_BINDING_NODE_TYPES = frozenset({"TYPE", "CALL_SITE"})


class FrameworkBoundaryFinalizer:
    """Make post-filter framework continuation state explicit and deterministic."""

    def enrich(self, program: SemanticProgram) -> SemanticProgram:
        node_by_key = self._node_index(program)
        edges = list(program.edges)

        for key, node in tuple(node_by_key.items()):
            spec = _BOUNDARY_SPECS.get(node.node_type)
            if spec is None:
                continue
            producer_edge, continuation_edge = spec
            if not self._has_incoming_edge(edges, key, producer_edge):
                continue
            if self._has_valid_continuation(
                edges,
                source_key=key,
                edge_type=continuation_edge,
                node_by_key=node_by_key,
            ):
                continue
            self._mark_unresolved(
                program,
                boundary=node.node_type,
                identity=node.label,
                source_key=key,
                edge_type=continuation_edge,
            )
            node_by_key = self._node_index(program)
            edges = list(program.edges)

        # DI and generic-dispatch identities are represented as TYPE/CALL_SITE nodes
        # with frameworkBoundary metadata. They are not part of the canonical
        # EVENT/QUEUE/COMMAND/QUERY vocabulary, so finalize them through RESOLVES_TO.
        for key, node in tuple(node_by_key.items()):
            if node.node_type not in _FRAMEWORK_BINDING_NODE_TYPES:
                continue
            boundary = str((node.attributes or {}).get("frameworkBoundary") or "").strip()
            if not boundary:
                continue
            if not self._has_incident_framework_use(edges, key):
                continue
            if self._has_valid_continuation(
                edges,
                source_key=key,
                edge_type="RESOLVES_TO",
                node_by_key=node_by_key,
                allow_binding_target=True,
            ):
                continue
            self._mark_unresolved(
                program,
                boundary=boundary,
                identity=node.label,
                source_key=key,
                edge_type="RESOLVES_TO",
                file_path=node.file_path,
                line=node.start_line,
            )
            node_by_key = self._node_index(program)
            edges = list(program.edges)

        return program

    @staticmethod
    def _node_index(program: SemanticProgram) -> dict[str, SemanticNodeFact]:
        return {node.key: node for node in program.nodes}

    @staticmethod
    def _has_incoming_edge(
        edges: list[SemanticEdgeFact],
        target_key: str,
        edge_type: str,
    ) -> bool:
        return any(
            edge.edge_type == edge_type and edge.target_key == target_key
            for edge in edges
        )

    @staticmethod
    def _has_incident_framework_use(
        edges: list[SemanticEdgeFact],
        key: str,
    ) -> bool:
        return any(
            edge.source_key == key or edge.target_key == key
            for edge in edges
        )

    @classmethod
    def _has_valid_continuation(
        cls,
        edges: list[SemanticEdgeFact],
        *,
        source_key: str,
        edge_type: str,
        node_by_key: dict[str, SemanticNodeFact],
        allow_binding_target: bool = False,
    ) -> bool:
        for edge in edges:
            if edge.edge_type != edge_type or edge.source_key != source_key:
                continue
            target = node_by_key.get(edge.target_key)
            if target is None:
                continue
            if target.node_type == "UNRESOLVED_DYNAMIC_TARGET":
                return True
            if target.node_type in _CONCRETE_NODE_TYPES:
                return True
            if allow_binding_target and target.node_type == "TYPE":
                # A binding may resolve through one intermediate token; require that
                # token itself to have a concrete/unresolved RESOLVES_TO continuation.
                if cls._has_valid_continuation(
                    edges,
                    source_key=target.key,
                    edge_type="RESOLVES_TO",
                    node_by_key=node_by_key,
                    allow_binding_target=False,
                ):
                    return True
        return False

    @staticmethod
    def _mark_unresolved(
        program: SemanticProgram,
        *,
        boundary: str,
        identity: str,
        source_key: str,
        edge_type: str,
        file_path: str | None = None,
        line: int | None = None,
    ) -> None:
        safe_boundary = re.sub(r"[^A-Za-z0-9_.:-]+", "_", boundary)[:80] or "FRAMEWORK"
        safe_identity = re.sub(r"[^A-Za-z0-9_.:-]+", "_", identity)[:120] or "unknown"
        key = f"framework-finalizer-unresolved:{safe_boundary}:{safe_identity}:{source_key}"
        if any(node.key == key for node in program.nodes):
            return
        program.add_node(
            SemanticNodeFact(
                key,
                "UNRESOLVED_DYNAMIC_TARGET",
                f"{boundary}:{identity}",
                file_path,
                line,
                line,
                attributes={
                    "frameworkBoundary": boundary,
                    "boundaryIdentity": identity,
                    "resolutionState": "UNRESOLVED",
                    "postFilterFinalizer": True,
                },
                coverage_state="LIMITED",
            )
        )
        program.add_edge(
            SemanticEdgeFact(
                edge_type,
                source_key,
                key,
                attributes={
                    "frameworkBoundary": boundary,
                    "postFilterFinalizer": True,
                },
                coverage_state="LIMITED",
            )
        )
        if key not in program.unresolved_frontiers:
            program.unresolved_frontiers.append(key)
