"""Canonical Python-local technical investigation tools over Program Evidence Graph v2."""
from __future__ import annotations
from typing import Any, Mapping
from .registry import AgenticToolRequest
from lcsp_workers.scanner.program_graph.query_engine import ProgramGraphQueryEngine


def _graph(request: AgenticToolRequest, context) -> tuple[ProgramGraphQueryEngine, dict]:
    report_ref = request.artifact_versions.get("technicalEvidenceReportId") or request.artifact_versions.get("technical_evidence_report_id")
    if not report_ref: raise ValueError("technicalEvidenceReportId is required")
    report = context.api_client.get_accepted_technical_evidence_report(report_ref)
    evidence = report.get("evidence_payload") or report.get("evidencePayload") or report.get("contentJson") or {}
    if isinstance(evidence, dict) and "evidence_payload" in evidence: evidence = evidence["evidence_payload"]
    graph = evidence.get("evidence_graph") or evidence.get("program_evidence_graph") or evidence.get("programEvidenceGraph") if isinstance(evidence, dict) else None
    if not isinstance(graph, dict): raise ValueError("PROGRAM_EVIDENCE_GRAPH_NOT_AVAILABLE")
    
    import json
    import os
    ref = graph.get("evidence_graph_ref") or graph.get("evidenceGraphRef")
    if ref and isinstance(ref, str) and os.path.exists(ref):
        try:
            with open(ref, "r") as f:
                file_payload = json.load(f)
                if isinstance(file_payload, dict):
                    graph = {**file_payload, **graph}
        except Exception:
            pass
            
    return ProgramGraphQueryEngine(graph), report

def _input(request: AgenticToolRequest, name: str, default=None): return request.input.get(name, default)
def _start(request: AgenticToolRequest) -> str: return str(_input(request, "startRef") or _input(request, "seedRef") or "")

