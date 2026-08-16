"""Deterministic validation for LLM-generated EngineeringRule drafts."""
from __future__ import annotations
from lcsp_workers.scanner.program_graph.vocabulary import EDGE_TYPES, NODE_TYPES
from .models import ENGINEERING_RULE_SCHEMA_VERSION, EngineeringRule
ALLOWED_DIRECTIONS = {"FORWARD", "BACKWARD", "BOTH"}
class EngineeringRuleValidationError(ValueError): pass

def validate_engineering_rule(rule: EngineeringRule) -> EngineeringRule:
    if rule.schema_version != ENGINEERING_RULE_SCHEMA_VERSION: raise EngineeringRuleValidationError("unsupported engineering-rule schema")
    if not rule.engineering_rule_id or not rule.legal_rule_id: raise EngineeringRuleValidationError("rule identity required")
    if not rule.source_chunk_ids or not rule.source_fingerprint: raise EngineeringRuleValidationError("legal source provenance required")
    unknown_nodes = (set(rule.starting_node_types) | set(rule.target_node_types)) - NODE_TYPES
    if unknown_nodes: raise EngineeringRuleValidationError(f"unknown graph node types: {sorted(unknown_nodes)}")
    unknown_edges = set(rule.edge_strategies) - EDGE_TYPES
    if unknown_edges: raise EngineeringRuleValidationError(f"unknown graph edge types: {sorted(unknown_edges)}")
    names = set()
    for query in rule.graph_queries:
        if query.name in names: raise EngineeringRuleValidationError("duplicate graph query name")
        names.add(query.name)
        if query.direction not in ALLOWED_DIRECTIONS: raise EngineeringRuleValidationError("invalid graph direction")
        if set(query.start_node_types) - NODE_TYPES or set(query.stop_node_types) - NODE_TYPES: raise EngineeringRuleValidationError("query references unknown node type")
        if set(query.follow_edges) - EDGE_TYPES: raise EngineeringRuleValidationError("query references unknown edge type")
    return rule
