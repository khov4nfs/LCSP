"""Criterion-specific topology checks for closed EngineeringRule evidence claims.

Existence and lexical relevance of provenance are necessary but not sufficient for a
path claim. This validator requires the observation-derived graphPathRefs themselves to
contain the structural relation asserted by selected path-oriented criteria.
"""
from __future__ import annotations

import re
from collections import deque
from typing import Iterable

from tools.graph.scanner.program_graph.models import ProgramEvidenceGraph


class ClaimTopologyValidationError(ValueError):
    pass


_ACTION_TYPES = frozenset(
    {
        "BUSINESS_DECISION",
        "BUSINESS_ACTION",
        "BUSINESS_OUTCOME",
        "APPROVAL",
        "REJECTION",
        "RANKING",
        "RECOMMENDATION",
        "STATUS_CHANGE",
    }
)
_EFFECT_NODE_TYPES = frozenset(
    {
        "REPOSITORY_ACCESS",
        "DATABASE",
        "TABLE",
        "ENTITY",
        "EXTERNAL_API",
        "EXTERNAL_SERVICE",
        "FILE_STORAGE",
        "QUEUE",
        "EVENT",
    }
)
_EFFECT_EDGE_TYPES = frozenset(
    {"WRITES_TO", "PERSISTS_TO", "SENDS_TO_EXTERNAL", "WRITES_BUSINESS_STATE"}
)
_FLOW_EDGE_TYPES = frozenset(
    {
        "FLOWS_TO",
        "RECEIVES_FROM_AI",
        "SENDS_TO_AI",
        "PASSES_ARGUMENT",
        "RECEIVES_RETURN",
        "ASSIGNS",
        "ALIASES",
        "TRANSFORMS",
        "PARSES",
        "VALIDATES",
        "INFLUENCES_DECISION",
        "PRODUCES_OUTCOME",
        "WRITES_BUSINESS_STATE",
        "WRITES_TO",
        "PERSISTS_TO",
        "SENDS_TO_EXTERNAL",
        "REVIEWED_BY",
        "OVERRIDDEN_BY",
        "REQUIRES_HUMAN_REVIEW",
    }
)
_HUMAN_EDGE_TYPES = frozenset(
    {"REVIEWED_BY", "OVERRIDDEN_BY", "REQUIRES_HUMAN_REVIEW"}
)
_HUMAN_TYPES = frozenset({"HUMAN_REVIEW", "HUMAN_OVERRIDE"})
_DATA_SINK_TYPES = frozenset(
    {
        "AI_MODEL_INVOCATION",
        "AI_INPUT",
        "REPOSITORY_ACCESS",
        "DATABASE",
        "TABLE",
        "EXTERNAL_API",
        "EXTERNAL_SERVICE",
        "FILE_STORAGE",
    }
)


def topology_criterion_kind(criterion: str | None) -> str | None:
    tokens = {
        token.lower()
        for token in re.findall(r"[A-Za-z0-9]+", str(criterion or "").replace("_", " "))
    }
    if {"ai", "output", "path"}.issubset(tokens):
        return "AI_OUTPUT_PATH"
    if {"downstream", "action", "path"}.issubset(tokens):
        return "DOWNSTREAM_ACTION_PATH"
    if {"human", "control"}.issubset(tokens) and tokens.intersection(
        {"state", "review", "oversight"}
    ):
        return "HUMAN_CONTROL_STATE"
    if {"sensitive", "data"}.issubset(tokens) and tokens.intersection(
        {"lineage", "flow", "path"}
    ):
        return "SENSITIVE_DATA_LINEAGE"
    return None


