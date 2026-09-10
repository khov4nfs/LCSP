"""Build a precompiled bundle from EngineeringRules the Triage subagent already produced.

This is the inverse of PrecompiledEngineeringRuleRegistry.materialize(). Triage owns the
Candidate -> EngineeringRule reasoning; exporting its persisted result lets a cleared
Chroma cache recover deterministically without calling an LLM again.

Grounding hashes must cover the LegalRule's full cited context, not only the candidate
chunks, because recovery rejects any context chunk it cannot hash-verify.
"""

from __future__ import annotations

from typing import Any

from ..compilation.compiler import COMPILER_VERSION, PROMPT_VERSION
from ..contract.models import ENGINEERING_RULE_SCHEMA_VERSION


_TEMPLATE_FIELDS = (
    ("concept", "concept"),
    ("legal_intent", "legalIntent"),
    ("investigation_goals", "investigationGoals"),
    ("starting_node_types", "startingNodeTypes"),
    ("target_node_types", "targetNodeTypes"),
    ("edge_strategies", "edgeStrategies"),
    ("graph_queries", "graphQueries"),
    ("keywords", "keywords"),
    ("common_apis", "commonApis"),
    ("common_libraries", "commonLibraries"),
    ("patterns", "patterns"),
    ("required_evidence", "requiredEvidence"),
    ("supporting_evidence", "supportingEvidence"),
    ("negative_evidence", "negativeEvidence"),
    ("unresolved_conditions", "unresolvedConditions"),
)


def template_id_for(legal_rule_id: str, engineering_rule_id: str) -> str:
    """Derive a template id that stays unique within one LegalRule."""
    prefix = f"{legal_rule_id}::"
    suffix = (
        engineering_rule_id[len(prefix):]
        if engineering_rule_id.startswith(prefix)
        else engineering_rule_id
    )
    return suffix.replace("::", "-").strip("-") or "ENG"


def build_template(
    engineering_rule: dict[str, Any],
    *,
    legal_rule_id: str,
    grounding_hashes: dict[str, str],
) -> dict[str, Any]:
    """Map one persisted EngineeringRule onto a precompiled bundle template."""
    engineering_rule_id = str(engineering_rule.get("engineering_rule_id") or "")
    if not engineering_rule_id:
        raise ValueError("persisted EngineeringRule is missing engineering_rule_id")
    if not grounding_hashes or any(not value for value in grounding_hashes.values()):
        raise ValueError(
            "precompiled export requires a content hash for every cited chunk"
        )

    match_chunk_ids = sorted(
        str(value)
        for value in (engineering_rule.get("source_chunk_ids") or [])
        if str(value)
    )
    if not match_chunk_ids:
        raise ValueError("persisted EngineeringRule is missing source chunk IDs")
    uncovered = sorted(set(match_chunk_ids) - set(grounding_hashes))
    if uncovered:
        raise ValueError(
            f"candidate chunks are not grounded by the cited context: {uncovered}"
        )

    template: dict[str, Any] = {
        "templateId": template_id_for(legal_rule_id, engineering_rule_id),
        "legalRuleId": legal_rule_id,
        "matchCitationChunkIds": match_chunk_ids,
        "groundingContextHashes": dict(sorted(grounding_hashes.items())),
    }
    for snake, camel in _TEMPLATE_FIELDS:
        template[camel] = engineering_rule.get(snake)
    return template


def build_no_rule_entry(
    *,
    legal_rule_id: str,
    grounding_hashes: dict[str, str],
) -> dict[str, Any]:
    """Record that triage decided this LegalRule yields no EngineeringRule.

    Without this the bundle can only restore rules that exist, so a cleared cache would
    make every legitimately context-only LegalRule look like unprepared work again.
    """
    if not legal_rule_id.strip():
        raise ValueError("no-rule entry requires a legalRuleId")
    if not grounding_hashes or any(not value for value in grounding_hashes.values()):
        raise ValueError(
            "precompiled export requires a content hash for every cited chunk"
        )
    return {
        "legalRuleId": legal_rule_id,
        "groundingContextHashes": dict(sorted(grounding_hashes.items())),
    }


def build_bundle(
    templates: list[dict[str, Any]],
    *,
    bundle_id: str,
    compiler_model: str,
    no_rule_entries: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Assemble the bundle with the exact runtime contract the registry validates."""
    if not bundle_id.strip():
        raise ValueError("precompiled bundle requires a bundleId")
    return {
        "bundleId": bundle_id,
        "engineeringRuleSchemaVersion": ENGINEERING_RULE_SCHEMA_VERSION,
        "compilerVersion": COMPILER_VERSION,
        "promptVersion": PROMPT_VERSION,
        "compilerModel": compiler_model,
        "templates": sorted(
            templates,
            key=lambda item: (item["legalRuleId"], item["templateId"]),
        ),
        "noEngineeringRuleLegalRules": sorted(
            no_rule_entries or [],
            key=lambda item: item["legalRuleId"],
        ),
    }


__all__ = [
    "build_bundle",
    "build_no_rule_entry",
    "build_template",
    "template_id_for",
]
