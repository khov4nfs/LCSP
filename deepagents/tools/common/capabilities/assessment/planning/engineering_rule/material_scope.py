"""Material, production-weighted scope signals for the EngineeringRule planner."""
from __future__ import annotations

import json
import re
from dataclasses import replace
from typing import Any

from tools.legal.corpus.engineering_rules.contract.models import EngineeringRule
from tools.common.capabilities.evidence.graph.schema.models import ProgramEvidenceGraph
from tools.common.capabilities.evidence.graph.schema.source_roles import is_material_source_path

from .engineering_rule_planner import (
    EngineeringRulePlanner,
    EngineeringRulePlanningCandidate,
)
from tools.common.capabilities.assessment.claims.evidence_claim.models import InvestigationPacket

_TOKEN = re.compile(r"[A-Za-zÀ-ỹ0-9]+", re.UNICODE)
_GENERIC_SCOPE_TOKENS = frozenset(
    {
        "ai",
        "artificial",
        "intelligence",
        "system",
        "systems",
        "technical",
        "engineering",
        "rule",
        "rules",
        "requirement",
        "requirements",
        "evidence",
        "repository",
        "source",
        "code",
        "control",
        "controls",
        "risk",
        "risks",
        "high",
        "medium",
        "low",
        "data",
        "model",
        "provider",
        "user",
        "users",
        "service",
        "application",
        "process",
        "management",
        "safety",
        "security",
        "compliance",
        "current",
        "state",
        "implementation",
        "ensure",
        "ensures",
        "must",
        "shall",
        "using",
        "used",
        "use",
        "usage",
        "support",
        "supports",
        "relevant",
        "production",
    }
)
_MATERIAL_RESOURCE_NODE_TYPES = frozenset(
    {
        "PACKAGE_DEPENDENCY",
        "EXTERNAL_SERVICE",
        "EXTERNAL_API",
        "DATABASE",
        "TABLE",
        "QUEUE",
        "AI_PROVIDER",
        "DATA_CATEGORY",
        "PERSONAL_DATA",
        "SENSITIVE_DATA",
        "DATA_CONTRACT",
        "GRPC_METHOD",
        "PROTOCOL_MESSAGE",
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
        "BUSINESS_PROCESS",
        "PROCESS_STEP",
        "BUSINESS_DECISION",
        "BUSINESS_OUTCOME",
        "DATA_SUBJECT",
    }
)
_STRONG_RESOLUTION_STATES = frozenset({"OBSERVED", "CORROBORATED"})
_INTERNAL_LLM_RUNTIME_PATH_MARKERS = (
    "deepagents/agent.py",
    "deepagents/subagents/",
    "deepagents/middleware/model_governance.py",
    "deepagents/tools/common/capabilities/assessment/investigation/engineering_rule/investigator.py",
    "deepagents/tools/common/capabilities/assessment/investigation/engineering_rule/code_context_investigator.py",
    "deepagents/tools/common/capabilities/assessment/planning/engineering_rule/engineering_rule_planner.py",
    "deepagents/tools/legal/corpus/engineering_rules/compilation/",
)
_INTERNAL_LLM_RUNTIME_NODE_TYPES = frozenset(
    {
        "AI_INPUT",
        "AI_OUTPUT",
        "AI_MODEL_INVOCATION",
        "AI_PROVIDER",
        "DATA_OBJECT",
    }
)


def _tokens(value: Any) -> set[str]:
    rendered = json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
    return {
        token.lower()
        for token in _TOKEN.findall(rendered.replace("_", " ").replace("-", " "))
        if len(token) > 2
    }


def _specific_contract_terms(rule: EngineeringRule, packet: InvestigationPacket) -> set[str]:
    values: list[Any] = [
        rule.concept,
        rule.legal_intent,
        rule.investigation_goals,
        rule.required_evidence,
        packet.keywords,
        packet.common_apis,
        packet.common_libraries,
        packet.patterns,
        packet.supporting_evidence,
        packet.negative_evidence,
    ]
    result = set().union(*(_tokens(value) for value in values))
    return result - _GENERIC_SCOPE_TOKENS


