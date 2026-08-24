"""Deterministic selected-rule graph orchestration before the LLM investigation loop."""
from __future__ import annotations

from dataclasses import replace
from typing import Any

from tools.common.platform.logging import get_logger
from tools.graph.scanner.program_graph.query_engine import ProgramGraphQueryEngine

from tools.planner.investigation.models import InvestigationPacket


logger = get_logger(__name__)

MAX_DETERMINISTIC_SELECTED_RULE_TRACES = 4
MAX_DETERMINISTIC_STARTS_PER_QUERY = 1


def augment_selected_rule_packet(
    packet: InvestigationPacket,
    graph,
    *,
    workflow_run_id: str | None = None,
    correlation_id: str | None = None,
) -> InvestigationPacket:
    """Add a few contract-owned traces after Planner SELECT and before the first LLM turn.

    Seed search remains cheap for all candidates. Only selected rules receive this bounded
    deterministic expansion. The LLM therefore starts from concrete graph paths instead
    of spending early native-tool turns rediscovering the same starting nodes, while LCSP
    avoids the former eager 50-start-node fan-out.
    """

    if not packet.initial_results or not packet.graph_queries:
        return packet

    engine = ProgramGraphQueryEngine(graph)
    contracts = {
        str(query.get("name") or ""): query
        for query in packet.graph_queries
        if isinstance(query, dict) and query.get("name")
    }
    rows = list(packet.initial_results)
    evidence_refs = set(packet.evidence_refs)
    unresolved_frontiers = set(packet.unresolved_frontiers)
    trace_count = 0
    seen_starts: set[tuple[str, str]] = set()

    for seed in packet.initial_results:
        if trace_count >= MAX_DETERMINISTIC_SELECTED_RULE_TRACES:
            break
        if not isinstance(seed, dict):
            continue
        query_name = str(seed.get("query") or "")
        contract = contracts.get(query_name)
        if contract is None:
            continue
        starts = [
            node
            for node in seed.get("nodes") or []
            if isinstance(node, dict) and node.get("node_id")
        ]
        starts_used = 0
        for node in starts:
            if trace_count >= MAX_DETERMINISTIC_SELECTED_RULE_TRACES:
                break
            if starts_used >= MAX_DETERMINISTIC_STARTS_PER_QUERY:
                break
            start_ref = str(node["node_id"])
            identity = (query_name, start_ref)
            if identity in seen_starts:
                continue
            seen_starts.add(identity)

            result = engine.trace_static_flow(
                start_ref=start_ref,
                direction=str(contract.get("direction") or "FORWARD"),
                edge_types=tuple(
                    str(value)
                    for value in contract.get("followEdges") or []
                    if value
                ),
                stop_node_types=tuple(
                    str(value)
                    for value in contract.get("stopNodeTypes") or []
                    if value
                ),
                max_hops=8,
                max_results=80,
            )
            payload: dict[str, Any] = {
                "query": query_name,
                "phase": "DETERMINISTIC_SELECTED_RULE_TRACE",
                "startRef": start_ref,
                **result.to_dict(),
            }
            rows.append(payload)
            evidence_refs.update(result.evidence_refs)
            unresolved_frontiers.update(result.unresolved_frontiers)
            trace_count += 1
            starts_used += 1

    if not trace_count:
        return packet

    logger.info(
        "ENGINEERING_SELECTED_RULE_DETERMINISTIC_TRACES_READY",
        engineering_rule_id=packet.engineering_rule_id,
        deterministic_trace_count=trace_count,
        evidence_ref_count=len(evidence_refs),
        unresolved_frontier_count=len(unresolved_frontiers),
        workflow_run_id=workflow_run_id,
        correlationId=correlation_id,
    )
    return replace(
        packet,
        initial_results=tuple(rows),
        unresolved_frontiers=tuple(sorted(unresolved_frontiers)),
        evidence_refs=tuple(sorted(evidence_refs)),
    )
