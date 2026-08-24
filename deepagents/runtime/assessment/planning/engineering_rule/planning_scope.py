"""Per-EngineeringRule planning coverage that does not inherit repository-global uncertainty."""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Any

from tools.legal.legal.engineering_rules.models import EngineeringRule
from tools.graph.scanner.program_graph.models import ProgramEvidenceGraph

from .engineering_rule_planner import EngineeringRulePlanningCandidate
from .material_scope import (
    MaterialEngineeringRulePlanner,
    is_internal_llm_runtime_node,
)
from .models import InvestigationPacket


@dataclass(frozen=True)
class ScopedEngineeringRulePlanningCandidate(EngineeringRulePlanningCandidate):
    """Planning candidate with coverage derived only from the rule's material seed scope.

    Repository-global coverage can be LIMITED because an unrelated language, generated
    artifact, dynamic framework boundary, or scanner limitation exists somewhere else in
    the repository. That is useful diagnostics, but it must not make every EngineeringRule
    uncertain. This contract therefore carries only uncertainty observed inside the
    material rule packet used by the Planner.
    """

    scope_coverage_state: str = "SUFFICIENT"
    scoped_truncated_query_count: int = 0
    scoped_unresolved_frontier_count: int = 0
    scope_coverage_reasons: tuple[str, ...] = ()

    @classmethod
    def from_rule_packet(
        cls,
        rule: EngineeringRule,
        packet: InvestigationPacket,
    ) -> "ScopedEngineeringRulePlanningCandidate":
        base = EngineeringRulePlanningCandidate.from_rule_packet(rule, packet)
        unresolved: set[str] = set(packet.unresolved_frontiers)
        scoped_truncated = 0
        reasons: list[str] = []

        for row in packet.initial_results:
            if not isinstance(row, dict):
                continue
            material_hit_count = int(
                row.get("materialHitCount")
                if row.get("materialHitCount") is not None
                else len(row.get("nodes") or [])
            )
            for value in row.get("unresolvedFrontiers") or row.get("unresolved_frontiers") or []:
                if value:
                    unresolved.add(str(value))
            # A broad start-node query can be truncated because the repository contains
            # many generic nodes. When none of those nodes is material to this rule, that
            # truncation is not allowed to inflate the rule's planning uncertainty.
            if bool(row.get("truncated")) and material_hit_count > 0:
                scoped_truncated += 1
                reasons.append(f"SCOPED_QUERY_TRUNCATED:{row.get('query') or 'unknown'}")

        if unresolved:
            state = "UNRESOLVED"
            reasons.append("SCOPED_UNRESOLVED_FRONTIER")
        elif scoped_truncated:
            state = "LIMITED"
        else:
            state = "SUFFICIENT"

        return cls(
            engineering_rule_id=base.engineering_rule_id,
            concept=base.concept,
            legal_intent=base.legal_intent,
            investigation_goals=base.investigation_goals,
            required_evidence=base.required_evidence,
            legal_reasoning_contract=base.legal_reasoning_contract,
            starting_node_types=base.starting_node_types,
            target_node_types=base.target_node_types,
            source_hit_count=base.source_hit_count,
            source_evidence_count=base.source_evidence_count,
            source_node_types=base.source_node_types,
            scope_coverage_state=state,
            scoped_truncated_query_count=scoped_truncated,
            scoped_unresolved_frontier_count=len(unresolved),
            scope_coverage_reasons=tuple(dict.fromkeys(reasons)),
        )

    def to_prompt_dict(self) -> dict[str, Any]:
        payload = super().to_prompt_dict()
        payload["scopeCoverage"] = {
            "state": self.scope_coverage_state,
            "truncatedQueryCount": self.scoped_truncated_query_count,
            "unresolvedFrontierCount": self.scoped_unresolved_frontier_count,
            "reasons": list(self.scope_coverage_reasons),
            "authority": (
                "Rule-scoped diagnostic only. Repository-global LIMITED state must not "
                "be projected onto this EngineeringRule."
            ),
        }
        return payload


class ScopedMaterialEngineeringRulePlanner(MaterialEngineeringRulePlanner):
    """Material planner whose uncertainty input is per-rule, never repository-global."""

    @staticmethod
    def _graph_summary(graph: ProgramEvidenceGraph) -> dict[str, Any]:
        node_types = Counter(
            str(node.get("node_type"))
            for node in graph.nodes
            if isinstance(node, dict)
            and node.get("node_type")
            and not is_internal_llm_runtime_node(node)
        )
        semantic_types = Counter(
            str(value)
            for node in graph.nodes
            if isinstance(node, dict)
            and not is_internal_llm_runtime_node(node)
            for value in (node.get("semantic_types") or [])
            if value
        )
        # Deliberately omit graph.coverage_state, graph.coverage_notes, and the global
        # unresolved-frontier count. They remain persisted diagnostics, but they are not
        # evidence that a specific EngineeringRule scope is uncertain.
        return {
            "schemaVersion": graph.schema_version,
            "nodeCount": graph.node_count,
            "edgeCount": graph.edge_count,
            "nodeTypes": dict(node_types.most_common(40)),
            "semanticTypes": dict(semantic_types.most_common(40)),
            "coverageAuthority": "PER_RULE_SCOPE_COVERAGE_ONLY",
            "internalRuntimePolicy": (
                "LCSP worker LLM gateway/runtime nodes are excluded from Planner "
                "repositoryEvidenceSummary."
            ),
        }

    @classmethod
    def _prompt(
        cls,
        candidates: tuple[EngineeringRulePlanningCandidate, ...],
        wizard_context: dict[str, Any] | None,
        graph: ProgramEvidenceGraph,
        openwiki_context: dict[str, Any] | None = None,
    ) -> str:
        return (
            "Coverage rule: use each engineering rule's scopeCoverage only. Repository-wide "
            "scanner limitations, unrelated unresolved framework boundaries, and global LIMITED "
            "state are diagnostics and MUST NOT justify SELECT/UNCERTAIN_SCOPE_INVESTIGATE for "
            "another rule. A scopeCoverage.state of UNRESOLVED is relevant only for that rule.\n\n"
            + super()._prompt(candidates, wizard_context, graph, openwiki_context)
        )