def _semantic_query_terms(packet: InvestigationPacket) -> set[str]:
    return {
        str(value)
        for query in packet.graph_queries
        if isinstance(query, dict)
        for value in query.get("semanticTypes") or []
        if value
    }


def _is_internal_llm_runtime_node(
    node: dict[str, Any],
    path: str,
) -> bool:
    """Identify LCSP's own LLM gateway plumbing, not product-facing AI evidence."""
    if not path or node.get("node_type") not in _INTERNAL_LLM_RUNTIME_NODE_TYPES:
        return False
    normalized = path.replace("\\", "/")
    return any(marker in normalized for marker in _INTERNAL_LLM_RUNTIME_PATH_MARKERS)


def is_internal_llm_runtime_node(node: dict[str, Any]) -> bool:
    """Return whether a graph node belongs to LCSP's own LLM runtime plumbing."""
    source = node.get("source") if isinstance(node.get("source"), dict) else {}
    path = str(source.get("file_path") or source.get("filePath") or "")
    return _is_internal_llm_runtime_node(node, path)


def _trustworthy_semantic_node(node: dict[str, Any]) -> bool:
    """Return whether graph semantics are strong enough to affect Planner scope."""
    state = str(node.get("resolution_state") or "OBSERVED")
    origin = str(node.get("origin") or "STATIC_ANALYSIS")
    if state not in _STRONG_RESOLUTION_STATES:
        return False
    if origin == "LLM_SEMANTIC_ENRICHMENT":
        # LLM-authored semantic nodes become Planner material only after deterministic
        # provenance validation promoted them to CORROBORATED with concrete support.
        return state == "CORROBORATED" and bool(node.get("support_refs"))
    return True


def _is_material_node(
    node: dict[str, Any],
    *,
    rule: EngineeringRule,
    packet: InvestigationPacket,
    specific_terms: set[str],
    semantic_terms: set[str],
) -> bool:
    source = node.get("source") if isinstance(node.get("source"), dict) else {}
    path = str(source.get("file_path") or source.get("filePath") or "")
    node_type = str(node.get("node_type") or "")
    trustworthy = _trustworthy_semantic_node(node)

    # Script/example/generated sources remain available to the investigator as
    # supporting context, but they cannot make a rule appear applicable to Planner.
    if path and not is_material_source_path(path):
        return False

    node_semantics = {str(value) for value in node.get("semantic_types") or [] if value}
    node_terms = _tokens(
        {
            "label": node.get("label"),
            "nodeType": node_type,
            "attributes": node.get("attributes") or {},
            "semanticTypes": list(node_semantics),
            "symbol": source.get("symbol_ref") or source.get("symbolRef"),
            "path": path,
        }
    )
    if _is_internal_llm_runtime_node(node, path):
        return False

    if semantic_terms and node_semantics.intersection(semantic_terms):
        # Identifier taxonomy is intentionally retained as INFERRED graph context. It
        # cannot by itself make a sensitive/domain rule source-backed.
        return trustworthy

    # A reached target is stronger than a generic start-node seed, but inferred/LLM
    # semantics still require the v3 trust gate before affecting plan scope.
    if node_type in set(rule.target_node_types or ()):
        return trustworthy

    if specific_terms and node_terms.intersection(specific_terms):
        return trustworthy

    # Source-less resource/business/lifecycle nodes can be material when their own
    # metadata is rule-specific and their graph semantics passed the trust gate.
    if not path and node_type in _MATERIAL_RESOURCE_NODE_TYPES:
        return bool(
            trustworthy
            and specific_terms
            and node_terms.intersection(specific_terms)
        )
    return False


