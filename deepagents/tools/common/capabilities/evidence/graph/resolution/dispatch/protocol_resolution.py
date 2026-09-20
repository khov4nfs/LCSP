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
        self._resolve_graphql_clients(program)
        self._resolve_grpc_clients(program)
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

    def _resolve_graphql_clients(self, program: SemanticProgram) -> None:
        clients = [
            node for node in program.nodes
            if node.node_type == "GRAPHQL_OPERATION"
            and str(node.attributes.get("graphqlRole", "")).upper() == "CLIENT"
        ]
        servers = [
            node for node in program.nodes
            if node.node_type == "GRAPHQL_OPERATION"
            and str(node.attributes.get("graphqlRole", "")).upper() != "CLIENT"
        ]
        for client in clients:
            name = str(client.attributes.get("operationName") or "").strip()
            operation_type = str(client.attributes.get("operationType") or "").strip().lower()
            endpoint = str(client.attributes.get("endpoint") or client.attributes.get("service") or "").strip()
            candidates = [
                server for server in servers
                if str(server.attributes.get("operationName") or "").strip() == name
                and str(server.attributes.get("operationType") or "").strip().lower() in {operation_type, operation_type.capitalize().lower(), {"query": "query", "mutation": "mutation", "subscription": "subscription"}.get(operation_type, operation_type)}
            ]
            if endpoint:
                candidates = [
                    server for server in candidates
                    if str(server.attributes.get("endpoint") or server.attributes.get("service") or "").strip() == endpoint
                ]
            elif len({str(server.attributes.get("endpoint") or server.attributes.get("service") or "").strip() for server in candidates}) > 1:
                candidates = []
            if len(candidates) != 1:
                if candidates or name:
                    program.unresolved_frontiers.append(f"graphql-client:{client.key}")
                continue
            target = candidates[0]
            self._add_edge_once(
                program,
                SemanticEdgeFact(
                    "RESOLVES_TO",
                    client.key,
                    target.key,
                    attributes={"protocol": "GRAPHQL", "resolution": "CLIENT_SERVER"},
                    origin="FRAMEWORK_RESOLUTION",
                    resolution_state="CORROBORATED",
                    evidence_refs=tuple(ref for ref in (client.file_path, target.file_path) if ref),
                ),
            )

    def _resolve_grpc_clients(self, program: SemanticProgram) -> None:
        methods = [node for node in program.nodes if node.node_type == "GRPC_METHOD"]
        for client in [node for node in program.nodes if node.node_type == "CALL_SITE"]:
            attrs = client.attributes or {}
            if str(attrs.get("protocol", "")).upper() not in {"GRPC", "GRPC_CLIENT"} and not attrs.get("grpcMethod"):
                continue
            package = str(attrs.get("grpcPackage") or attrs.get("package") or "").strip()
            service = str(attrs.get("grpcService") or attrs.get("service") or "").strip()
            method = str(attrs.get("grpcMethod") or attrs.get("method") or "").strip()
            if not method:
                continue
            candidates = [
                node for node in methods
                if str(node.attributes.get("method") or node.label).strip() == method
                and (not package or str(node.attributes.get("package") or "").strip() == package)
                and (not service or str(node.attributes.get("service") or "").strip() == service)
            ]
            if len(candidates) != 1:
                program.unresolved_frontiers.append(f"grpc-client:{client.key}")
                continue
            self._add_edge_once(
                program,
                SemanticEdgeFact(
                    "RESOLVES_TO",
                    client.key,
                    candidates[0].key,
                    attributes={"protocol": "GRPC", "resolution": "CLIENT_CONTRACT"},
                    origin="FRAMEWORK_RESOLUTION",
                    resolution_state="CORROBORATED",
                    evidence_refs=tuple(ref for ref in (client.file_path, candidates[0].file_path) if ref),
                ),
            )

    @staticmethod
    def _add_edge_once(program: SemanticProgram, edge: SemanticEdgeFact) -> None:
        if not any(
            existing.edge_type == edge.edge_type
            and existing.source_key == edge.source_key
            and existing.target_key == edge.target_key
            for existing in program.edges
        ):
            program.add_edge(edge)

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
        # Proto identities may include package/service qualification while source
        # methods expose only the implementation name.  Only accept this fallback
        # when it remains unique; never choose the first same-named method.
        method = canonical.rsplit(".", 1)[-1]
        qualified = [node for node in concrete if _canonical(node.label) == method]
        if len(qualified) == 1:
            return qualified
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