def get_scan_coverage(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, report = _graph(request, context); graph = engine.graph
    return {"coverageState": graph.coverage_state, "coverageNotes": graph.coverage_notes, "unresolvedFrontiers": graph.unresolved_frontiers, "nodeCount": graph.node_count, "edgeCount": graph.edge_count, "provenance": graph.provenance}

def search_evidence(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    return {"nodes": engine.search_nodes(node_types=_input(request, "findingKinds", ()), text=_input(request, "query"), path_prefixes=_input(request, "pathPrefixes", ()), max_results=int(_input(request, "maxResults", request.budget.max_items))), "graphHash": engine.graph.graph_hash}

def get_finding_detail(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context); fid = str(_input(request, "findingId") or "").removeprefix("finding:"); ref = f"evidence:{fid}"
    nodes = [n for n in engine.graph.nodes if ref in (n.get("evidence_refs") or [])]
    edges = [e for e in engine.graph.edges if ref in (e.get("evidence_refs") or [])]
    return {"findingId": fid, "nodes": nodes, "edges": edges, "evidenceRefs": [ref] if nodes or edges else []}

def find_provider_invocations(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context); rows = engine.provider_invocations(provider=_input(request, "provider"), max_results=int(_input(request, "maxResults", request.budget.max_items)))
    prefixes = tuple(_input(request, "pathPrefixes", ()) or ())
    if prefixes: rows = [n for n in rows if any(str((n.get("source") or {}).get("file_path") or "").startswith(p) for p in prefixes)]
    return {"invocations": rows, "evidenceRefs": sorted({r for n in rows for r in n.get("evidence_refs") or []})}

def get_evidence_subgraph(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context)
    return engine.subgraph(seed_ref=str(_input(request, "seedRef") or ""), direction=str(_input(request, "direction", "BOTH")), max_depth=int(_input(request, "maxDepth", request.budget.max_depth)), max_nodes=int(_input(request, "maxNodes", request.budget.max_items)), max_edges=int(_input(request, "maxEdges", request.budget.max_items * 4)), node_types=_input(request, "nodeTypes", ()), edge_types=_input(request, "edgeTypes", ())).to_dict()

def get_symbol_context(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context); return engine.symbol_context(str(_input(request, "symbolRef") or ""), int(_input(request, "maxNeighbors", request.budget.max_items)))

def trace_static_flow(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context); return engine.trace_static_flow(start_ref=_start(request), direction=str(_input(request, "direction", "FORWARD")), max_hops=int(_input(request, "maxHops", request.budget.max_depth)), edge_types=_input(request, "edgeTypes", ()), stop_node_types=_input(request, "desiredStages", ()), max_results=request.budget.max_items).to_dict()

def inspect_data_path(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context); return engine.inspect_data_path(start_ref=_start(request), direction=str(_input(request, "direction", "FORWARD")), max_hops=int(_input(request, "maxHops", request.budget.max_depth)), max_results=int(_input(request, "maxResults", request.budget.max_items))).to_dict()

def inspect_decision_path(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context); return engine.inspect_decision_path(start_ref=_start(request), max_hops=int(_input(request, "maxHops", request.budget.max_depth)), action_categories=_input(request, "actionCategories", ()), max_results=int(_input(request, "maxResults", request.budget.max_items))).to_dict()

def inspect_human_review_path(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context); return engine.inspect_human_review_path(start_ref=_start(request), max_hops=int(_input(request, "maxHops", request.budget.max_depth)), max_results=request.budget.max_items)

def find_similar_symbols(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context); seed = engine.symbol_context(str(_input(request, "seedSymbolRef") or ""), 100); symbol = seed.get("symbol")
    if not symbol: return {"symbols": [], "evidenceRefs": []}
    source_type, semantics = symbol.get("node_type"), set(symbol.get("semantic_types") or []); candidates = engine.search_nodes(node_types=(source_type,), path_prefixes=_input(request, "pathPrefixes", ()), max_results=200); scored = []
    for item in candidates:
        if item.get("node_id") == symbol.get("node_id"): continue
        score = len(semantics.intersection(set(item.get("semantic_types") or [])))
        if str(item.get("label") or "").lower() == str(symbol.get("label") or "").lower(): score += 2
        scored.append({"symbol": item, "score": score})
    scored.sort(key=lambda v: (-v["score"], str(v["symbol"].get("node_id"))))
    rows = scored[:int(_input(request, "maxResults", request.budget.max_items))]
    return {"symbols": rows, "evidenceRefs": sorted({r for row in rows for r in row["symbol"].get("evidence_refs") or []})}

def inspect_deployment_context(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context); names = ("dockerfile", "compose", "kubernetes", "helm", "terraform", "github/workflows", "gitlab-ci", "serverless")
    files = [n for n in engine.search_nodes(node_types=("FILE",), path_prefixes=_input(request, "pathPrefixes", ()), max_results=500) if any(token in str(n.get("label") or "").lower() for token in names)]
    return {"deploymentFiles": files[:int(_input(request, "maxResults", request.budget.max_items))], "coverageState": engine.graph.coverage_state, "evidenceRefs": sorted({r for n in files for r in n.get("evidence_refs") or []})}

def propose_missing_targets(request: AgenticToolRequest, context) -> Mapping[str, Any]:
    engine, _ = _graph(request, context); kinds = set(_input(request, "candidateKinds", ())); mapping = {"PROVIDER_USAGE": ("AI_MODEL_INVOCATION", "AI_PROVIDER"), "DATA_FLOW": ("PERSONAL_DATA", "SENSITIVE_DATA", "EXTERNAL_API"), "DECISION_FLOW": ("BUSINESS_ACTION", "APPROVAL", "REJECTION", "RANKING", "RECOMMENDATION", "STATUS_CHANGE"), "HUMAN_REVIEW": ("HUMAN_REVIEW", "HUMAN_OVERRIDE"), "DEPLOYMENT": ("FILE",)}
    node_types = tuple({t for kind in kinds for t in mapping.get(kind, ())}); rows = engine.search_nodes(node_types=node_types, max_results=int(_input(request, "maxResults", request.budget.max_items)))
    excluded = set(_input(request, "excludeTargetIds", ()) or ()); rows = [n for n in rows if f"target:{n['node_id']}" not in excluded]
    return {"candidates": [{"targetId": f"target:{n['node_id']}", "node": n, "status": "PROPOSED"} for n in rows], "evidenceRefs": sorted({r for n in rows for r in n.get("evidence_refs") or []})}
