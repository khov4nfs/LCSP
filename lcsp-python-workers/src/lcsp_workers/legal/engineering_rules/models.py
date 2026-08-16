"""Typed cached contracts for approved LegalRule -> EngineeringRule compilation."""
from __future__ import annotations
from dataclasses import asdict, dataclass
from typing import Any
ENGINEERING_RULE_SCHEMA_VERSION = "1.0.0"

@dataclass(frozen=True)
class GraphQueryTemplate:
    name: str
    start_node_types: tuple[str, ...] = ()
    direction: str = "FORWARD"
    follow_edges: tuple[str, ...] = ()
    stop_node_types: tuple[str, ...] = ()
    semantic_types: tuple[str, ...] = ()

@dataclass(frozen=True)
class EngineeringRule:
    engineering_rule_id: str
    legal_rule_id: str
    legal_rule_catalog_version_id: str
    legal_corpus_version_id: str
    concept: str
    legal_intent: dict[str, Any]
    investigation_goals: tuple[str, ...]
    starting_node_types: tuple[str, ...]
    target_node_types: tuple[str, ...]
    edge_strategies: tuple[str, ...]
    graph_queries: tuple[GraphQueryTemplate, ...]
    keywords: tuple[str, ...] = (); common_apis: tuple[str, ...] = (); common_libraries: tuple[str, ...] = (); patterns: tuple[str, ...] = ()
    required_evidence: tuple[str, ...] = (); supporting_evidence: tuple[str, ...] = (); negative_evidence: tuple[str, ...] = (); unresolved_conditions: tuple[str, ...] = ()
    source_chunk_ids: tuple[str, ...] = (); source_locators: tuple[str, ...] = (); source_fingerprint: str = ""
    compiler_model: str = ""; compiler_version: str = ""; prompt_version: str = ""; schema_version: str = ENGINEERING_RULE_SCHEMA_VERSION
    def to_dict(self) -> dict[str, Any]: return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "EngineeringRule":
        def tup(s: str, c: str | None = None): return tuple(str(v) for v in (payload.get(s) or payload.get(c or s) or []) if str(v))
        queries = tuple(GraphQueryTemplate(str(q.get("name") or "query"), tuple(q.get("start_node_types") or q.get("startNodeTypes") or ()), str(q.get("direction") or "FORWARD"), tuple(q.get("follow_edges") or q.get("followEdges") or ()), tuple(q.get("stop_node_types") or q.get("stopNodeTypes") or ()), tuple(q.get("semantic_types") or q.get("semanticTypes") or ())) for q in (payload.get("graph_queries") or payload.get("graphQueries") or []) if isinstance(q, dict))
        return cls(str(payload.get("engineering_rule_id") or payload.get("engineeringRuleId") or ""), str(payload.get("legal_rule_id") or payload.get("legalRuleId") or ""), str(payload.get("legal_rule_catalog_version_id") or payload.get("legalRuleCatalogVersionId") or ""), str(payload.get("legal_corpus_version_id") or payload.get("legalCorpusVersionId") or ""), str(payload.get("concept") or "UNKNOWN"), dict(payload.get("legal_intent") or payload.get("legalIntent") or {}), tup("investigation_goals", "investigationGoals"), tup("starting_node_types", "startingNodeTypes"), tup("target_node_types", "targetNodeTypes"), tup("edge_strategies", "edgeStrategies"), queries, tup("keywords"), tup("common_apis", "commonApis"), tup("common_libraries", "commonLibraries"), tup("patterns"), tup("required_evidence", "requiredEvidence"), tup("supporting_evidence", "supportingEvidence"), tup("negative_evidence", "negativeEvidence"), tup("unresolved_conditions", "unresolvedConditions"), tup("source_chunk_ids", "sourceChunkIds"), tup("source_locators", "sourceLocators"), str(payload.get("source_fingerprint") or payload.get("sourceFingerprint") or ""), str(payload.get("compiler_model") or payload.get("compilerModel") or ""), str(payload.get("compiler_version") or payload.get("compilerVersion") or ""), str(payload.get("prompt_version") or payload.get("promptVersion") or ""), str(payload.get("schema_version") or payload.get("schemaVersion") or ENGINEERING_RULE_SCHEMA_VERSION))
