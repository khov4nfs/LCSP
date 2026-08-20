"""Deterministic quota/diversity policy for LLM business-semantic graph clusters."""
from __future__ import annotations

from collections import Counter
from typing import Any

from lcsp_workers.platform.logging import get_logger

from . import business_semantic_enrichment as base
from .business_semantic_enrichment import BusinessSemanticEnricher
from .models import ProgramEvidenceGraph


logger = get_logger(__name__)

# When multiple entrypoint families exist, one family may contribute at most four
# clusters. Unused capacity is intentionally left unused rather than re-filling the
# budget with HTTP routes and reintroducing the same semantic sampling bias.
_MAX_CLUSTERS_PER_ENTRYPOINT_TYPE_WHEN_DIVERSE = 4


class DiverseBusinessSemanticEnricher(BusinessSemanticEnricher):
    """Select bounded business clusters with deterministic entrypoint diversity."""

    @classmethod
    def _context_from_ids(
        cls,
        graph: ProgramEvidenceGraph,
        *,
        node_ids: set[str],
        edge_ids: set[str],
        cluster_id: str,
        entrypoint: dict[str, Any] | None,
    ) -> dict[str, Any]:
        context = super()._context_from_ids(
            graph,
            node_ids=node_ids,
            edge_ids=edge_ids,
            cluster_id=cluster_id,
            entrypoint=entrypoint,
        )
        scoped_nodes = [
            node
            for node in graph.nodes
            if str(node.get("node_id") or "") in node_ids
        ]
        scoped_edges = [
            edge
            for edge in graph.edges
            if str(edge.get("edge_id") or "") in edge_ids
        ]
        scoped_unresolved = sorted(
            {
                str(ref)
                for ref in graph.unresolved_frontiers
                if str(ref) in node_ids
            }
            | {
                str(node.get("node_id"))
                for node in scoped_nodes
                if str(node.get("resolution_state") or "") == "UNRESOLVED"
            }
        )[:20]
        scoped_limited = bool(scoped_unresolved) or any(
            str(item.get("coverage_state") or "SUFFICIENT") == "LIMITED"
            for item in [*scoped_nodes, *scoped_edges]
        )
        # Base enrichment retains repository diagnostics for backward compatibility.
        # Replace them here with only the uncertainty that intersects this cluster;
        # non-node/global diagnostics must not make every cluster LIMITED.
        context["unresolvedFrontiers"] = scoped_unresolved
        context["coverageState"] = "LIMITED" if scoped_limited else "SUFFICIENT"
        context["coverageScope"] = "BUSINESS_CLUSTER"
        return context

    @classmethod
    def _cluster_contexts(cls, graph: ProgramEvidenceGraph) -> list[dict[str, Any]]:
        node_by_id = {
            str(node.get("node_id")): node
            for node in graph.nodes
            if node.get("node_id")
        }
        adjacency: dict[str, list[tuple[str, dict[str, Any]]]] = {}
        for edge in graph.edges:
            if edge.get("edge_type") in base._CLUSTER_EXCLUDED_EDGE_TYPES:
                continue
            source = str(edge.get("source_node_id") or "")
            target = str(edge.get("target_node_id") or "")
            if source not in node_by_id or target not in node_by_id:
                continue
            adjacency.setdefault(source, []).append((target, edge))
            adjacency.setdefault(target, []).append((source, edge))

        entrypoints = [
            node
            for node in graph.nodes
            if node.get("node_type") in base._ENTRYPOINT_NODE_TYPES
            and cls._context_trusted(node)
        ]
        entrypoints.sort(
            key=lambda node: (
                base._ENTRYPOINT_PRIORITY.get(str(node.get("node_type")), 99),
                str(node.get("label") or ""),
                str(node.get("node_id") or ""),
            )
        )
        if not entrypoints:
            return super()._cluster_contexts(graph)

        groups: dict[str, list[dict[str, Any]]] = {}
        for entrypoint in entrypoints:
            groups.setdefault(str(entrypoint.get("node_type") or "UNKNOWN"), []).append(
                entrypoint
            )
        ordered_types = sorted(
            groups,
            key=lambda value: (base._ENTRYPOINT_PRIORITY.get(value, 99), value),
        )
        cursors = {value: 0 for value in ordered_types}
        selected: list[tuple[set[str], dict[str, Any]]] = []
        selected_counts: Counter[str] = Counter()
        diverse = len(ordered_types) > 1

        def add_next(entrypoint_type: str) -> bool:
            if (
                diverse
                and selected_counts[entrypoint_type]
                >= _MAX_CLUSTERS_PER_ENTRYPOINT_TYPE_WHEN_DIVERSE
            ):
                return False
            rows = groups[entrypoint_type]
            while cursors[entrypoint_type] < len(rows):
                entrypoint = rows[cursors[entrypoint_type]]
                cursors[entrypoint_type] += 1
                node_ids, edge_ids = cls._bounded_cluster(
                    str(entrypoint["node_id"]),
                    node_by_id,
                    adjacency,
                )
                if not node_ids:
                    continue
                if cls._overlaps_existing(node_ids, [row[0] for row in selected]):
                    continue
                context = cls._context_from_ids(
                    graph,
                    node_ids=node_ids,
                    edge_ids=edge_ids,
                    cluster_id=cls._cluster_id(entrypoint),
                    entrypoint=entrypoint,
                )
                if not context["nodes"]:
                    continue
                selected.append((node_ids, context))
                selected_counts[entrypoint_type] += 1
                return True
            return False

        # Pass 1 reserves one slot for every entrypoint family before any family can
        # consume a second slot.
        for entrypoint_type in ordered_types:
            if len(selected) >= base._MAX_CLUSTERS:
                break
            add_next(entrypoint_type)

        # Pass 2 round-robins the remaining budget. The per-family cap is hard whenever
        # the repository exposes more than one family; fewer than 16 LLM calls is better
        # than filling the remainder with one dominant transport such as HTTP.
        progress = True
        while len(selected) < base._MAX_CLUSTERS and progress:
            progress = False
            for entrypoint_type in ordered_types:
                if len(selected) >= base._MAX_CLUSTERS:
                    break
                if add_next(entrypoint_type):
                    progress = True

        if not selected:
            return super()._cluster_contexts(graph)

        logger.info(
            "BUSINESS_SEMANTIC_CLUSTER_SELECTION",
            candidate_entrypoint_counts=dict(
                Counter(str(node.get("node_type")) for node in entrypoints)
            ),
            selected_entrypoint_counts=dict(selected_counts),
            selected_cluster_count=len(selected),
            cluster_budget=base._MAX_CLUSTERS,
            per_type_quota=(
                _MAX_CLUSTERS_PER_ENTRYPOINT_TYPE_WHEN_DIVERSE if diverse else None
            ),
        )
        return [context for _, context in selected]
