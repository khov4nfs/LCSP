from __future__ import annotations

from tools.planner.investigation.models import InvestigationPacket
from tools.engineer_rule.investigation.selected_rule_orchestration import (
    augment_selected_rule_packet,
)
from tools.graph.scanner.program_graph.models import ProgramEvidenceGraph


def test_selected_rule_gets_bounded_deterministic_seed_trace() -> None:
    graph = ProgramEvidenceGraph(
        graph_id="graph",
        snapshot_id="snapshot",
        commit_sha="sha",
        node_count=2,
        edge_count=1,
        nodes=[
            {
                "node_id": "node:start",
                "node_type": "AI_MODEL_INVOCATION",
                "label": "predict",
                "evidence_refs": ["source-anchor:start"],
            },
            {
                "node_id": "node:decision",
                "node_type": "BUSINESS_DECISION",
                "label": "reject",
                "evidence_refs": ["source-anchor:decision"],
            },
        ],
        edges=[
            {
                "edge_id": "edge:flow",
                "edge_type": "CALLS",
                "source_node_id": "node:start",
                "target_node_id": "node:decision",
                "evidence_refs": ["source-anchor:edge"],
            }
        ],
    )
    packet = InvestigationPacket(
        engineering_rule_id="eng-1",
        concept="decision",
        investigation_goals=(),
        initial_results=(
            {
                "query": "decision-flow",
                "phase": "START_NODE_SEARCH",
                "nodes": [graph.nodes[0]],
                "truncated": False,
                "unresolvedFrontiers": [],
                "evidenceRefs": ["source-anchor:start"],
            },
        ),
        graph_queries=(
            {
                "name": "decision-flow",
                "direction": "FORWARD",
                "followEdges": ["CALLS"],
                "stopNodeTypes": ["BUSINESS_DECISION"],
                "semanticTypes": [],
                "startNodeTypes": ["AI_MODEL_INVOCATION"],
            },
        ),
        evidence_refs=("source-anchor:start",),
    )

    augmented = augment_selected_rule_packet(packet, graph)
    traces = [
        row
        for row in augmented.initial_results
        if row.get("phase") == "DETERMINISTIC_SELECTED_RULE_TRACE"
    ]

    assert len(traces) == 1
    assert traces[0]["startRef"] == "node:start"
    assert any(node.get("node_id") == "node:decision" for node in traces[0]["nodes"])
    assert "source-anchor:decision" in augmented.evidence_refs
    assert "source-anchor:edge" in augmented.evidence_refs


def test_no_seed_nodes_does_not_create_fake_orchestration_evidence() -> None:
    graph = ProgramEvidenceGraph(
        graph_id="graph",
        snapshot_id="snapshot",
        commit_sha="sha",
        node_count=0,
        edge_count=0,
        nodes=[],
        edges=[],
    )
    packet = InvestigationPacket(
        engineering_rule_id="eng-empty",
        concept="empty",
        investigation_goals=(),
        initial_results=(
            {
                "query": "empty",
                "phase": "START_NODE_SEARCH",
                "nodes": [],
                "truncated": False,
            },
        ),
        graph_queries=(
            {
                "name": "empty",
                "direction": "FORWARD",
                "followEdges": ["CALLS"],
                "stopNodeTypes": [],
                "semanticTypes": [],
                "startNodeTypes": ["AI_MODEL_INVOCATION"],
            },
        ),
    )

    assert augment_selected_rule_packet(packet, graph) is packet
