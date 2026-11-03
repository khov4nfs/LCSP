"""Governed tool usage guidance; legal sources and API schemas remain authoritative."""
from __future__ import annotations

CONTRACTS: dict[str, str] = {
    "get_assessment_context": "Use at start/resume and after case changes. API owns selected scope, pinned source, accepted facts, coverage and blockers; coverage is not legal proof.",
    "get_pinned_rule_set": "Paginate the authorized request's rules only; SELECTED_RULES does not authorize the unselected catalog.",
    "get_assessment_rule": "Read one selected rule's legal requirements, criteria, elements and source addresses before investigating it.",
    "get_rule_decision": "Inspect accepted prior reasoning and references; structural acceptance is not semantic correctness.",
    "read_legal_source": "Read the pinned operative text and legal effect before interpreting obligations; skill guidance has no legal authority.",
    "search_legal_source": "Find pinned definitions and exceptions; search hits are leads, not legal conclusions.",
    "start_rule_investigation": "Start only pending/invalidated selected rule work; reuse still-current decisions.",
    "cite_repository_source": "Mint verified evidence only for exact pinned lines read; code cannot prove operator identity or real-world operations.",
    "record_search_coverage": "Authenticate bounded searches; missing hits and truncated results cannot prove global absence.",
    "accept_case_fact": "Record narrowly supported source claims, not assumed customer practices or deployment facts.",
    "submit_rule_decision": "Submit only supported current applicability and every criterion; unresolved material facts require investigation/HITL.",
    "open_human_request": "Ask fact not legal verdict; material selected-rule anchor, attempts and impact required; native interrupt.",
    "report_human_fact_unresolvable": "Require affirmative accepted evidence of permanent unavailability, not merely an unanswered question.",
    "request_finalization": "Only when selected decisions are current; API gate controls lifecycle, selected audit is not a full final report.",
    "submit_final_report": "FULL_RULE_SET only after FINALIZING; use frozen accepted decisions, no invented facts or artifacts.",
    "list_assessment_skills": "After reconnaissance, discover generic optional investigation methods; this does not establish capabilities.",
    "load_assessment_skill": "Load one allowlisted relevant method; cannot create legal duties, expand scope or accept evidence.",
}
GRAPH_CONTRACTS: dict[str, str] = {
    "search_code_graph": "Use as a symbol/path lead only; graph coverage may be incomplete, verify pinned source.",
    "trace_call_path": "Discover possible paths and verify actual reachability and effects in pinned source.",
    "search_code_text": "Narrow search and inspect actual source; no-hit or truncation is not proof of absence.",
    "get_repository_architecture": "Find candidate modules and entrypoints, not runtime deployment or legal status.",
}


def describe_tool(name: str, original: str) -> str:
    guidance = CONTRACTS.get(name) or GRAPH_CONTRACTS.get(name)
    return original.strip() + ("\n\nASSESSMENT TOOL CONTRACT: " + guidance if guidance else "")
