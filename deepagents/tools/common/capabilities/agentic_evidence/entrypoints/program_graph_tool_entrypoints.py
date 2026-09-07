"""Canonical Python-local technical investigation tools over Unified System Evidence Graph."""
from __future__ import annotations

from typing import Any, Mapping

from tools.common.capabilities.evidence.graph.query.query_engine import ProgramGraphQueryEngine

from ..governance.registry import AgenticToolRequest


def _graph(
    request: AgenticToolRequest,
    context,
) -> tuple[ProgramGraphQueryEngine, dict]:
    report_ref = request.artifact_versions.get(
        "technicalEvidenceReportId"
    ) or request.artifact_versions.get("technical_evidence_report_id")
    if not report_ref:
        raise ValueError("technicalEvidenceReportId is required")
    report = context.api_client.get_accepted_technical_evidence_report(report_ref)
    if not report or not isinstance(report, dict):
        raise ValueError("EVIDENCE_REPORT_NOT_FOUND")

    # Validate report belongs to the request's assessment
    report_assessment_id = report.get("assessmentId") or report.get("assessment_id")
    if report_assessment_id and request.assessment_id and str(report_assessment_id) != str(request.assessment_id):
        raise ValueError("EVIDENCE_REPORT_ASSESSMENT_MISMATCH")

    # Validate report corresponds to pinned snapshot if specified
    pinned_snapshot_id = request.artifact_versions.get("repositorySnapshotId") or request.artifact_versions.get("repository_snapshot_id")
    report_snapshot_id = report.get("snapshotId") or report.get("snapshot_id")
    if pinned_snapshot_id and report_snapshot_id and str(pinned_snapshot_id) != str(report_snapshot_id):
        raise ValueError("EVIDENCE_REPORT_SNAPSHOT_MISMATCH")

    status = str(report.get("status") or "ACCEPTED").upper()
    if status in {"REJECTED"}:
        raise ValueError("EVIDENCE_REPORT_REJECTED")

    evidence = (
        report.get("evidence_payload")
        or report.get("evidencePayload")
        or report.get("contentJson")
        or {}
    )
    if isinstance(evidence, dict) and "evidence_payload" in evidence:
        evidence = evidence["evidence_payload"]
    graph = (
        evidence.get("evidence_graph")
        or evidence.get("program_evidence_graph")
        or evidence.get("programEvidenceGraph")
        if isinstance(evidence, dict)
        else None
    )
    if not isinstance(graph, dict):
        raise ValueError("PROGRAM_EVIDENCE_GRAPH_NOT_AVAILABLE")

    import json
    import os

    ref = graph.get("evidence_graph_ref") or graph.get("evidenceGraphRef")
    if ref and isinstance(ref, str) and os.path.exists(ref):
        try:
            with open(ref) as file:
                file_payload = json.load(file)
                if isinstance(file_payload, dict):
                    graph = {**file_payload, **graph}
        except Exception:
            pass

    return ProgramGraphQueryEngine(graph), report


def _input(request: AgenticToolRequest, name: str, default=None):
    return request.input.get(name, default)


def _start(request: AgenticToolRequest, required: bool = False) -> str:
    val = str(
        _input(request, "startRef")
        or _input(request, "start_ref")
        or _input(request, "seedRef")
        or _input(request, "seed_ref")
        or _input(request, "subjectRef")
        or _input(request, "subject_ref")
        or _input(request, "symbolRef")
        or _input(request, "symbol_ref")
        or ""
    ).strip()
    if required and not val:
        raise ValueError("startRef or subjectRef is required for graph traversal")
    return val


def _max_hops(request: AgenticToolRequest) -> int:
    val = _input(request, "maxHops") or _input(request, "max_hops") or _input(request, "maxDepth") or _input(request, "max_depth")
    max_limit = getattr(request.budget, "max_depth", 20)
    try:
        hops = int(val) if val is not None else max_limit
    except (TypeError, ValueError):
        hops = max_limit
    return min(max(1, hops), max_limit)