def validate_claim_topology(
    *,
    criterion: str | None,
    graph_path_refs: Iterable[str],
    graph: ProgramEvidenceGraph,
    claim_value: bool | None = None,
) -> None:
    kind = topology_criterion_kind(criterion)
    if kind is None:
        return

    refs = {str(ref) for ref in graph_path_refs if str(ref)}
    if not refs:
        raise ClaimTopologyValidationError(
            f"{kind} requires observation-derived graph path refs"
        )

    node_by_id = {
        str(node.get("node_id")): node
        for node in graph.nodes
        if node.get("node_id")
    }
    edge_by_id = {
        str(edge.get("edge_id")): edge
        for edge in graph.edges
        if edge.get("edge_id")
    }
    selected_edges = [edge_by_id[ref] for ref in refs if ref in edge_by_id]
    selected_node_ids = {ref for ref in refs if ref in node_by_id}
    for edge in selected_edges:
        selected_node_ids.add(str(edge.get("source_node_id") or ""))
        selected_node_ids.add(str(edge.get("target_node_id") or ""))
    selected_nodes = {
        node_id: node_by_id[node_id]
        for node_id in selected_node_ids
        if node_id in node_by_id
    }

    if not selected_edges:
        raise ClaimTopologyValidationError(
            f"{kind} requires graph edge provenance, not node existence only"
        )
    if any(
        node.get("node_type") == "UNRESOLVED_DYNAMIC_TARGET"
        or str(node.get("resolution_state") or "") == "UNRESOLVED"
        for node in selected_nodes.values()
    ):
        raise ClaimTopologyValidationError(
            f"{kind} cannot close over an unresolved dynamic path"
        )

    if kind == "AI_OUTPUT_PATH":
        if claim_value is False:
            raise ClaimTopologyValidationError(
                "AI_OUTPUT_PATH absence cannot be closed from positive path refs; return unresolved"
            )
        if not _has_ai_output_edge(selected_edges, selected_nodes):
            raise ClaimTopologyValidationError(
                "AI_OUTPUT_PATH requires AI_MODEL_INVOCATION -> RECEIVES_FROM_AI -> AI_OUTPUT"
            )
        return

    if kind == "DOWNSTREAM_ACTION_PATH":
        if claim_value is False:
            raise ClaimTopologyValidationError(
                "DOWNSTREAM_ACTION_PATH absence requires bounded negative analysis; return unresolved"
            )
        _validate_downstream_action(selected_edges, selected_nodes)
        return

    if kind == "HUMAN_CONTROL_STATE":
        _validate_human_control(
            selected_edges,
            selected_nodes,
            expect_present=claim_value is not False,
        )
        return

    if kind == "SENSITIVE_DATA_LINEAGE":
        if claim_value is False:
            raise ClaimTopologyValidationError(
                "SENSITIVE_DATA_LINEAGE absence requires bounded negative analysis; return unresolved"
            )
        _validate_sensitive_lineage(selected_edges, selected_nodes)


def _has_ai_output_edge(edges: list[dict], nodes: dict[str, dict]) -> bool:
    for edge in edges:
        if edge.get("edge_type") != "RECEIVES_FROM_AI":
            continue
        source = nodes.get(str(edge.get("source_node_id") or ""))
        target = nodes.get(str(edge.get("target_node_id") or ""))
        if (
            source
            and target
            and source.get("node_type") == "AI_MODEL_INVOCATION"
            and target.get("node_type") == "AI_OUTPUT"
            and _trusted(source)
            and _trusted(target)
        ):
            return True
    return False


def _validate_downstream_action(edges: list[dict], nodes: dict[str, dict]) -> None:
    ai_outputs = {
        node_id
        for node_id, node in nodes.items()
        if node.get("node_type") == "AI_OUTPUT" and _trusted(node)
    }
    actions = {
        node_id
        for node_id, node in nodes.items()
        if node.get("node_type") in _ACTION_TYPES and _trusted(node)
    }
    if not ai_outputs or not actions:
        raise ClaimTopologyValidationError(
            "DOWNSTREAM_ACTION_PATH requires trusted AI_OUTPUT and business action nodes"
        )

    adjacency = _adjacency(edges)
    reached_actions = {
        action
        for start in ai_outputs
        for action in actions
        if _reachable(start, action, adjacency)
    }
    if not reached_actions:
        raise ClaimTopologyValidationError(
            "DOWNSTREAM_ACTION_PATH does not connect AI output to a business action"
        )

    effect_edges = [
        edge
        for edge in edges
        if edge.get("edge_type") in _EFFECT_EDGE_TYPES
        and str(edge.get("source_node_id") or "") in reached_actions
    ]
    if effect_edges:
        return

    effect_nodes = {
        node_id
        for node_id, node in nodes.items()
        if node.get("node_type") in _EFFECT_NODE_TYPES and _trusted(node)
    }
    if any(
        _reachable(action, effect, adjacency)
        for action in reached_actions
        for effect in effect_nodes
    ):
        return
    raise ClaimTopologyValidationError(
        "DOWNSTREAM_ACTION_PATH requires a persisted/external business effect"
    )


