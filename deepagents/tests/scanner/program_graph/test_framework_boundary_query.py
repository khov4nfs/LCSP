from __future__ import annotations

from tools.common.capabilities.evidence.graph.schema.models import ProgramEvidenceGraph
from tools.common.capabilities.evidence.graph.query.query_engine import ProgramGraphQueryEngine


def _node(node_id: str, node_type: str, label: str) -> dict:
    return {
        "node_id": node_id,
        "node_type": node_type,
        "label": label,
        "source": None,
        "attributes": {},
        "semantic_types": [],
        "evidence_refs": [],
    }


def _edge(edge_id: str, edge_type: str, source: str, target: str) -> dict:
    return {
        "edge_id": edge_id,
        "edge_type": edge_type,
        "source_node_id": source,
        "target_node_id": target,
        "confidence": 1.0,
        "attributes": {},
        "evidence_refs": [],
        "coverage_state": "SUFFICIENT",
    }


def _graph(nodes: list[dict], edges: list[dict]) -> ProgramEvidenceGraph:
    return ProgramEvidenceGraph(
        graph_id="graph",
        snapshot_id="snapshot",
        commit_sha="abc",
        node_count=len(nodes),
        edge_count=len(edges),
        nodes=nodes,
        edges=edges,
        graph_hash="sha256:test",
    )


def test_decision_path_traverses_command_dispatch_to_concrete_handler() -> None:
    nodes = [
        _node("ai", "AI_OUTPUT", "AI result"),
        _node("call", "CALL_SITE", "commandBus.execute"),
        _node("command", "COMMAND", "ApproveCommand"),
        _node("handler", "METHOD", "ApproveHandler.execute"),
        _node("action", "APPROVAL", "approve"),
    ]
    edges = [
        _edge("e1", "CALLS", "ai", "call"),
        _edge("e2", "PUBLISHES_COMMAND", "call", "command"),
        _edge("e3", "HANDLES_COMMAND", "command", "handler"),
        _edge("e4", "APPROVES", "handler", "action"),
    ]

    result = ProgramGraphQueryEngine(_graph(nodes, edges)).inspect_decision_path(
        start_ref="ai"
    )

    assert [node["node_id"] for node in result.nodes] == [
        "ai",
        "call",
        "command",
        "handler",
        "action",
    ]
    assert result.unresolved_frontiers == []


def test_legacy_framework_boundary_stop_is_reported_as_unresolved() -> None:
    nodes = [
        _node("call", "CALL_SITE", "commandBus.execute"),
        _node("command", "COMMAND", "MissingCommand"),
    ]
    edges = [_edge("e1", "PUBLISHES_COMMAND", "call", "command")]

    result = ProgramGraphQueryEngine(_graph(nodes, edges)).trace_static_flow(
        start_ref="call"
    )

    assert "command" in result.unresolved_frontiers


def test_legacy_module_only_handler_stop_is_reported_as_unresolved() -> None:
    nodes = [
        _node("call", "CALL_SITE", "commandBus.execute"),
        _node("command", "COMMAND", "LegacyCommand"),
        _node("module", "MODULE", "legacy.handler.ts"),
    ]
    edges = [
        _edge("e1", "PUBLISHES_COMMAND", "call", "command"),
        _edge("e2", "HANDLES_COMMAND", "command", "module"),
    ]

    result = ProgramGraphQueryEngine(_graph(nodes, edges)).trace_static_flow(
        start_ref="call"
    )

    assert "command" in result.unresolved_frontiers
