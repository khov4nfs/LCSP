from __future__ import annotations

from unittest.mock import patch

from tools.planner.investigation.initial_query_executor import InitialQueryExecutor
from tools.legal.legal.engineering_rules.models import EngineeringRule, GraphQueryTemplate


class _Starts:
    evidence_refs = ("evidence:1", "evidence:2")

    def to_dict(self) -> dict:
        return {
            "nodes": [
                {"node_id": "node-1", "evidence_refs": ["evidence:1"]},
                {"node_id": "node-2", "evidence_refs": ["evidence:2"]},
            ],
            "truncated": True,
            "continuationFrontiers": ["node-3"],
            "unresolvedFrontiers": [],
            "evidenceRefs": list(self.evidence_refs),
        }


class _Engine:
    def __init__(self) -> None:
        self.search_calls = 0

    def search_nodes(self, **_kwargs):
        self.search_calls += 1
        return _Starts()

    def trace_static_flow(self, **_kwargs):
        raise AssertionError("seed retrieval must not eagerly trace every start node")


def _rule() -> EngineeringRule:
    return EngineeringRule(
        engineering_rule_id="eng-1",
        legal_rule_id="law-1",
        legal_rule_catalog_version_id="catalog-1",
        legal_corpus_version_id="corpus-1",
        concept="HUMAN_OVERSIGHT",
        legal_intent={},
        investigation_goals=("Find the relevant review control",),
        starting_node_types=("HUMAN_REVIEW",),
        target_node_types=("APPROVAL",),
        edge_strategies=("CALLS",),
        graph_queries=(
            GraphQueryTemplate(
                name="review-entrypoints",
                start_node_types=("HUMAN_REVIEW",),
                direction="FORWARD",
                follow_edges=("CALLS",),
                stop_node_types=("APPROVAL",),
                semantic_types=("HUMAN_OVERSIGHT",),
            ),
        ),
        keywords=("review", "approve", "override"),
        common_apis=("approveDecision",),
        common_libraries=("workflow",),
        patterns=("human review",),
        required_evidence=("A concrete review path",),
    )


def test_seed_query_records_candidate_search_once_and_defers_path_traversal() -> None:
    engine = _Engine()
    with patch(
        "tools.planner.investigation.initial_query_executor.ProgramGraphQueryEngine",
        return_value=engine,
    ):
        packet = InitialQueryExecutor().execute(_rule(), graph={})

    assert engine.search_calls == 1
    assert len(packet.initial_results) == 1
    assert packet.initial_results[0]["phase"] == "START_NODE_SEARCH"
    assert packet.initial_results[0]["truncated"] is True
    assert packet.evidence_refs == ("evidence:1", "evidence:2")
    assert packet.unresolved_frontiers == ()

    assert packet.starting_node_types == ("HUMAN_REVIEW",)
    assert packet.target_node_types == ("APPROVAL",)
    assert packet.edge_strategies == ("CALLS",)
    assert packet.keywords == ("review", "approve", "override")
    assert packet.common_apis == ("approveDecision",)
    assert packet.common_libraries == ("workflow",)
    assert packet.patterns == ("human review",)
    assert packet.graph_queries == (
        {
            "name": "review-entrypoints",
            "startNodeTypes": ["HUMAN_REVIEW"],
            "direction": "FORWARD",
            "followEdges": ["CALLS"],
            "stopNodeTypes": ["APPROVAL"],
            "semanticTypes": ["HUMAN_OVERSIGHT"],
        },
    )