def _validate_human_control(
    edges: list[dict],
    nodes: dict[str, dict],
    *,
    expect_present: bool,
) -> None:
    decisions = {
        node_id
        for node_id, node in nodes.items()
        if node.get("node_type") == "BUSINESS_DECISION" and _trusted(node)
    }
    effects = {
        node_id
        for node_id, node in nodes.items()
        if node.get("node_type") in _EFFECT_NODE_TYPES and _trusted(node)
    }
    adjacency = _adjacency(edges)
    bounded_decision_effect = any(
        _reachable(decision, effect, adjacency)
        for decision in decisions
        for effect in effects
    )

    human_edges = []
    for edge in edges:
        if edge.get("edge_type") not in _HUMAN_EDGE_TYPES:
            continue
        source = nodes.get(str(edge.get("source_node_id") or ""))
        target = nodes.get(str(edge.get("target_node_id") or ""))
        if not source or not target:
            continue
        if (
            source.get("node_type") == "BUSINESS_DECISION"
            and target.get("node_type") in _HUMAN_TYPES
            and _trusted(source)
            and _trusted(target)
        ):
            human_edges.append(edge)

    if expect_present:
        if human_edges:
            return
        raise ClaimTopologyValidationError(
            "HUMAN_CONTROL_STATE requires the same decision path to reach HUMAN_REVIEW/HUMAN_OVERRIDE"
        )

    # Negative human-control claims are allowed only as bounded absence: the selected
    # refs must contain the concrete decision-to-effect path and no attached human
    # control. A disconnected search page can never prove absence.
    if not decisions or not effects or not bounded_decision_effect:
        raise ClaimTopologyValidationError(
            "HUMAN_CONTROL_STATE absence requires a bounded decision-to-effect path"
        )
    if human_edges:
        raise ClaimTopologyValidationError(
            "HUMAN_CONTROL_STATE absence conflicts with an attached human control"
        )


def _validate_sensitive_lineage(edges: list[dict], nodes: dict[str, dict]) -> None:
    sensitive = {
        node_id
        for node_id, node in nodes.items()
        if _trusted(node)
        and (
            node.get("node_type") in {"PERSONAL_DATA", "SENSITIVE_DATA"}
            or any(
                str(value).startswith(("PII.", "SENSITIVE."))
                for value in node.get("semantic_types") or []
            )
        )
    }
    sinks = {
        node_id
        for node_id, node in nodes.items()
        if node.get("node_type") in _DATA_SINK_TYPES and _trusted(node)
    }
    if not sensitive or not sinks:
        raise ClaimTopologyValidationError(
            "SENSITIVE_DATA_LINEAGE requires trusted sensitive data and a material sink"
        )
    adjacency = _adjacency(edges)
    if any(_reachable(source, sink, adjacency) for source in sensitive for sink in sinks):
        return
    raise ClaimTopologyValidationError(
        "SENSITIVE_DATA_LINEAGE refs do not contain a sensitive-data flow to a material sink"
    )


def _adjacency(edges: list[dict]) -> dict[str, set[str]]:
    result: dict[str, set[str]] = {}
    for edge in edges:
        if edge.get("edge_type") not in _FLOW_EDGE_TYPES:
            continue
        source = str(edge.get("source_node_id") or "")
        target = str(edge.get("target_node_id") or "")
        if source and target:
            result.setdefault(source, set()).add(target)
    return result


def _reachable(
    start: str,
    target: str,
    adjacency: dict[str, set[str]],
    *,
    max_hops: int = 12,
) -> bool:
    if start == target:
        return True
    queue = deque([(start, 0)])
    seen = {start}
    while queue:
        current, depth = queue.popleft()
        if depth >= max_hops:
            continue
        for nxt in adjacency.get(current, set()):
            if nxt == target:
                return True
            if nxt in seen:
                continue
            seen.add(nxt)
            queue.append((nxt, depth + 1))
    return False


def _trusted(node: dict) -> bool:
    state = str(node.get("resolution_state") or "OBSERVED")
    if state not in {"OBSERVED", "CORROBORATED"}:
        return False
    if str(node.get("origin") or "") == "LLM_SEMANTIC_ENRICHMENT":
        return state == "CORROBORATED" and bool(node.get("support_refs"))
    return True
