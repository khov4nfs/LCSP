"""Deterministic graph traversal used by Python-owned evidence tools."""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Iterable

from .models import ProgramEvidenceGraph
from .vocabulary import (
    BUSINESS_ACTION_NODE_TYPES,
    DATA_FLOW_EDGES,
    DECISION_EDGE_TYPES,
    HUMAN_CONTROL_NODE_TYPES,
)


@dataclass(frozen=True)
class GraphQueryResult:
    nodes: list[dict]
    edges: list[dict]
    paths: list[list[str]]
    truncated: bool
    continuation_frontiers: list[str]
    unresolved_frontiers: list[str]
    evidence_refs: list[str]

    def to_dict(self) -> dict:
        return {
            "nodes": self.nodes,
            "edges": self.edges,
            "paths": self.paths,
            "truncated": self.truncated,
            "continuationFrontiers": self.continuation_frontiers,
            "unresolvedFrontiers": self.unresolved_frontiers,
            "evidenceRefs": self.evidence_refs,
        }


@dataclass(frozen=True)
class GraphNodeSearchResult:
    """Bounded node-search result with the same truncation contract as graph walks."""

    nodes: list[dict]
    truncated: bool
    continuation_frontiers: list[str]
    unresolved_frontiers: list[str]
    evidence_refs: list[str]

    def __iter__(self):
        return iter(self.nodes)

    def __len__(self) -> int:
        return len(self.nodes)

    def __getitem__(self, index):
        return self.nodes[index]

    def to_dict(self) -> dict:
        return {
            "nodes": self.nodes,
            "truncated": self.truncated,
            "continuationFrontiers": self.continuation_frontiers,
            "unresolvedFrontiers": self.unresolved_frontiers,
            "evidenceRefs": self.evidence_refs,
        }


