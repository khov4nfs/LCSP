"""Deterministic graph traversal used by Python-owned evidence tools."""
from __future__ import annotations
from collections import deque
from dataclasses import dataclass
from typing import Iterable
from .models import ProgramEvidenceGraph
from .vocabulary import BUSINESS_ACTION_NODE_TYPES, DATA_FLOW_EDGES, DECISION_EDGE_TYPES, HUMAN_CONTROL_NODE_TYPES

@dataclass(frozen=True)
class GraphQueryResult:
    nodes: list[dict]; edges: list[dict]; paths: list[list[str]]; truncated: bool; unresolved_frontiers: list[str]; evidence_refs: list[str]
    def to_dict(self) -> dict: return {"nodes": self.nodes, "edges": self.edges, "paths": self.paths, "truncated": self.truncated, "unresolvedFrontiers": self.unresolved_frontiers, "evidenceRefs": self.evidence_refs}

class ProgramGraphQueryEngine:
    def __init__(self, graph: ProgramEvidenceGraph | dict) -> None:
        self.graph = graph if isinstance(graph, ProgramEvidenceGraph) else ProgramEvidenceGraph.from_dict(graph)
        self.nodes = {str(n["node_id"]): n for n in self.graph.nodes}; self.out: dict[str, list[dict]] = {}; self.inc: dict[str, list[dict]] = {}
        for edge in self.graph.edges:
            self.out.setdefault(str(edge["source_node_id"]), []).append(edge); self.inc.setdefault(str(edge["target_node_id"]), []).append(edge)

    def search_nodes(self, *, node_types: Iterable[str] = (), text: str | None = None, path_prefixes: Iterable[str] = (), semantic_types: Iterable[str] = (), max_results: int = 25) -> list[dict]:
        kinds, semantics, prefixes, needle = set(node_types), set(semantic_types), tuple(path_prefixes), text.lower() if text else None; result = []
        for node in sorted(self.graph.nodes, key=lambda v: str(v["node_id"])):
            if kinds and node.get("node_type") not in kinds: continue
            source = node.get("source") or {}; path = str(source.get("file_path") or "")
            if prefixes and not any(path.startswith(p) for p in prefixes): continue
            if semantics and not semantics.intersection(set(node.get("semantic_types") or [])): continue
            if needle and needle not in (str(node.get("label")) + " " + str(node.get("attributes")) + " " + str(source.get("symbol_ref"))).lower(): continue
            result.append(node)
            if len(result) >= max_results: break
        return result

    def subgraph(self, *, seed_ref: str, direction: str = "BOTH", max_depth: int = 3, max_nodes: int = 100, max_edges: int = 300, node_types: Iterable[str] = (), edge_types: Iterable[str] = ()) -> GraphQueryResult:
        return self._walk(seed_ref, direction, max_depth, max_nodes, max_edges, set(node_types), set(edge_types), set())

    def trace_static_flow(self, *, start_ref: str, direction: str = "FORWARD", max_hops: int = 10, edge_types: Iterable[str] = (), stop_node_types: Iterable[str] = (), max_results: int = 100) -> GraphQueryResult:
        follow = set(edge_types) or ({"CALLS", "RESOLVES_TO", "TRIGGERS", "AFFECTS", "HANDLED_BY", "PUBLISHES_EVENT", "CONSUMES_EVENT", "PUBLISHES_TO_QUEUE", "CONSUMES_FROM_QUEUE", "PUBLISHES_COMMAND", "HANDLES_COMMAND", "PUBLISHES_QUERY", "HANDLES_QUERY"} | set(DATA_FLOW_EDGES) | set(DECISION_EDGE_TYPES))
        return self._walk(start_ref, direction, max_hops, max_results, max_results * 5, set(), follow, set(stop_node_types))

    def inspect_data_path(self, *, start_ref: str, direction: str = "FORWARD", max_hops: int = 10, max_results: int = 100) -> GraphQueryResult:
        return self._walk(start_ref, direction, max_hops, max_results, max_results * 5, set(), set(DATA_FLOW_EDGES) | {"CALLS", "RESOLVES_TO"}, set())

    def inspect_decision_path(self, *, start_ref: str, max_hops: int = 12, action_categories: Iterable[str] = (), max_results: int = 100) -> GraphQueryResult:
        mapping = {"APPROVE": "APPROVAL", "REJECT": "REJECTION", "RANK": "RANKING", "RECOMMEND": "RECOMMENDATION", "STATUS_CHANGE": "STATUS_CHANGE"}; selected = {mapping.get(v, v) for v in action_categories}
        stops = set(BUSINESS_ACTION_NODE_TYPES); stops = stops & (selected | {"BUSINESS_ACTION"}) if selected else stops
        return self._walk(start_ref, "FORWARD", max_hops, max_results, max_results * 5, set(), set(DATA_FLOW_EDGES) | set(DECISION_EDGE_TYPES) | {"CALLS", "RESOLVES_TO", "TRIGGERS", "HANDLED_BY", "PUBLISHES_EVENT", "CONSUMES_EVENT", "PUBLISHES_TO_QUEUE", "CONSUMES_FROM_QUEUE"}, stops)

    def inspect_human_review_path(self, *, start_ref: str, max_hops: int = 12, max_results: int = 100) -> dict:
        result = self.inspect_decision_path(start_ref=start_ref, max_hops=max_hops, max_results=max_results)
        reviews = [n for n in result.nodes if n.get("node_type") in HUMAN_CONTROL_NODE_TYPES]; finals = [n for n in result.nodes if n.get("node_type") in BUSINESS_ACTION_NODE_TYPES]
        state = "PRESENT" if reviews else ("ABSENT_WITH_BOUNDED_PATH" if finals and not result.truncated else "UNKNOWN")
        return {"state": state, "reviewNodes": reviews, "finalActions": finals, **result.to_dict()}

    def provider_invocations(self, provider: str | None = None, max_results: int = 100) -> list[dict]:
        result = self.search_nodes(node_types=("AI_MODEL_INVOCATION",), max_results=max_results * 2)
        if provider: result = [n for n in result if str((n.get("attributes") or {}).get("provider") or "").upper() == provider.upper()]
        return result[:max_results]

    def symbol_context(self, symbol_ref: str, max_neighbors: int = 50) -> dict:
        canonical = self._canonical_ref(symbol_ref)
        node = next((n for n in self.graph.nodes if (n.get("source") or {}).get("symbol_ref") == symbol_ref or n.get("node_id") == canonical), None)
        if not node: return {"symbol": None, "neighbors": [], "edges": [], "evidenceRefs": []}
        nid = str(node["node_id"]); edges = [*self.inc.get(nid, []), *self.out.get(nid, [])][:max_neighbors]
        ids = {str(e["source_node_id"] if e["target_node_id"] == nid else e["target_node_id"]) for e in edges}; neighbors = [self.nodes[i] for i in sorted(ids) if i in self.nodes]
        return {"symbol": node, "neighbors": neighbors, "edges": edges, "evidenceRefs": self._refs([node, *neighbors], edges)}

    def _walk(self, seed_ref: str, direction: str, depth_limit: int, node_limit: int, edge_limit: int, node_types: set[str], edge_types: set[str], stop_types: set[str]) -> GraphQueryResult:
        seed = self._canonical_ref(seed_ref)
        if seed not in self.nodes: return GraphQueryResult([], [], [], False, [seed_ref], [])
        queue = deque([(seed, 0, [seed])]); seen_nodes = {seed}; seen_edges: set[str] = set(); order = [seed]; paths = []; unresolved: set[str] = set(); truncated = False
        while queue:
            nid, depth, path = queue.popleft(); node = self.nodes[nid]
            if node.get("node_type") == "UNRESOLVED_DYNAMIC_TARGET": unresolved.add(nid)
            if stop_types and nid != seed and node.get("node_type") in stop_types: paths.append(path); continue
            neighbors = self._neighbors(nid, direction, edge_types)
            if depth >= depth_limit:
                if neighbors: truncated = True; unresolved.add(nid)
                continue
            for edge, next_id in neighbors:
                eid = str(edge["edge_id"])
                if eid not in seen_edges and len(seen_edges) >= edge_limit: truncated = True; unresolved.add(nid); break
                seen_edges.add(eid)
                if next_id not in self.nodes: unresolved.add(next_id); continue
                if next_id not in seen_nodes:
                    if len(seen_nodes) >= node_limit: truncated = True; unresolved.add(next_id); continue
                    seen_nodes.add(next_id); order.append(next_id); queue.append((next_id, depth + 1, [*path, next_id]))
        nodes = [self.nodes[i] for i in order if not node_types or self.nodes[i].get("node_type") in node_types or i == seed]; returned = {str(n["node_id"]) for n in nodes}
        edges = [e for e in self.graph.edges if str(e["edge_id"]) in seen_edges and str(e["source_node_id"]) in returned and str(e["target_node_id"]) in returned]
        return GraphQueryResult(nodes, edges, paths, truncated, sorted(unresolved), self._refs(nodes, edges))

    def _canonical_ref(self, value: str) -> str:
        if value in self.nodes: return value
        if value.startswith(("node:", "symbol:", "finding:")) and value.count(":") == 1:
            candidate = value.split(":", 1)[1]
            if candidate in self.nodes: return candidate
        return value

    def _neighbors(self, nid: str, direction: str, edge_types: set[str]) -> list[tuple[dict, str]]:
        result = []; direction = direction.upper()
        if direction in {"FORWARD", "BOTH"}:
            result += [(e, str(e["target_node_id"])) for e in self.out.get(nid, []) if not edge_types or e.get("edge_type") in edge_types]
        if direction in {"BACKWARD", "BOTH"}:
            result += [(e, str(e["source_node_id"])) for e in self.inc.get(nid, []) if not edge_types or e.get("edge_type") in edge_types]
        return sorted(result, key=lambda item: str(item[0]["edge_id"]))

    @staticmethod
    def _refs(nodes: list[dict], edges: list[dict]) -> list[str]:
        return sorted({str(ref) for item in [*nodes, *edges] for ref in item.get("evidence_refs") or [] if str(ref)})
