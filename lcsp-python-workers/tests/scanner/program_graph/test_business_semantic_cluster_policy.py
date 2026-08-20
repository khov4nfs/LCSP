from __future__ import annotations

from collections import Counter

from lcsp_workers.scanner.program_graph.business_semantic_cluster_policy import (
    DiverseBusinessSemanticEnricher,
)
from lcsp_workers.scanner.program_graph.models import ProgramEvidenceGraph


def _node(node_id: str, node_type: str) -> dict:
    return {
        "node_id": node_id,
        "node_type": node_type,
        "label": node_id,
        "origin": "STATIC_ANALYSIS",
        "resolution_state": "OBSERVED",
        "coverage_state": "SUFFICIENT",
        "semantic_types": [],
        "evidence_refs": [],
        "support_refs": [],
    }


def test_cluster_budget_preserves_non_http_entrypoint_diversity() -> None:
    nodes = [_node(f"node:http:{index}", "HTTP_ROUTE") for index in range(20)]
    nodes.extend(
        [
            _node("node:event", "EVENT"),
            _node("node:queue", "QUEUE"),
            _node("node:training", "TRAINING_JOB"),
        ]
    )
    graph = ProgramEvidenceGraph(
        graph_id="graph",
        snapshot_id="snapshot",
        commit_sha="sha",
        node_count=len(nodes),
        edge_count=0,
        nodes=nodes,
        edges=[],
        coverage_state="LIMITED",
        coverage_notes=["unrelated repository-global limitation"],
        schema_version="3.0.0",
    )

    contexts = DiverseBusinessSemanticEnricher._cluster_contexts(graph)
    distribution = Counter(context["entrypointType"] for context in contexts)

    assert len(contexts) <= 16
    assert distribution["HTTP_ROUTE"] == 4
    assert distribution["EVENT"] == 1
    assert distribution["QUEUE"] == 1
    assert distribution["TRAINING_JOB"] == 1


def test_single_entrypoint_family_can_use_full_cluster_budget() -> None:
    nodes = [_node(f"node:http:{index}", "HTTP_ROUTE") for index in range(20)]
    graph = ProgramEvidenceGraph(
        graph_id="graph-http",
        snapshot_id="snapshot",
        commit_sha="sha",
        node_count=len(nodes),
        edge_count=0,
        nodes=nodes,
        edges=[],
        schema_version="3.0.0",
    )

    contexts = DiverseBusinessSemanticEnricher._cluster_contexts(graph)

    assert len(contexts) == 16
    assert {context["entrypointType"] for context in contexts} == {"HTTP_ROUTE"}


def test_business_cluster_coverage_is_scoped_not_graph_global() -> None:
    graph = ProgramEvidenceGraph(
        graph_id="graph",
        snapshot_id="snapshot",
        commit_sha="sha",
        node_count=1,
        edge_count=0,
        nodes=[_node("node:http", "HTTP_ROUTE")],
        edges=[],
        coverage_state="LIMITED",
        coverage_notes=["limitation in unrelated subsystem"],
        unresolved_frontiers=["missing_graph_node:unrelated"],
        schema_version="3.0.0",
    )

    context = DiverseBusinessSemanticEnricher._cluster_contexts(graph)[0]

    assert context["coverageState"] == "SUFFICIENT"
    assert context["coverageScope"] == "BUSINESS_CLUSTER"
    assert context["unresolvedFrontiers"] == []