def material_planning_packet(
    rule: EngineeringRule,
    packet: InvestigationPacket,
) -> InvestigationPacket:
    """Project broad start-node search results into rule-specific material signals."""
    specific_terms = _specific_contract_terms(rule, packet)
    semantic_terms = _semantic_query_terms(packet)
    rows: list[dict[str, Any]] = []
    refs: set[str] = set()

    for raw in packet.initial_results:
        if not isinstance(raw, dict):
            continue
        nodes = [
            node
            for node in raw.get("nodes") or []
            if isinstance(node, dict)
            and _is_material_node(
                node,
                rule=rule,
                packet=packet,
                specific_terms=specific_terms,
                semantic_terms=semantic_terms,
            )
        ]
        row_refs = {
            str(ref)
            for node in nodes
            for ref in [
                *(node.get("evidence_refs") or []),
                *(node.get("support_refs") or []),
            ]
            if str(ref)
        }
        refs.update(row_refs)
        projected = dict(raw)
        projected["nodes"] = nodes
        projected["evidenceRefs"] = sorted(row_refs)
        projected["materialScopeSignal"] = True
        projected["rawHitCount"] = len(raw.get("nodes") or [])
        projected["materialHitCount"] = len(nodes)
        rows.append(projected)

    return replace(
        packet,
        initial_results=tuple(rows),
        evidence_refs=tuple(sorted(refs)),
    )


class MaterialEngineeringRulePlanner(EngineeringRulePlanner):
    """Planner prompt that treats only rule-specific material seeds as SOURCE basis."""

    @classmethod
    def _prompt(
        cls,
        candidates: tuple[EngineeringRulePlanningCandidate, ...],
        confirmed_customer_context: dict[str, Any] | None,
        graph: ProgramEvidenceGraph,
        openwiki_context: dict[str, Any] | None = None,
    ) -> str:
        rules = []
        for candidate in candidates:
            item = candidate.to_prompt_dict()
            source_seed = item.pop("sourceSeed", {})
            item["materialSourceSignal"] = {
                "hitCount": source_seed.get("hitCount", 0),
                "evidenceRefCount": source_seed.get("evidenceRefCount", 0),
                "nodeTypes": source_seed.get("nodeTypes", []),
                "meaning": (
                    "Rule-specific production evidence only. Generic start-node matches, "
                    "tests, scripts, examples, generated files, INFERRED taxonomy hints, "
                    "and unvalidated LLM semantic proposals are not counted."
                ),
            }
            rules.append(item)
        payload = {
            "confirmedCustomerContext": confirmed_customer_context or {},
            "repositoryEvidenceSummary": cls._graph_summary(graph),
            "openWikiArchitectureHints": openwiki_context or {
                "source": "openwiki",
                "available": False,
                "authority": "UNVERIFIED_ARCHITECTURE_HINT",
                "policy": (
                    "May prioritize planner investigation only. Must not satisfy "
                    "legal citations, source evidence, compliance, or gap classification."
                ),
                "hintCount": 0,
                "hints": [],
            },
            "engineeringRules": rules,
        }
        return (
            "You are the LCSP EngineeringRule Planner. Plan technical investigation scope only; "
            "do not decide legal applicability, legal risk tier, or compliance outcome. Use Customer-confirmed "
            "facts plus each rule's materialSourceSignal. repositoryEvidenceSummary is broad context "
            "and MUST NOT by itself make a domain/tier-specific rule source-backed. A zero material "
            "hit count means LCSP found no rule-specific trustworthy production trigger; generic AI "
            "presence or INFERRED sensitive-data taxonomy is not a contradiction to Customer context. "
            "SELECT when Customer context matches, when a material source signal exists, or when a "
            "concrete unresolved scope fact requires investigation. SKIP healthcare, education, "
            "public-sector, high-risk, medium-risk, prohibited-practice, or other domain-specific "
            "controls when Customer context excludes/does not indicate that scope and materialSourceSignal.hitCount "
            "is zero. OpenWiki architecture hints are unverified documentation hints for "
            "prioritizing search only; they are not SOURCE basis, citation evidence, "
            "source anchors, and not proof of compliance. Never invent rule IDs. Return exactly one decision per rule using only the "
            "declared reason codes and basis values.\n\n"
            + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        )
