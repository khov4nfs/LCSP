"""The assessment-safe runtime contract of an already-compiled EngineeringRule.

The reusable authority is::

    Legal Corpus -> LegalRule -> EngineeringRule compilation / precompiled registry

Assessment stages (Scanner, Interview, Repository Analyst) consume the compiled
EngineeringRule, they never re-read or reinterpret legal text. Before this module the
Scanner rebuilt a lossy subset of each precompiled template on its own and dropped
the parts that say *how to look for the evidence*: ``legalIntent``, the node types,
the edge strategies, the graph queries and ``unresolvedConditions``. Everything that
follows (which discovery tasks exist, which graph a provider should walk, when a
rule is unresolved rather than absent) needs those fields, so this is the one place
that converts an EngineeringRule, or a precompiled template, into what runtime reads.

The projection is lossless for the technical contract and carries only governed
provenance identifiers (versions, fingerprints, chunk ids and grounding hashes). It
never carries legal source text.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from .models import EngineeringRule, GraphQueryTemplate

RUNTIME_CONTRACT_VERSION = "1.0.0"

PROVENANCE_ORIGINS = {
    "precompiledBundle": "PRECOMPILED_BUNDLE",
    "compiled": "COMPILED",
}


@dataclass(frozen=True)
class GraphQueryContract:
    """One rule-owned graph traversal: where to start, which edges, where to stop."""

    name: str
    start_node_types: tuple[str, ...] = ()
    direction: str = "FORWARD"
    follow_edges: tuple[str, ...] = ()
    stop_node_types: tuple[str, ...] = ()
    semantic_types: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "startNodeTypes": list(self.start_node_types),
            "direction": self.direction,
            "followEdges": list(self.follow_edges),
            "stopNodeTypes": list(self.stop_node_types),
            "semanticTypes": list(self.semantic_types),
        }

    @classmethod
    def from_template(cls, query: GraphQueryTemplate) -> "GraphQueryContract":
        return cls(
            name=query.name,
            start_node_types=tuple(query.start_node_types),
            direction=query.direction,
            follow_edges=tuple(query.follow_edges),
            stop_node_types=tuple(query.stop_node_types),
            semantic_types=tuple(query.semantic_types),
        )


@dataclass(frozen=True)
class EngineeringRuleRuntimeContract:
    """Everything runtime may know about one compiled EngineeringRule."""

    engineering_rule_id: str
    legal_rule_id: str
    schema_version: str
    compiler_version: str
    prompt_version: str
    compiler_model: str
    contract_version: str
    concept: str
    legal_intent: Mapping[str, Any]
    investigation_goals: tuple[str, ...]
    starting_node_types: tuple[str, ...]
    target_node_types: tuple[str, ...]
    edge_strategies: tuple[str, ...]
    graph_queries: tuple[GraphQueryContract, ...]
    keywords: tuple[str, ...] = ()
    common_apis: tuple[str, ...] = ()
    common_libraries: tuple[str, ...] = ()
    patterns: tuple[str, ...] = ()
    required_evidence: tuple[str, ...] = ()
    supporting_evidence: tuple[str, ...] = ()
    negative_evidence: tuple[str, ...] = ()
    unresolved_conditions: tuple[str, ...] = ()
    source_fingerprint: str = ""
    provenance: Mapping[str, Any] = field(default_factory=dict)

    @property
    def content_hash(self) -> str:
        return runtime_contract_content_hash(self)

    def to_dict(self) -> dict[str, Any]:
        """Canonical wire form (camelCase)."""
        return {
            "engineeringRuleId": self.engineering_rule_id,
            "legalRuleId": self.legal_rule_id,
            "schemaVersion": self.schema_version,
            "compilerVersion": self.compiler_version,
            "promptVersion": self.prompt_version,
            "compilerModel": self.compiler_model,
            "contractVersion": self.contract_version,
            "concept": self.concept,
            "legalIntent": dict(self.legal_intent),
            "investigationGoals": list(self.investigation_goals),
            "startingNodeTypes": list(self.starting_node_types),
            "targetNodeTypes": list(self.target_node_types),
            "edgeStrategies": list(self.edge_strategies),
            "graphQueries": [query.to_dict() for query in self.graph_queries],
            "keywords": list(self.keywords),
            "commonApis": list(self.common_apis),
            "commonLibraries": list(self.common_libraries),
            "patterns": list(self.patterns),
            "requiredEvidence": list(self.required_evidence),
            "supportingEvidence": list(self.supporting_evidence),
            "negativeEvidence": list(self.negative_evidence),
            "unresolvedConditions": list(self.unresolved_conditions),
            "sourceFingerprint": self.source_fingerprint,
            "provenance": dict(self.provenance),
            "runtimeContractVersion": RUNTIME_CONTRACT_VERSION,
            "contentHash": self.content_hash,
        }

    def to_runtime_mapping(self) -> dict[str, Any]:
        """The mapping Scanner-side readers take: snake_case, graph queries as dicts."""
        return {
            "engineering_rule_id": self.engineering_rule_id,
            "legal_rule_id": self.legal_rule_id,
            "schema_version": self.schema_version,
            "compiler_version": self.compiler_version,
            "prompt_version": self.prompt_version,
            "contract_version": self.contract_version,
            "concept": self.concept,
            "legal_intent": dict(self.legal_intent),
            "investigation_goals": self.investigation_goals,
            "starting_node_types": self.starting_node_types,
            "target_node_types": self.target_node_types,
            "edge_strategies": self.edge_strategies,
            "graph_queries": tuple(query.to_dict() for query in self.graph_queries),
            "keywords": self.keywords,
            "common_apis": self.common_apis,
            "common_libraries": self.common_libraries,
            "patterns": self.patterns,
            "required_evidence": self.required_evidence,
            "supporting_evidence": self.supporting_evidence,
            "negative_evidence": self.negative_evidence,
            "unresolved_conditions": self.unresolved_conditions,
            "source_fingerprint": self.source_fingerprint,
            "content_hash": self.content_hash,
            "provenance": dict(self.provenance),
            # Legal source locators are a Repository Analyst concern; the Scanner
            # was never given them and does not need them.
            "source_locators": (),
        }


def runtime_contract_from_engineering_rule(
    rule: EngineeringRule,
    *,
    contract_version: str = "base",
    provenance: Mapping[str, Any] | None = None,
) -> EngineeringRuleRuntimeContract:
    """The one conversion from a compiled EngineeringRule to its runtime contract."""
    return EngineeringRuleRuntimeContract(
        engineering_rule_id=rule.engineering_rule_id,
        legal_rule_id=rule.legal_rule_id,
        schema_version=rule.schema_version,
        compiler_version=rule.compiler_version,
        prompt_version=rule.prompt_version,
        compiler_model=rule.compiler_model,
        contract_version=contract_version,
        concept=rule.concept,
        legal_intent=dict(rule.legal_intent or {}),
        investigation_goals=tuple(rule.investigation_goals),
        starting_node_types=tuple(rule.starting_node_types),
        target_node_types=tuple(rule.target_node_types),
        edge_strategies=tuple(rule.edge_strategies),
        graph_queries=tuple(
            GraphQueryContract.from_template(query) for query in rule.graph_queries
        ),
        keywords=tuple(rule.keywords),
        common_apis=tuple(rule.common_apis),
        common_libraries=tuple(rule.common_libraries),
        patterns=tuple(rule.patterns),
        required_evidence=tuple(rule.required_evidence),
        supporting_evidence=tuple(rule.supporting_evidence),
        negative_evidence=tuple(rule.negative_evidence),
        unresolved_conditions=tuple(rule.unresolved_conditions),
        source_fingerprint=rule.source_fingerprint,
        provenance=dict(
            provenance
            or {
                "origin": PROVENANCE_ORIGINS["compiled"],
                "sourceChunkIds": list(rule.source_chunk_ids),
                "legalRuleCatalogVersionId": rule.legal_rule_catalog_version_id,
                "legalCorpusVersionId": rule.legal_corpus_version_id,
            }
        ),
    )


def _first(source: Any, *names: str) -> Any:
    for name in names:
        if isinstance(source, Mapping):
            if name in source:
                return source[name]
        elif hasattr(source, name):
            return getattr(source, name)
    return None


def _strings(value: Any) -> list[str]:
    if isinstance(value, (list, tuple, set)):
        return [str(item) for item in value if str(item)]
    if isinstance(value, str) and value:
        return [value]
    return []


def _graph_query_dicts(value: Any) -> list[dict[str, Any]]:
    queries: list[dict[str, Any]] = []
    for item in value or ():
        if isinstance(item, GraphQueryContract):
            queries.append(item.to_dict())
        elif isinstance(item, Mapping):
            queries.append(
                GraphQueryContract(
                    name=str(item.get("name") or "query"),
                    start_node_types=tuple(
                        _strings(item.get("startNodeTypes") or item.get("start_node_types"))
                    ),
                    direction=str(item.get("direction") or "FORWARD"),
                    follow_edges=tuple(
                        _strings(item.get("followEdges") or item.get("follow_edges"))
                    ),
                    stop_node_types=tuple(
                        _strings(item.get("stopNodeTypes") or item.get("stop_node_types"))
                    ),
                    semantic_types=tuple(
                        _strings(item.get("semanticTypes") or item.get("semantic_types"))
                    ),
                ).to_dict()
            )
        else:
            queries.append(GraphQueryContract.from_template(item).to_dict())
    return queries


# The technical contract a discovery task depends on. Raw legal source text is not
# part of it and never can be: ``legalIntent`` is the compiled structured intent
# (actor/action/condition), not a copy of the law.
CONTENT_HASH_FIELDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("engineeringRuleId", ("engineering_rule_id", "engineeringRuleId")),
    ("legalRuleId", ("legal_rule_id", "legalRuleId")),
    ("schemaVersion", ("schema_version", "schemaVersion")),
    ("compilerVersion", ("compiler_version", "compilerVersion")),
    ("promptVersion", ("prompt_version", "promptVersion")),
    ("contractVersion", ("contract_version", "contractVersion")),
    ("concept", ("concept",)),
    ("legalIntent", ("legal_intent", "legalIntent")),
    ("investigationGoals", ("investigation_goals", "investigationGoals")),
    ("startingNodeTypes", ("starting_node_types", "startingNodeTypes")),
    ("targetNodeTypes", ("target_node_types", "targetNodeTypes")),
    ("edgeStrategies", ("edge_strategies", "edgeStrategies")),
    ("keywords", ("keywords",)),
    ("commonApis", ("common_apis", "commonApis")),
    ("commonLibraries", ("common_libraries", "commonLibraries")),
    ("patterns", ("patterns",)),
    ("requiredEvidence", ("required_evidence", "requiredEvidence")),
    ("supportingEvidence", ("supporting_evidence", "supportingEvidence")),
    ("negativeEvidence", ("negative_evidence", "negativeEvidence")),
    ("unresolvedConditions", ("unresolved_conditions", "unresolvedConditions")),
)


def runtime_contract_content_hash(rule: Any) -> str:
    """Identity of the technical runtime contract: changes iff its content changes.

    Accepts a runtime contract, a runtime mapping (snake or camel case) or an
    EngineeringRule. Any change to what the rule asks a stage to look for, how to
    traverse, what counts as evidence, or which contract version compiled it, gives a
    different hash, so anything keyed by it (a discovery task, a cached plan) cannot
    survive a meaningful rule change. Provenance and legal source are excluded.
    """
    body: dict[str, Any] = {"runtimeContractVersion": RUNTIME_CONTRACT_VERSION}
    for key, names in CONTENT_HASH_FIELDS:
        value = _first(rule, *names)
        if key == "legalIntent":
            body[key] = json.loads(json.dumps(dict(value or {}), sort_keys=True, default=str))
        elif key in {"engineeringRuleId", "legalRuleId", "schemaVersion",
                     "compilerVersion", "promptVersion", "contractVersion", "concept"}:
            body[key] = str(value or "")
        else:
            body[key] = _strings(value)
    body["graphQueries"] = _graph_query_dicts(_first(rule, "graph_queries", "graphQueries"))
    return "sha256:" + hashlib.sha256(
        json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def precompiled_engineering_rule_id(legal_rule_id: str, template_id: str) -> str:
    """Must match PrecompiledEngineeringRuleRegistry.materialize exactly."""
    return f"{legal_rule_id}::PRECOMPILED::{template_id}"


def runtime_contract_from_template(
    template: Mapping[str, Any],
    *,
    bundle: Mapping[str, Any],
    contract_version: str,
) -> EngineeringRuleRuntimeContract | None:
    """A precompiled template as a runtime contract, without inventing legal grounding.

    Goes through ``EngineeringRule.from_dict`` so the template is parsed by the same
    code the runtime rules are; the technical fields are taken as the (already
    overlaid) template carries them. The Scanner has no legal context at scan time,
    so nothing that needs it (the legal reasoning contract) is built here.
    """
    template_id = str(template.get("templateId") or "").strip()
    legal_rule_id = str(template.get("legalRuleId") or "").strip()
    if not template_id or not legal_rule_id:
        return None
    hashes = template.get("groundingContextHashes") or {}
    fingerprint = hashlib.sha256(
        json.dumps(
            {
                "bundleId": bundle.get("bundleId"),
                "templateId": template_id,
                "legalRuleId": legal_rule_id,
                "groundingContextHashes": dict(sorted(dict(hashes).items())),
                "contractVersion": contract_version,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    rule = EngineeringRule.from_dict(
        {
            "engineeringRuleId": precompiled_engineering_rule_id(legal_rule_id, template_id),
            "legalRuleId": legal_rule_id,
            "concept": template.get("concept"),
            "legalIntent": template.get("legalIntent") or {},
            "investigationGoals": template.get("investigationGoals") or [],
            "startingNodeTypes": template.get("startingNodeTypes") or [],
            "targetNodeTypes": template.get("targetNodeTypes") or [],
            "edgeStrategies": template.get("edgeStrategies") or [],
            "graphQueries": template.get("graphQueries") or [],
            "keywords": template.get("keywords") or [],
            "commonApis": template.get("commonApis") or [],
            "commonLibraries": template.get("commonLibraries") or [],
            "patterns": template.get("patterns") or [],
            "requiredEvidence": template.get("requiredEvidence") or [],
            "supportingEvidence": template.get("supportingEvidence") or [],
            "negativeEvidence": template.get("negativeEvidence") or [],
            "unresolvedConditions": template.get("unresolvedConditions") or [],
            "sourceFingerprint": fingerprint,
            "compilerModel": str(bundle.get("compilerModel") or "precompiled"),
            "compilerVersion": str(bundle.get("compilerVersion") or ""),
            "promptVersion": str(bundle.get("promptVersion") or ""),
            "schemaVersion": str(bundle.get("engineeringRuleSchemaVersion") or ""),
        }
    )
    return runtime_contract_from_engineering_rule(
        rule,
        contract_version=contract_version,
        provenance={
            "origin": PROVENANCE_ORIGINS["precompiledBundle"],
            "bundleId": bundle.get("bundleId"),
            "templateId": template_id,
            "matchCitationChunkIds": [
                str(item) for item in template.get("matchCitationChunkIds") or ()
            ],
            "groundingContextHashes": {
                str(key): str(value) for key, value in dict(hashes).items()
            },
        },
    )


__all__ = [
    "EngineeringRuleRuntimeContract",
    "GraphQueryContract",
    "PROVENANCE_ORIGINS",
    "RUNTIME_CONTRACT_VERSION",
    "precompiled_engineering_rule_id",
    "runtime_contract_content_hash",
    "runtime_contract_from_engineering_rule",
    "runtime_contract_from_template",
]