class ProgramGraphQueryEngine:
    """Run bounded graph searches while exposing one canonical ``truncated`` signal.

    max_hops/max_results/node/edge limits are internal resource guards. Callers do
    not infer semantics from which guard fired; every bounded search reports only
    whether more relevant graph state exists through ``truncated`` and
    ``continuationFrontiers``. Real graph uncertainty is kept separately in
    ``unresolvedFrontiers``.
    """

    def __init__(self, graph: ProgramEvidenceGraph | dict) -> None:
        self.graph = (
            graph
            if isinstance(graph, ProgramEvidenceGraph)
            else ProgramEvidenceGraph.from_dict(graph)
        )
        self.nodes = {str(node["node_id"]): node for node in self.graph.nodes}
        self.out: dict[str, list[dict]] = {}
        self.inc: dict[str, list[dict]] = {}
        for edge in self.graph.edges:
            self.out.setdefault(str(edge["source_node_id"]), []).append(edge)
            self.inc.setdefault(str(edge["target_node_id"]), []).append(edge)

    def search_nodes(
        self,
        *,
        node_types: Iterable[str] = (),
        text: str | None = None,
        path_prefixes: Iterable[str] = (),
        semantic_types: Iterable[str] = (),
        max_results: int = 25,
    ) -> GraphNodeSearchResult:
        kinds = set(node_types)
        semantics = set(semantic_types)
        prefixes = tuple(path_prefixes)
        needle = text.lower() if text else None
        limit = max(1, int(max_results))
        rows: list[dict] = []
        continuation: list[str] = []

        for node in sorted(self.graph.nodes, key=lambda value: str(value["node_id"])):
            if kinds and node.get("node_type") not in kinds:
                continue
            source = node.get("source") or {}
            path = str(source.get("file_path") or "")
            if prefixes and not any(path.startswith(prefix) for prefix in prefixes):
                continue
            if semantics and not semantics.intersection(
                set(node.get("semantic_types") or [])
            ):
                continue
            if needle and needle not in (
                str(node.get("label"))
                + " "
                + str(node.get("attributes"))
                + " "
                + str(source.get("symbol_ref"))
            ).lower():
                continue
            if len(rows) >= limit:
                continuation.append(str(node["node_id"]))
                break
            rows.append(node)

        return GraphNodeSearchResult(
            nodes=rows,
            truncated=bool(continuation),
            continuation_frontiers=continuation,
            unresolved_frontiers=[],
            evidence_refs=self._refs(rows, []),
        )

    def subgraph(
        self,
        *,
        seed_ref: str,
        direction: str = "BOTH",
        max_depth: int = 3,
        max_nodes: int = 100,
        max_edges: int = 300,
        node_types: Iterable[str] = (),
        edge_types: Iterable[str] = (),
    ) -> GraphQueryResult:
        return self._walk(
            seed_ref,
            direction,
            max_depth,
            max_nodes,
            max_edges,
            set(node_types),
            set(edge_types),
            set(),
        )

    def trace_static_flow(
        self,
        *,
        start_ref: str,
        direction: str = "FORWARD",
        max_hops: int = 10,
        edge_types: Iterable[str] = (),
        stop_node_types: Iterable[str] = (),
        max_results: int = 100,
    ) -> GraphQueryResult:
        follow = set(edge_types) or (
            {
                "CALLS",
                "RESOLVES_TO",
                "TRIGGERS",
                "AFFECTS",
                "HANDLED_BY",
                "PUBLISHES_EVENT",
                "CONSUMES_EVENT",
                "PUBLISHES_TO_QUEUE",
                "CONSUMES_FROM_QUEUE",
                "PUBLISHES_COMMAND",
                "HANDLES_COMMAND",
                "PUBLISHES_QUERY",
                "HANDLES_QUERY",
            }
            | set(DATA_FLOW_EDGES)
            | set(DECISION_EDGE_TYPES)
        )
        return self._walk(
            start_ref,
            direction,
            max_hops,
            max_results,
            max_results * 5,
            set(),
            follow,
            set(stop_node_types),
        )

    def inspect_data_path(
        self,
        *,
        start_ref: str,
        direction: str = "FORWARD",
        max_hops: int = 10,
        max_results: int = 100,
    ) -> GraphQueryResult:
        return self._walk(
            start_ref,
            direction,
            max_hops,
            max_results,
            max_results * 5,
            set(),
            set(DATA_FLOW_EDGES) | {"CALLS", "RESOLVES_TO"},
            set(),
        )

    def inspect_decision_path(
        self,
        *,
        start_ref: str,
        max_hops: int = 12,
        action_categories: Iterable[str] = (),
        max_results: int = 100,
    ) -> GraphQueryResult:
        mapping = {
            "APPROVE": "APPROVAL",
            "REJECT": "REJECTION",
            "RANK": "RANKING",
            "RECOMMEND": "RECOMMENDATION",
            "STATUS_CHANGE": "STATUS_CHANGE",
        }
        selected = {mapping.get(value, value) for value in action_categories}
        stops = set(BUSINESS_ACTION_NODE_TYPES)
        if selected:
            stops &= selected | {"BUSINESS_ACTION"}
        return self._walk(
            start_ref,
            "FORWARD",
            max_hops,
            max_results,
            max_results * 5,
            set(),
            set(DATA_FLOW_EDGES)
            | set(DECISION_EDGE_TYPES)
            | {
                "CALLS",
                "RESOLVES_TO",
                "TRIGGERS",
                "HANDLED_BY",
                "PUBLISHES_EVENT",
                "CONSUMES_EVENT",
                "PUBLISHES_TO_QUEUE",
                "CONSUMES_FROM_QUEUE",
            },
            stops,
        )

    def inspect_human_review_path(
        self,
        *,
        start_ref: str,
        max_hops: int = 12,
        max_results: int = 100,
    ) -> dict:
        result = self.inspect_decision_path(
            start_ref=start_ref,
            max_hops=max_hops,
            max_results=max_results,
        )
        reviews = [
            node
            for node in result.nodes
            if node.get("node_type") in HUMAN_CONTROL_NODE_TYPES
        ]
        finals = [
            node
            for node in result.nodes
            if node.get("node_type") in BUSINESS_ACTION_NODE_TYPES
        ]
        if reviews:
            state = "PRESENT"
        elif finals and not result.truncated and not result.unresolved_frontiers:
            state = "ABSENT_WITH_BOUNDED_PATH"
        else:
            state = "UNKNOWN"
        return {
            "state": state,
            "reviewNodes": reviews,
            "finalActions": finals,
            **result.to_dict(),
        }

    def provider_invocations(
        self,
        provider: str | None = None,
        max_results: int = 100,
        path_prefixes: Iterable[str] = (),
    ) -> GraphNodeSearchResult:
        limit = max(1, int(max_results))
        prefixes = tuple(path_prefixes)
        rows: list[dict] = []
        continuation: list[str] = []
        provider_name = provider.upper() if provider else None

        for node in sorted(self.graph.nodes, key=lambda value: str(value["node_id"])):
            if node.get("node_type") != "AI_MODEL_INVOCATION":
                continue
            if provider_name and str(
                (node.get("attributes") or {}).get("provider") or ""
            ).upper() != provider_name:
                continue
            source_path = str((node.get("source") or {}).get("file_path") or "")
            if prefixes and not any(
                source_path.startswith(prefix) for prefix in prefixes
            ):
                continue
            if len(rows) >= limit:
                continuation.append(str(node["node_id"]))
                break
            rows.append(node)

        return GraphNodeSearchResult(
            nodes=rows,
            truncated=bool(continuation),
            continuation_frontiers=continuation,
            unresolved_frontiers=[],
            evidence_refs=self._refs(rows, []),
        )

    def symbol_context(self, symbol_ref: str, max_neighbors: int = 50) -> dict:
        canonical = self._canonical_ref(symbol_ref)
        node = next(
            (
                value
                for value in self.graph.nodes
                if (value.get("source") or {}).get("symbol_ref") == symbol_ref
                or value.get("node_id") == canonical
            ),
            None,
        )
        if not node:
            return {
                "symbol": None,
                "neighbors": [],
                "edges": [],
                "truncated": False,
                "continuationFrontiers": [],
                "unresolvedFrontiers": [symbol_ref],
                "evidenceRefs": [],
            }

        node_id = str(node["node_id"])
        incident = sorted(
            [*self.inc.get(node_id, []), *self.out.get(node_id, [])],
            key=lambda edge: str(edge["edge_id"]),
        )
        limit = max(1, int(max_neighbors))
        selected = incident[:limit]
        omitted = incident[limit:]
        neighbor_ids = {
            str(
                edge["source_node_id"]
                if str(edge["target_node_id"]) == node_id
                else edge["target_node_id"]
            )
            for edge in selected
        }
        unresolved = sorted(value for value in neighbor_ids if value not in self.nodes)
        neighbors = [
            self.nodes[value]
            for value in sorted(neighbor_ids)
            if value in self.nodes
        ]
        continuation = sorted(
            {
                str(
                    edge["source_node_id"]
                    if str(edge["target_node_id"]) == node_id
                    else edge["target_node_id"]
                )
                for edge in omitted
            }
        )[:20]
        return {
            "symbol": node,
            "neighbors": neighbors,
            "edges": selected,
            "truncated": bool(omitted),
            "continuationFrontiers": continuation,
            "unresolvedFrontiers": unresolved,
            "evidenceRefs": self._refs([node, *neighbors], selected),
        }

    def _walk(
        self,
        seed_ref: str,
        direction: str,
        depth_limit: int,
        node_limit: int,
        edge_limit: int,
        node_types: set[str],
        edge_types: set[str],
        stop_types: set[str],
    ) -> GraphQueryResult:
        seed = self._canonical_ref(seed_ref)
        if seed not in self.nodes:
            return GraphQueryResult(
                [],
                [],
                [],
                False,
                [],
                [seed_ref],
                [],
            )

        depth_limit = max(0, int(depth_limit))
        node_limit = max(1, int(node_limit))
        edge_limit = max(1, int(edge_limit))
        queue = deque([(seed, 0, [seed])])
        seen_nodes = {seed}
        seen_edges: set[str] = set()
        order = [seed]
        paths: list[list[str]] = []
        continuation: set[str] = set()
        unresolved: set[str] = set()
        truncated = False

        while queue:
            node_id, depth, path = queue.popleft()
            node = self.nodes[node_id]
            if node.get("node_type") == "UNRESOLVED_DYNAMIC_TARGET":
                unresolved.add(node_id)
            if stop_types and node_id != seed and node.get("node_type") in stop_types:
                paths.append(path)
                continue

            neighbors = self._neighbors(node_id, direction, edge_types)
            if depth >= depth_limit:
                if neighbors:
                    truncated = True
                    continuation.add(node_id)
                continue

            for edge, next_id in neighbors:
                edge_id = str(edge["edge_id"])
                if edge_id not in seen_edges and len(seen_edges) >= edge_limit:
                    truncated = True
                    continuation.add(node_id)
                    break
                seen_edges.add(edge_id)

                if next_id not in self.nodes:
                    unresolved.add(next_id)
                    continue
                if next_id not in seen_nodes:
                    if len(seen_nodes) >= node_limit:
                        truncated = True
                        continuation.add(next_id)
                        continue
                    seen_nodes.add(next_id)
                    order.append(next_id)
                    queue.append((next_id, depth + 1, [*path, next_id]))

        nodes = [
            self.nodes[value]
            for value in order
            if not node_types
            or self.nodes[value].get("node_type") in node_types
            or value == seed
        ]
        returned = {str(node["node_id"]) for node in nodes}
        edges = [
            edge
            for edge in self.graph.edges
            if str(edge["edge_id"]) in seen_edges
            and str(edge["source_node_id"]) in returned
            and str(edge["target_node_id"]) in returned
        ]
        return GraphQueryResult(
            nodes=nodes,
            edges=edges,
            paths=paths,
            truncated=truncated,
            continuation_frontiers=sorted(continuation),
            unresolved_frontiers=sorted(unresolved),
            evidence_refs=self._refs(nodes, edges),
        )

    def _canonical_ref(self, value: str) -> str:
        if value in self.nodes:
            return value
        if value.startswith(("node:", "symbol:", "finding:")) and value.count(":") == 1:
            candidate = value.split(":", 1)[1]
            if candidate in self.nodes:
                return candidate
        return value

    def _neighbors(
        self,
        node_id: str,
        direction: str,
        edge_types: set[str],
    ) -> list[tuple[dict, str]]:
        result: list[tuple[dict, str]] = []
        direction = direction.upper()
        if direction in {"FORWARD", "BOTH"}:
            result += [
                (edge, str(edge["target_node_id"]))
                for edge in self.out.get(node_id, [])
                if not edge_types or edge.get("edge_type") in edge_types
            ]
        if direction in {"BACKWARD", "BOTH"}:
            result += [
                (edge, str(edge["source_node_id"]))
                for edge in self.inc.get(node_id, [])
                if not edge_types or edge.get("edge_type") in edge_types
            ]
        return sorted(result, key=lambda item: str(item[0]["edge_id"]))

    @staticmethod
    def _refs(nodes: list[dict], edges: list[dict]) -> list[str]:
        return sorted(
            {
                str(ref)
                for item in [*nodes, *edges]
                for ref in item.get("evidence_refs") or []
                if str(ref)
            }
        )
