"""Execute deterministic EngineeringRule seed queries before LLM graph investigation."""
from __future__ import annotations

from tools.legal.corpus.engineering_rules.contract.models import EngineeringRule
from tools.common.capabilities.evidence.graph.query.query_engine import ProgramGraphQueryEngine

from tools.common.capabilities.assessment.claims.evidence_claim.models import InvestigationPacket


class InitialQueryExecutor:
    """Seed candidate graph entry points without eagerly traversing every match.

    EngineeringRule graph queries are retrieval hints, not a request to materialize all
    possible paths before the agent starts reasoning. The previous implementation traced
    up to 50 start nodes per query, creating dozens of EvidenceLedger observations that
    consumed the bounded LLM turn budget on paging. We persist one deterministic
    start-node search observation per query and pass the complete rule-owned retrieval
    contract so the investigator does not invent graph vocabulary or generic code queries.
    """

    def execute(
        self,
        rule: EngineeringRule,
        graph,
        *,
        confirmed_customer_context: dict | None = None,
    ) -> InvestigationPacket:
        engine = ProgramGraphQueryEngine(graph)
        rows: list[dict] = []
        refs: set[str] = set()

        for query in rule.graph_queries:
            starts = engine.search_nodes(
                node_types=query.start_node_types,
                semantic_types=query.semantic_types,
                max_results=50,
            )
            rows.append(
                {
                    "query": query.name,
                    "phase": "START_NODE_SEARCH",
                    **starts.to_dict(),
                }
            )
            refs.update(starts.evidence_refs)

        graph_queries = tuple(
            {
                "name": query.name,
                "startNodeTypes": list(query.start_node_types),
                "direction": query.direction,
                "followEdges": list(query.follow_edges),
                "stopNodeTypes": list(query.stop_node_types),
                "semanticTypes": list(query.semantic_types),
            }
            for query in rule.graph_queries
        )

        return InvestigationPacket(
            engineering_rule_id=rule.engineering_rule_id,
            concept=rule.concept,
            investigation_goals=rule.investigation_goals,
            initial_results=tuple(rows),
            starting_node_types=rule.starting_node_types,
            target_node_types=rule.target_node_types,
            edge_strategies=rule.edge_strategies,
            graph_queries=graph_queries,
            keywords=rule.keywords,
            common_apis=rule.common_apis,
            common_libraries=rule.common_libraries,
            patterns=rule.patterns,
            unresolved_frontiers=(),
            evidence_refs=tuple(sorted(refs)),
            confirmed_customer_context=dict(confirmed_customer_context or {}),
            required_evidence=rule.required_evidence,
            supporting_evidence=rule.supporting_evidence,
            negative_evidence=rule.negative_evidence,
            unresolved_conditions=rule.unresolved_conditions,
        )