def _max_results(request: AgenticToolRequest, fallback_max: int | None = None) -> int:
    val = _input(request, "maxResults") or _input(request, "max_results")
    max_limit = getattr(request.budget, "max_items", 50)
    if fallback_max is not None:
        max_limit = min(max_limit, fallback_max)
    try:
        res = int(val) if val is not None else max_limit
    except (TypeError, ValueError):
        res = max_limit
    return min(max(1, res), max_limit)


_MODEL_FORBIDDEN_KEYS = frozenset({
    "source", "source_code", "raw_source", "raw_content", "full_source",
    "prompt", "prompt_text", "full_prompt", "ast_body", "full_ast", "ast_dump",
    "secret", "token", "api_key", "api_token", "authorization", "credential",
    "password", "command", "shell"
})


def _sanitize_for_model(value: Any) -> Any:
    """Recursively strip raw source code, secrets, and credentials before returning to agent."""
    if isinstance(value, Mapping):
        out = {}
        for k, v in value.items():
            norm_k = str(k).replace("-", "_").lower()
            if norm_k in _MODEL_FORBIDDEN_KEYS:
                continue
            out[k] = _sanitize_for_model(v)
        return out
    if isinstance(value, list):
        return [_sanitize_for_model(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_sanitize_for_model(item) for item in value)
    return value


def _project_safe_node(node: dict[str, Any]) -> dict[str, Any]:
    """Strict DTO projection for nodes returning to the agent: no attributes, source, code, or secrets."""
    from subagents.interview.customer_safe_projection import (
        normalize_resolution_state,
        sanitize_customer_facing_text,
    )
    return {
        "node_id": str(node.get("node_id") or ""),
        "node_type": str(node.get("node_type") or node.get("type") or "NODE"),
        "label": sanitize_customer_facing_text(str(node.get("label") or node.get("name") or "")),
        "semantic_types": list(node.get("semantic_types") or []),
        "resolution_state": normalize_resolution_state(node.get("resolution_state") or node.get("resolutionState")),
        "evidence_refs": list(node.get("evidence_refs") or node.get("evidenceRefs") or []),
    }


def _project_safe_edge(edge: Mapping[str, Any]) -> dict[str, Any]:
    """Strict DTO projection for edges returning to the agent: no attributes, source code, debug info, or secrets."""
    from subagents.interview.customer_safe_projection import normalize_resolution_state
    return {
        "source_node_id": str(edge.get("source_node_id") or edge.get("source_id") or edge.get("source") or ""),
        "target_node_id": str(edge.get("target_node_id") or edge.get("target_id") or edge.get("target") or ""),
        "edge_type": str(edge.get("edge_type") or edge.get("type") or "EDGE"),
        "resolution_state": normalize_resolution_state(edge.get("resolution_state") or edge.get("resolutionState")),
        "evidence_refs": list(edge.get("evidence_refs") or edge.get("evidenceRefs") or []),
    }




def _safe_text_list(values: Any, *, max_results: int | None = None) -> list[str]:
    """Project arbitrary scanner text into bounded model-safe prose."""
    from subagents.interview.customer_safe_projection import sanitize_customer_facing_text

    rows = list(values) if isinstance(values, (list, tuple)) else []
    limit = max_results if max_results is not None else len(rows)
    safe: list[str] = []
    for value in rows[:limit]:
        text = sanitize_customer_facing_text(str(value))
        if text:
            safe.append(text)
    return safe


def _safe_coverage_fields(graph) -> dict[str, Any]:
    """Return only canonical coverage state and sanitized limitations."""
    from subagents.interview.customer_safe_projection import normalize_coverage_state

    return {
        "coverageState": normalize_coverage_state(graph.coverage_state),
        "coverageLimitations": _safe_text_list(graph.coverage_notes or []),
    }

def get_scan_coverage(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    graph = engine.graph
    max_results = _max_results(request)
    frontiers = _safe_text_list(graph.unresolved_frontiers or [], max_results=max_results)
    return {
        **_safe_coverage_fields(graph),
        "unresolvedFrontiers": frontiers,
        "nodeCount": graph.node_count,
        "edgeCount": graph.edge_count,
        "truncated": len(graph.unresolved_frontiers or []) > max_results,
    }


def search_evidence(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    result = engine.search_nodes(
        node_types=(),
        text=_input(request, "query"),
        path_prefixes=_input(request, "pathPrefixes", ()),
        max_results=_max_results(request),
    )
    return {
        "nodes": [_project_safe_node(n) for n in result.nodes],
        "truncated": result.truncated,
        "continuationFrontiers": _safe_text_list(result.continuation_frontiers),
        "unresolvedFrontiers": _safe_text_list(result.unresolved_frontiers),
        "evidenceRefs": result.evidence_refs,
        **_safe_coverage_fields(engine.graph),
    }


def get_finding_detail(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    finding_id = str(_input(request, "findingId") or "").removeprefix("finding:")
    ref = f"evidence:{finding_id}"
    nodes = [
        _project_safe_node(node)
        for node in engine.graph.nodes
        if ref in (node.get("evidence_refs") or [])
    ]
    edges = [
        _project_safe_edge(edge)
        for edge in engine.graph.edges
        if ref in (edge.get("evidence_refs") or [])
    ]
    return {
        "findingId": finding_id,
        "nodes": nodes,
        "edges": edges,
        "truncated": False,
        "continuationFrontiers": [],
        "unresolvedFrontiers": [],
        "evidenceRefs": [ref] if nodes or edges else [],
    }


def find_provider_invocations(
    request: AgenticToolRequest,
    context,
) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    result = engine.provider_invocations(
        provider=_input(request, "provider"),
        max_results=_max_results(request),
        path_prefixes=_input(request, "pathPrefixes", ()),
    )
    safe_nodes = [_project_safe_node(n) for n in result.nodes]
    return {
        "invocations": safe_nodes,
        "truncated": result.truncated,
        "continuationFrontiers": result.continuation_frontiers,
        "unresolvedFrontiers": result.unresolved_frontiers,
        "evidenceRefs": result.evidence_refs,
    }


def get_evidence_subgraph(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    sub = engine.subgraph(
        seed_ref=str(_input(request, "seedRef") or ""),
        direction=str(_input(request, "direction", "BOTH")),
        max_depth=_max_hops(request),
        max_nodes=_max_results(request),
        max_edges=_max_results(request) * 4,
        node_types=_input(request, "nodeTypes", ()),
        edge_types=_input(request, "edgeTypes", ()),
    )
    return {
        "nodes": [_project_safe_node(n) for n in sub.nodes],
        "edges": [_project_safe_edge(e) for e in sub.edges],
        "truncated": sub.truncated,
        "continuationFrontiers": sub.continuation_frontiers,
        "unresolvedFrontiers": sub.unresolved_frontiers,
        "evidenceRefs": sub.evidence_refs,
    }


def get_symbol_context(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    raw = engine.symbol_context(
        str(_input(request, "symbolRef") or ""),
        _max_results(request),
    )
    symbol = raw.get("symbol")
    safe_symbol = _project_safe_node(symbol) if isinstance(symbol, Mapping) else None
    return {
        "symbol": safe_symbol,
        "callers": [_project_safe_node(n) for n in raw.get("callers") or []],
        "callees": [_project_safe_node(n) for n in raw.get("callees") or []],
        "dataFlows": [_project_safe_node(n) for n in raw.get("dataFlows") or []],
        "unresolvedFrontiers": list(raw.get("unresolvedFrontiers") or []),
        "evidenceRefs": list(raw.get("evidenceRefs") or []),
    }


def trace_static_flow(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    res = engine.trace_static_flow(
        start_ref=_start(request, required=True),
        direction=str(_input(request, "direction", "FORWARD")),
        max_hops=_max_hops(request),
        edge_types=_input(request, "edgeTypes", ()),
        stop_node_types=_input(request, "desiredStages", ()),
        max_results=_max_results(request),
    )
    return {
        "nodes": [_project_safe_node(n) for n in res.nodes],
        "edges": [_project_safe_edge(e) for e in res.edges],
        "truncated": res.truncated,
        "continuationFrontiers": res.continuation_frontiers,
        "unresolvedFrontiers": res.unresolved_frontiers,
        "evidenceRefs": res.evidence_refs,
    }


def inspect_data_path(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    raw = engine.inspect_data_path(
        start_ref=_start(request, required=True),
        direction=str(_input(request, "direction", "FORWARD")),
        max_hops=_max_hops(request),
        max_results=_max_results(request),
    ).to_dict()
    safe_nodes = [_project_safe_node(n) for n in raw.get("nodes") or []]
    safe_edges = [_project_safe_edge(e) for e in raw.get("edges") or []]
    return {
        "nodes": safe_nodes,
        "edges": safe_edges,
        "truncated": bool(raw.get("truncated", False)),
        "continuationFrontiers": _safe_text_list(raw.get("continuation_frontiers") or raw.get("continuationFrontiers") or []),
        "unresolvedFrontiers": _safe_text_list(raw.get("unresolved_frontiers") or raw.get("unresolvedFrontiers") or []),
        "evidenceRefs": list(raw.get("evidence_refs") or raw.get("evidenceRefs") or []),
        **_safe_coverage_fields(engine.graph),
    }


def inspect_decision_path(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    action_categories = (
        _input(request, "actionCategories")
        or _input(request, "action_categories")
        or ()
    )
    raw = engine.inspect_decision_path(
        start_ref=_start(request, required=True),
        max_hops=_max_hops(request),
        action_categories=action_categories,
        max_results=_max_results(request),
    ).to_dict()
    safe_nodes = [_project_safe_node(n) for n in raw.get("nodes") or []]
    safe_edges = [_project_safe_edge(e) for e in raw.get("edges") or []]
    from subagents.interview.customer_safe_projection import (
        normalize_resolution_state,
    )
    return {
        "nodes": safe_nodes,
        "edges": safe_edges,
        "decisionEffects": [
            {
                "effectType": str(eff.get("effect_type") or eff.get("type") or "DECISION_EFFECT"),
                "nodeId": str(eff.get("node_id") or ""),
                "resolutionState": normalize_resolution_state(eff.get("resolution_state") or eff.get("resolutionState")),
                "evidenceRefs": list(eff.get("evidence_refs") or []),
            } if isinstance(eff, Mapping) else str(eff)
            for eff in (raw.get("decision_effects") or raw.get("decisionEffects") or [])
        ],
        "truncated": bool(raw.get("truncated", False)),
        "continuationFrontiers": _safe_text_list(raw.get("continuation_frontiers") or raw.get("continuationFrontiers") or []),
        "unresolvedFrontiers": _safe_text_list(raw.get("unresolved_frontiers") or raw.get("unresolvedFrontiers") or []),
        "evidenceRefs": list(raw.get("evidence_refs") or raw.get("evidenceRefs") or []),
        **_safe_coverage_fields(engine.graph),
    }


def inspect_human_review_path(
    request: AgenticToolRequest,
    context,
) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    raw = engine.inspect_human_review_path(
        start_ref=_start(request, required=True),
        max_hops=_max_hops(request),
        max_results=_max_results(request),
    )
    raw_dict = dict(raw) if isinstance(raw, Mapping) else {}
    safe_nodes = [_project_safe_node(n) for n in raw_dict.get("nodes") or []]
    safe_edges = [_project_safe_edge(e) for e in raw_dict.get("edges") or []]
    safe_review_nodes = [_project_safe_node(n) for n in raw_dict.get("reviewNodes") or raw_dict.get("review_nodes") or []]
    from subagents.interview.customer_safe_projection import (
        normalize_resolution_state,
    )
    return {
        "nodes": safe_nodes,
        "edges": safe_edges,
        "reviewNodes": safe_review_nodes,
        "finalActions": [
            {
                "actionType": str(act.get("action_type") or act.get("type") or "ACTION"),
                "nodeId": str(act.get("node_id") or ""),
                "resolutionState": normalize_resolution_state(act.get("resolution_state") or act.get("resolutionState")),
                "evidenceRefs": list(act.get("evidence_refs") or []),
            } if isinstance(act, Mapping) else str(act)
            for act in (raw_dict.get("finalActions") or raw_dict.get("final_actions") or [])
        ],
        "truncated": bool(raw_dict.get("truncated", False)),
        "unresolvedFrontiers": _safe_text_list(raw_dict.get("unresolvedFrontiers") or raw_dict.get("unresolved_frontiers") or []),
        "evidenceRefs": list(raw_dict.get("evidenceRefs") or raw_dict.get("evidence_refs") or []),
        **_safe_coverage_fields(engine.graph),
    }


def find_similar_symbols(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    seed = engine.symbol_context(str(_input(request, "seedSymbolRef") or ""), 100)
    symbol = seed.get("symbol")
    if not symbol:
        return {
            "symbols": [],
            "truncated": False,
            "continuationFrontiers": [],
            "unresolvedFrontiers": seed.get("unresolvedFrontiers") or [],
            "evidenceRefs": [],
        }

    source_type = symbol.get("node_type")
    semantics = set(symbol.get("semantic_types") or [])
    candidates = engine.search_nodes(
        node_types=(source_type,),
        path_prefixes=_input(request, "pathPrefixes", ()),
        max_results=200,
    )
    scored = []
    for item in candidates:
        if item.get("node_id") == symbol.get("node_id"):
            continue
        score = len(semantics.intersection(set(item.get("semantic_types") or [])))
        if str(item.get("label") or "").lower() == str(
            symbol.get("label") or ""
        ).lower():
            score += 2
        scored.append({"symbol": item, "score": score})
    scored.sort(key=lambda value: (-value["score"], str(value["symbol"].get("node_id"))))

    limit = int(_input(request, "maxResults", request.budget.max_items))
    rows = scored[:limit]
    local_truncated = len(scored) > limit
    local_frontier = (
        [str(scored[limit]["symbol"].get("node_id"))]
        if local_truncated and limit < len(scored)
        else []
    )
    return {
        "symbols": rows,
        "truncated": candidates.truncated or local_truncated,
        "continuationFrontiers": list(
            dict.fromkeys([*candidates.continuation_frontiers, *local_frontier])
        ),
        "unresolvedFrontiers": candidates.unresolved_frontiers,
        "evidenceRefs": sorted(
            {
                ref
                for row in rows
                for ref in [
                    *(row["symbol"].get("evidence_refs") or []),
                    *(row["symbol"].get("support_refs") or []),
                ]
            }
        ),
    }


def inspect_deployment_context(
    request: AgenticToolRequest,
    context,
) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    names = (
        "dockerfile",
        "compose",
        "kubernetes",
        "helm",
        "terraform",
        "github/workflows",
        "gitlab-ci",
        "serverless",
    )
    search = engine.search_nodes(
        node_types=("FILE",),
        path_prefixes=_input(request, "pathPrefixes", ()),
        max_results=500,
    )
    files = [
        node
        for node in search
        if any(token in str(node.get("label") or "").lower() for token in names)
    ]
    limit = int(_input(request, "maxResults", request.budget.max_items))
    rows = files[:limit]
    local_truncated = len(files) > limit
    local_frontier = (
        [str(files[limit].get("node_id"))]
        if local_truncated and limit < len(files)
        else []
    )
    return {
        "deploymentFiles": rows,
        "coverageState": engine.graph.coverage_state,
        "truncated": search.truncated or local_truncated,
        "continuationFrontiers": list(
            dict.fromkeys([*search.continuation_frontiers, *local_frontier])
        ),
        "unresolvedFrontiers": search.unresolved_frontiers,
        "evidenceRefs": sorted(
            {
                ref
                for node in rows
                for ref in [
                    *(node.get("evidence_refs") or []),
                    *(node.get("support_refs") or []),
                ]
            }
        ),
    }


def _trusted_target(node: dict[str, Any]) -> bool:
    """Do not propose weak/invented semantic nodes as investigation targets."""
    state = str(node.get("resolution_state") or "OBSERVED")
    if state in {"INFERRED", "UNRESOLVED"}:
        return False
    if str(node.get("origin") or "") == "LLM_SEMANTIC_ENRICHMENT":
        return state == "CORROBORATED" and bool(node.get("support_refs"))
    return True


def propose_missing_targets(
    request: AgenticToolRequest,
    context,
) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    kinds = set(_input(request, "candidateKinds", ()))
    mapping = {
        "PROVIDER_USAGE": (
            "AI_MODEL_INVOCATION",
            "AI_PROVIDER",
            "AI_CAPABILITY",
            "MODEL_ENDPOINT",
        ),
        "DATA_FLOW": (
            "DATA_OBJECT",
            "DATA_ASSET",
            "PERSONAL_DATA",
            "SENSITIVE_DATA",
            "EXTERNAL_API",
        ),
        "SENSITIVE_DATA_LINEAGE": (
            "DATA_OBJECT",
            "DATA_ASSET",
            "PERSONAL_DATA",
            "SENSITIVE_DATA",
            "TABLE",
            "REPOSITORY_ACCESS",
        ),
        "PROTOCOL_FLOW": (
            "HTTP_ROUTE",
            "HTTP_REQUEST",
            "HTTP_RESPONSE",
            "GRPC_METHOD",
            "GRAPHQL_OPERATION",
            "PROTOCOL_MESSAGE",
            "EVENT",
            "QUEUE",
            "COMMAND",
            "QUERY",
        ),
        "PERSISTENCE": (
            "REPOSITORY_ACCESS",
            "DATABASE",
            "TABLE",
            "ENTITY",
            "CACHE",
            "FILE_STORAGE",
        ),
        "AI_LIFECYCLE": (
            "AI_SYSTEM",
            "MODEL",
            "MODEL_ARTIFACT",
            "DATASET",
            "TRAINING_JOB",
            "FINE_TUNING_JOB",
            "EVALUATION_JOB",
            "MODEL_REGISTRY",
            "MODEL_ENDPOINT",
            "MODEL_DEPLOYMENT",
            "MODEL_MONITORING",
            "MODEL_DRIFT_SIGNAL",
            "RETRAINING_JOB",
        ),
        "BUSINESS_PROCESS": (
            "BUSINESS_PROCESS",
            "PROCESS_STEP",
            "BUSINESS_DECISION",
            "BUSINESS_OUTCOME",
            "BUSINESS_OBJECT",
            "ACTOR",
            "DATA_SUBJECT",
        ),
        "DECISION_FLOW": (
            "BUSINESS_DECISION",
            "BUSINESS_OUTCOME",
            "BUSINESS_ACTION",
            "APPROVAL",
            "REJECTION",
            "RANKING",
            "RECOMMENDATION",
            "STATUS_CHANGE",
        ),
        "HUMAN_REVIEW": ("HUMAN_REVIEW", "HUMAN_OVERRIDE"),
        "DEPLOYMENT": ("FILE", "MODEL_DEPLOYMENT", "MODEL_ENDPOINT"),
    }
    node_types = tuple(
        sorted({node_type for kind in kinds for node_type in mapping.get(kind, ())})
    )
    search = engine.search_nodes(
        node_types=node_types,
        max_results=int(_input(request, "maxResults", request.budget.max_items)) * 3,
    )
    excluded = set(_input(request, "excludeTargetIds", ()) or ())
    limit = int(_input(request, "maxResults", request.budget.max_items))
    trusted = [
        node
        for node in search
        if _trusted_target(node)
        and f"target:{node['node_id']}" not in excluded
    ]
    rows = trusted[:limit]
    local_truncated = len(trusted) > limit
    local_frontier = (
        [str(trusted[limit].get("node_id"))]
        if local_truncated and limit < len(trusted)
        else []
    )
    return {
        "candidates": [
            {
                "targetId": f"target:{node['node_id']}",
                "node": node,
                "status": "PROPOSED",
            }
            for node in rows
        ],
        "truncated": search.truncated or local_truncated,
        "continuationFrontiers": list(
            dict.fromkeys([*search.continuation_frontiers, *local_frontier])
        ),
        "unresolvedFrontiers": search.unresolved_frontiers,
        "evidenceRefs": sorted(
            {
                str(ref)
                for node in rows
                for ref in [
                    *(node.get("evidence_refs") or []),
                    *(node.get("support_refs") or []),
                ]
                if str(ref)
            }
        ),
    }
