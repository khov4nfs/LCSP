"""Execute deterministic EngineeringRule seed queries before LLM graph investigation."""
from __future__ import annotations

from lcsp_workers.legal.engineering_rules.models import EngineeringRule
from lcsp_workers.scanner.program_graph.query_engine import ProgramGraphQueryEngine

from .models import InvestigationPacket


class InitialQueryExecutor:
    def execute(
        self,
        rule: EngineeringRule,
        graph,
        *,
        wizard_context: dict | None = None,
    ) -> InvestigationPacket:
        engine = ProgramGraphQueryEngine(graph)
        rows: list[dict] = []
        unresolved: set[str] = set()
        refs: set[str] = set()

        for query in rule.graph_queries:
            starts = engine.search_nodes(
                node_types=query.start_node_types,
                semantic_types=query.semantic_types,
                max_results=50,
            )
            for start in starts:
                result = engine.trace_static_flow(
                    start_ref=str(start["node_id"]),
                    direction=query.direction,
                    max_hops=12,
                    edge_types=query.follow_edges,
                    stop_node_types=query.stop_node_types,
                    max_results=150,
                )
                rows.append(
                    {
                        "query": query.name,
                        "startNodeId": start["node_id"],
                        **result.to_dict(),
                    }
                )
                unresolved.update(result.unresolved_frontiers)
                refs.update(result.evidence_refs)

        return InvestigationPacket(
            engineering_rule_id=rule.engineering_rule_id,
            concept=rule.concept,
            investigation_goals=rule.investigation_goals,
            initial_results=tuple(rows),
            unresolved_frontiers=tuple(sorted(unresolved)),
            evidence_refs=tuple(sorted(refs)),
            wizard_context=dict(wizard_context or {}),
            required_evidence=rule.required_evidence,
            supporting_evidence=rule.supporting_evidence,
            negative_evidence=rule.negative_evidence,
            unresolved_conditions=rule.unresolved_conditions,
        )
