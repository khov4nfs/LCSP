"""Material, production-weighted scope signals for the EngineeringRule planner."""
from __future__ import annotations

import json
import re
from dataclasses import replace
from typing import Any

from lcsp_workers.legal.engineering_rules.models import EngineeringRule
from lcsp_workers.scanner.program_graph.models import ProgramEvidenceGraph
from lcsp_workers.scanner.program_graph.source_roles import is_material_source_path

from .engineering_rule_planner import (
    EngineeringRulePlanner,
    EngineeringRulePlanningCandidate,
)
from .models import InvestigationPacket

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
    if semantic_terms and node_semantics.intersection(semantic_terms):
        # Identifier taxonomy is intentionally retained as INFERRED graph context. It
        # cannot by itself make a sensitive/domain rule source-backed.
        return trustworthy

    # A reached target is stronger than a generic start-node seed, but inferred/LLM
    # semantics still require the v3 trust gate before affecting plan scope.
    if node_type in set(rule.target_node_types or ()):
        return trustworthy

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
        wizard_context: dict[str, Any] | None,
        graph: ProgramEvidenceGraph,
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
            "wizardContext": wizard_context or {},
            "repositoryEvidenceSummary": cls._graph_summary(graph),
            "engineeringRules": rules,
        }
        return (
            "You are the LCSP EngineeringRule Planner. Plan technical investigation scope only; "
            "do not decide legal applicability, legal risk tier, or compliance outcome. Use Wizard "
            "facts plus each rule's materialSourceSignal. repositoryEvidenceSummary is broad context "
            "and MUST NOT by itself make a domain/tier-specific rule source-backed. A zero material "
            "hit count means LCSP found no rule-specific trustworthy production trigger; generic AI "
            "presence or INFERRED sensitive-data taxonomy is not a contradiction to Wizard scope. "
            "SELECT when Wizard scope matches, when a material source signal exists, or when a "
            "concrete unresolved scope fact requires investigation. SKIP healthcare, education, "
            "public-sector, high-risk, medium-risk, prohibited-practice, or other domain-specific "
            "controls when Wizard excludes/does not indicate that scope and materialSourceSignal.hitCount "
            "is zero. Never invent rule IDs. Return exactly one decision per rule using only the "
            "declared reason codes and basis values.\n\n"
            + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        )
