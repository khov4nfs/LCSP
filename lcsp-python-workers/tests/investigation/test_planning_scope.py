from __future__ import annotations

from types import SimpleNamespace

from lcsp_workers.investigation.models import InvestigationPacket
from lcsp_workers.investigation.planning_scope import (
    ScopedEngineeringRulePlanningCandidate,
    ScopedMaterialEngineeringRulePlanner,
)
from lcsp_workers.scanner.program_graph.models import ProgramEvidenceGraph


def _rule():
    return SimpleNamespace(
        engineering_rule_id="eng-scope",
        concept="Scoped rule",
        legal_intent={},
        investigation_goals=(),
        required_evidence=("criterion",),
        starting_node_types=("AI_MODEL_INVOCATION",),
        target_node_types=("BUSINESS_DECISION",),
    )


def _packet(row: dict) -> InvestigationPacket:
    return InvestigationPacket(
        engineering_rule_id="eng-scope",
        concept="Scoped rule",
        investigation_goals=(),
        initial_results=(row,),
        required_evidence=("criterion",),
    )


def test_global_limited_does_not_inflate_rule_scope_without_material_hit() -> None:
    candidate = ScopedEngineeringRulePlanningCandidate.from_rule_packet(
        _rule(),
        _packet(
            {
                "query": "generic-ai",
                "nodes": [],
                "materialHitCount": 0,
                "rawHitCount": 50,
                "truncated": True,
                "unresolvedFrontiers": [],
            }
        ),
    )

    graph = ProgramEvidenceGraph(
        graph_id="graph",
        snapshot_id="snapshot",
        commit_sha="sha",
        node_count=0,
        edge_count=0,
        nodes=[],
        edges=[],
        coverage_state="LIMITED",
        coverage_notes=["unrelated scanner limitation"],
        unresolved_frontiers=["node:unrelated"],
        schema_version="3.0.0",
    )
    summary = ScopedMaterialEngineeringRulePlanner._graph_summary(graph)

    assert candidate.scope_coverage_state == "SUFFICIENT"
    assert candidate.scoped_truncated_query_count == 0
    assert "coverageState" not in summary
    assert "unresolvedFrontierCount" not in summary
    assert summary["coverageAuthority"] == "PER_RULE_SCOPE_COVERAGE_ONLY"


def test_material_truncation_and_frontier_are_rule_scoped() -> None:
    limited = ScopedEngineeringRulePlanningCandidate.from_rule_packet(
        _rule(),
        _packet(
            {
                "query": "decision-flow",
                "nodes": [{"node_type": "BUSINESS_DECISION"}],
                "materialHitCount": 1,
                "truncated": True,
                "unresolvedFrontiers": [],
            }
        ),
    )
    unresolved = ScopedEngineeringRulePlanningCandidate.from_rule_packet(
        _rule(),
        _packet(
            {
                "query": "decision-flow",
                "nodes": [{"node_type": "BUSINESS_DECISION"}],
                "materialHitCount": 1,
                "truncated": False,
                "unresolvedFrontiers": ["node:dynamic"],
            }
        ),
    )

    assert limited.scope_coverage_state == "LIMITED"
    assert limited.scoped_truncated_query_count == 1
    assert unresolved.scope_coverage_state == "UNRESOLVED"
    assert unresolved.scoped_unresolved_frontier_count == 1
