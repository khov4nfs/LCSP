"""Deterministic validation for LLM-generated EngineeringRule drafts."""
from __future__ import annotations
from lcsp_workers.scanner.program_graph.vocabulary import EDGE_TYPES, NODE_TYPES
from .legal_reasoning_contract import (
    LegalReasoningContractValidationError,
    validate_legal_reasoning_contract,
)
from .models import ENGINEERING_RULE_SCHEMA_VERSION, EngineeringRule
ALLOWED_DIRECTIONS = {"FORWARD", "BACKWARD", "BOTH"}
class EngineeringRuleValidationError(ValueError): pass

def validate_engineering_rule(rule: EngineeringRule) -> EngineeringRule:
    if rule.schema_version != ENGINEERING_RULE_SCHEMA_VERSION: raise EngineeringRuleValidationError("unsupported engineering-rule schema")
    if not rule.engineering_rule_id or not rule.legal_rule_id: raise EngineeringRuleValidationError("rule identity required")
    if not rule.legal_rule_catalog_version_id or not rule.legal_corpus_version_id: raise EngineeringRuleValidationError("versioned legal rule provenance required")
    if not rule.source_chunk_ids or not rule.source_fingerprint: raise EngineeringRuleValidationError("legal source provenance required")
    if not rule.legal_reasoning_contract: raise EngineeringRuleValidationError("legal reasoning contract required")
    try:
        contract = validate_legal_reasoning_contract(rule.legal_reasoning_contract)
    except LegalReasoningContractValidationError as error:
        raise EngineeringRuleValidationError(str(error)) from error
    if contract.legal_rule_id != rule.legal_rule_id: raise EngineeringRuleValidationError("legal reasoning contract rule mismatch")
    if contract.legal_corpus_version_id != rule.legal_corpus_version_id: raise EngineeringRuleValidationError("legal reasoning contract corpus mismatch")
    if contract.legal_rule_catalog_version_id != rule.legal_rule_catalog_version_id: raise EngineeringRuleValidationError("legal reasoning contract catalog mismatch")
    citation_chunk_ids = {
        str(item.get("chunkId") or item.get("chunk_id") or "")
        for item in contract.citation_set
        if isinstance(item, dict)
    }
    if set(rule.source_chunk_ids) - citation_chunk_ids: raise EngineeringRuleValidationError("source chunks missing from citation set")
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
