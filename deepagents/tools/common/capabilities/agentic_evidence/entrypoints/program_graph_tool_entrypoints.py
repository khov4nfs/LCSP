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


def _start(request: AgenticToolRequest) -> str:
    return str(_input(request, "startRef") or _input(request, "seedRef") or "")


def get_scan_coverage(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    graph = engine.graph
    return {
        "coverageState": graph.coverage_state,
        "coverageNotes": graph.coverage_notes,
        "unresolvedFrontiers": graph.unresolved_frontiers,
        "nodeCount": graph.node_count,
        "edgeCount": graph.edge_count,
        "schemaVersion": graph.schema_version,
        "provenance": graph.provenance,
    }


def search_evidence(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    result = engine.search_nodes(
        node_types=_input(request, "findingKinds", ()),
        text=_input(request, "query"),
        path_prefixes=_input(request, "pathPrefixes", ()),
        max_results=int(_input(request, "maxResults", request.budget.max_items)),
    )
    return {**result.to_dict(), "graphHash": engine.graph.graph_hash}


def get_finding_detail(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    finding_id = str(_input(request, "findingId") or "").removeprefix("finding:")
    ref = f"evidence:{finding_id}"
    nodes = [
        node
        for node in engine.graph.nodes
        if ref in (node.get("evidence_refs") or [])
    ]
    edges = [
        edge
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
        max_results=int(_input(request, "maxResults", request.budget.max_items)),
        path_prefixes=_input(request, "pathPrefixes", ()),
    )
    return {
        "invocations": result.nodes,
        "truncated": result.truncated,
        "continuationFrontiers": result.continuation_frontiers,
        "unresolvedFrontiers": result.unresolved_frontiers,
        "evidenceRefs": result.evidence_refs,
    }


def get_evidence_subgraph(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    return engine.subgraph(
        seed_ref=str(_input(request, "seedRef") or ""),
        direction=str(_input(request, "direction", "BOTH")),
        max_depth=int(_input(request, "maxDepth", request.budget.max_depth)),
        max_nodes=int(_input(request, "maxNodes", request.budget.max_items)),
        max_edges=int(_input(request, "maxEdges", request.budget.max_items * 4)),
        node_types=_input(request, "nodeTypes", ()),
        edge_types=_input(request, "edgeTypes", ()),
    ).to_dict()


def get_symbol_context(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    return engine.symbol_context(
        str(_input(request, "symbolRef") or ""),
        int(_input(request, "maxNeighbors", request.budget.max_items)),
    )


def trace_static_flow(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    return engine.trace_static_flow(
        start_ref=_start(request),
        direction=str(_input(request, "direction", "FORWARD")),
        max_hops=int(_input(request, "maxHops", request.budget.max_depth)),
        edge_types=_input(request, "edgeTypes", ()),
        stop_node_types=_input(request, "desiredStages", ()),
        max_results=request.budget.max_items,
    ).to_dict()


def inspect_data_path(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    return engine.inspect_data_path(
        start_ref=_start(request),
        direction=str(_input(request, "direction", "FORWARD")),
        max_hops=int(_input(request, "maxHops", request.budget.max_depth)),
        max_results=int(_input(request, "maxResults", request.budget.max_items)),
    ).to_dict()


def inspect_decision_path(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    return engine.inspect_decision_path(
        start_ref=_start(request),
        max_hops=int(_input(request, "maxHops", request.budget.max_depth)),
        action_categories=_input(request, "actionCategories", ()),
        max_results=int(_input(request, "maxResults", request.budget.max_items)),
    ).to_dict()


def inspect_human_review_path(
    request: AgenticToolRequest,
    context,
) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    return engine.inspect_human_review_path(
        start_ref=_start(request),
        max_hops=int(_input(request, "maxHops", request.budget.max_depth)),
        max_results=request.budget.max_items,
    )


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
