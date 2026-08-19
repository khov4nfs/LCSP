from __future__ import annotations

from lcsp_workers.scanner.program_graph.models import ProgramEvidenceGraph
from lcsp_workers.scanner.program_graph.query_engine import ProgramGraphQueryEngine


def _node(node_id: str, node_type: str, *, provider: str | None = None) -> dict:
    attributes = {"provider": provider} if provider else {}
    return {
        "node_id": node_id,
        "node_type": node_type,
        "label": node_id,
        "source": {
            "file_path": f"src/{node_id}.py",
            "symbol_ref": node_id,
        },
        "attributes": attributes,
        "semantic_types": [],
        "evidence_refs": [f"evidence:{node_id}"],
    }


def _edge(edge_id: str, source: str, target: str, edge_type: str = "CALLS") -> dict:
    return {
        "edge_id": edge_id,
        "edge_type": edge_type,
        "source_node_id": source,
        "target_node_id": target,
        "evidence_refs": [f"evidence:{edge_id}"],
    }


def _graph(nodes: list[dict], edges: list[dict]) -> ProgramEvidenceGraph:
    return ProgramEvidenceGraph(
        graph_id="graph-1",
        snapshot_id="snapshot-1",
        commit_sha="abc123",
        node_count=len(nodes),
        edge_count=len(edges),
        nodes=nodes,
        edges=edges,
        graph_hash="sha256:graph",
    )


def test_search_nodes_uses_truncated_instead_of_exposing_limit_semantics() -> None:
    engine = ProgramGraphQueryEngine(
        _graph(
            [
                _node("ai-1", "AI_MODEL_INVOCATION"),
                _node("ai-2", "AI_MODEL_INVOCATION"),
            ],
            [],
        )
    )

    result = engine.search_nodes(
        node_types=("AI_MODEL_INVOCATION",),
        max_results=1,
    )

    assert [node["node_id"] for node in result] == ["ai-1"]
    assert result.truncated is True
    assert result.continuation_frontiers == ["ai-2"]
    assert result.unresolved_frontiers == []
    assert result.to_dict()["truncated"] is True


def test_bounded_walk_separates_truncation_from_real_unresolved_frontiers() -> None:
    engine = ProgramGraphQueryEngine(
        _graph(
            [
                _node("a", "FUNCTION"),
                _node("b", "FUNCTION"),
                _node("c", "FUNCTION"),
            ],
            [
                _edge("e1", "a", "b"),
                _edge("e2", "b", "c"),
            ],
        )
    )

    result = engine.trace_static_flow(start_ref="a", max_hops=1, max_results=10)

    assert result.truncated is True
    assert result.continuation_frontiers == ["b"]
    assert result.unresolved_frontiers == []


def test_dynamic_target_is_unresolved_without_becoming_search_truncation() -> None:
    engine = ProgramGraphQueryEngine(
        _graph(
            [
                _node("a", "FUNCTION"),
                _node("dynamic", "UNRESOLVED_DYNAMIC_TARGET"),
            ],
            [_edge("e1", "a", "dynamic")],
        )
    )

    result = engine.trace_static_flow(start_ref="a", max_hops=10, max_results=10)

    assert result.truncated is False
    assert result.continuation_frontiers == []
    assert result.unresolved_frontiers == ["dynamic"]


def test_provider_and_symbol_searches_expose_same_truncated_contract() -> None:
    engine = ProgramGraphQueryEngine(
        _graph(
            [
                _node("ai-1", "AI_MODEL_INVOCATION", provider="openai"),
                _node("ai-2", "AI_MODEL_INVOCATION", provider="openai"),
                _node("neighbor-1", "FUNCTION"),
                _node("neighbor-2", "FUNCTION"),
            ],
            [
                _edge("e1", "ai-1", "neighbor-1"),
                _edge("e2", "ai-1", "neighbor-2"),
            ],
        )
    )

    providers = engine.provider_invocations(provider="openai", max_results=1)
    context = engine.symbol_context("ai-1", max_neighbors=1)

    assert providers.truncated is True
    assert providers.continuation_frontiers == ["ai-2"]
    assert context["truncated"] is True
    assert context["continuationFrontiers"] == ["neighbor-2"]
    assert context["unresolvedFrontiers"] == []


def test_human_review_absence_requires_complete_search_not_specific_limit_checks() -> None:
    engine = ProgramGraphQueryEngine(
        _graph(
            [
                _node("ai", "AI_MODEL_INVOCATION"),
                _node("action", "BUSINESS_ACTION"),
                _node("tail", "FUNCTION"),
            ],
            [
                _edge("e1", "ai", "action", "TRIGGERS"),
                _edge("e2", "action", "tail", "CALLS"),
            ],
        )
    )

    complete = engine.inspect_human_review_path(
        start_ref="ai",
        max_hops=12,
        max_results=10,
    )
    truncated = engine.inspect_human_review_path(
        start_ref="ai",
        max_hops=0,
        max_results=10,
    )

    assert complete["state"] == "ABSENT_WITH_BOUNDED_PATH"
    assert complete["truncated"] is False
    assert truncated["state"] == "UNKNOWN"
    assert truncated["truncated"] is True
