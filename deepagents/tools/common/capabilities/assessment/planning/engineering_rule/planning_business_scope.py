"""Rule-scoped, provenance-gated business context for EngineeringRule planning."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from tools.legal.corpus.engineering_rules.contract.models import EngineeringRule
from tools.common.capabilities.evidence.graph.schema.models import ProgramEvidenceGraph
from tools.common.capabilities.evidence.graph.query.query_engine import ProgramGraphQueryEngine

from .material_scope import is_internal_llm_runtime_node
from tools.common.capabilities.assessment.claims.evidence_claim.models import InvestigationPacket
from .planning_scope import (
    ScopedEngineeringRulePlanningCandidate,
    ScopedMaterialEngineeringRulePlanner,
)

_MAX_SCOPE_VALUES = 6
_MAX_SCOPE_REFS = 12
_MAX_SCOPE_FRONTIERS = 8
_MAX_SCOPE_SEEDS = 4

_BUSINESS_NODE_TYPES = frozenset(
    {
        "BUSINESS_PROCESS",
        "BUSINESS_DECISION",
        "DATA_SUBJECT",
        "DATA_CATEGORY",
        "PERSONAL_DATA",
        "SENSITIVE_DATA",
        "AI_CAPABILITY",
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
    }
)
_AI_DECISION_START_NODE_TYPES = frozenset(
    {"AI_MODEL_INVOCATION", "AI_OUTPUT", "MODEL_ENDPOINT", "AI_CAPABILITY", "MODEL"}
)
_SCOPE_EDGE_TYPES = frozenset(
    {
        "CALLS",
        "CALLS_API",
        "TRIGGERS",
        "HANDLED_BY",
        "HANDLES_COMMAND",
        "HANDLES_QUERY",
        "PUBLISHES_EVENT",
        "CONSUMES_EVENT",
        "PUBLISHES_TO_QUEUE",
        "CONSUMES_FROM_QUEUE",
        "PASSES_ARGUMENT",
        "RETURNS",
        "RECEIVES_RETURN",
        "ASSIGNS",
        "ALIASES",
        "MAPS_TO",
        "PARSES",
        "TRANSFORMS",
        "VALIDATES",
        "FLOWS_TO",
        "USES_DATA",
        "CARRIES_DATA",
        "DERIVES_FROM",
        "SENDS_TO_AI",
        "RECEIVES_FROM_AI",
        "WRITES_TO",
        "PERSISTS_TO",
        "SENDS_TO_EXTERNAL",
        "PART_OF_PROCESS",
        "PRECEDES",
        "PERFORMED_BY",
        "AFFECTS_SUBJECT",
        "INVOKES_AI",
        "INFLUENCES_DECISION",
        "WRITES_BUSINESS_STATE",
        "PRODUCES_OUTCOME",
        "REQUIRES_HUMAN_REVIEW",
        "REVIEWED_BY",
        "OVERRIDDEN_BY",
        "UPDATES_STATUS",
        "SERVES_MODEL",
        "TRAINS_MODEL_WITH",
        "FINE_TUNES",
        "EVALUATES_MODEL",
        "PRODUCES_MODEL_ARTIFACT",
        "REGISTERS_MODEL",
        "DEPLOYS_MODEL",
        "MONITORS_MODEL",
        "RETRAINS_MODEL",
    }
)
_MODEL_LIFECYCLE_NODE_TYPES = frozenset(
    {
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
    }
)
_STRONG_RESOLUTION_STATES = frozenset({"OBSERVED", "CORROBORATED"})


@dataclass(frozen=True)
class RulePlanningBusinessScope:
    """Compact technical/business facts the Planner may use for relevance only."""

    business_processes: tuple[str, ...] = ()
    business_decisions: tuple[str, ...] = ()
    affected_subjects: tuple[str, ...] = ()
    data_categories: tuple[str, ...] = ()
    ai_capabilities: tuple[str, ...] = ()
    model_lifecycle_stages: tuple[str, ...] = ()
    decision_influence_state: str = "NO_AI_DECISION_SIGNAL"
    human_oversight_state: str = "NO_DECISION_EFFECT_EVIDENCED"
    material_source_refs: tuple[str, ...] = ()
    unresolved_frontiers: tuple[str, ...] = ()

    def to_prompt_dict(self) -> dict[str, Any]:
        return {
            "businessProcesses": list(self.business_processes),
            "businessDecisions": list(self.business_decisions),
            "affectedSubjects": list(self.affected_subjects),
            "dataCategories": list(self.data_categories),
            "aiCapabilities": list(self.ai_capabilities),
            "modelLifecycleStages": list(self.model_lifecycle_stages),
            "decisionInfluenceState": self.decision_influence_state,
            "humanOversightState": self.human_oversight_state,
            "materialSourceRefs": list(self.material_source_refs),
            "unresolvedFrontiers": list(self.unresolved_frontiers),
            "authority": "TECHNICAL_INVESTIGATION_SCOPE_ONLY",
            "provenance": "RULE_SCOPED_PROVENANCE_GATED",
        }


class RulePlanningBusinessScopeProjector:
    """Project one material rule seed into a bounded business-aware graph summary.

    The projector reuses one graph query engine for the whole assessment. It starts only
    from nodes that already survived ``material_planning_packet`` and admits semantic
    values only from OBSERVED/CORROBORATED graph nodes. LLM business semantics therefore
    affect planning only after the graph provenance gate has promoted them to
    CORROBORATED with concrete support refs.
    """

    def __init__(self, graph: ProgramEvidenceGraph) -> None:
        self._graph = graph
        self._engine = ProgramGraphQueryEngine(graph)
        self._nodes = {
            str(node.get("node_id")): node
            for node in graph.nodes
            if node.get("node_id")
        }

    def project(self, packet: InvestigationPacket) -> RulePlanningBusinessScope:
        seed_nodes = self._packet_nodes(packet)
        scoped_nodes = dict(seed_nodes)
        material_refs = set(packet.evidence_refs)
        support_gate_refs = set(material_refs)
        unresolved = set(packet.unresolved_frontiers)

        for row in packet.initial_results:
            if not isinstance(row, dict):
                continue
            material_hit_count = int(
                row.get("materialHitCount")
                if row.get("materialHitCount") is not None
                else len(row.get("nodes") or [])
            )
            if material_hit_count <= 0:
                continue
            unresolved.update(
                str(value)
                for value in row.get("unresolvedFrontiers")
                or row.get("unresolved_frontiers")
                or []
                if value
            )

        # Pull nearby business/data/AI lifecycle semantics from the unified graph rather
        # than collapsing the rule scope to node-type counts. Structural ownership/import
        # edges are deliberately excluded to keep the projection local to executable flow.
        seeds = self._scope_seeds(seed_nodes.values())
        for seed in seeds:
            result = self._engine.subgraph(
                seed_ref=str(seed["node_id"]),
                direction="BOTH",
                max_depth=4,
                max_nodes=80,
                max_edges=180,
                edge_types=_SCOPE_EDGE_TYPES,
            )
            material_refs.update(result.evidence_refs)
            unresolved.update(result.unresolved_frontiers)
            for node in result.nodes:
                if (
                    self._trusted(node, support_gate_refs)
                    and node.get("node_type") in _BUSINESS_NODE_TYPES
                ):
                    scoped_nodes[str(node["node_id"])] = node

        decision_states: set[str] = set()
        for seed in self._decision_seeds(scoped_nodes.values()):
            result = self._engine.inspect_decision_path(
                start_ref=str(seed["node_id"]),
                max_hops=12,
                max_results=80,
            )
            material_refs.update(result.evidence_refs)
            unresolved.update(result.unresolved_frontiers)
            analysis = result.analysis or {}
            state = str(analysis.get("state") or "DECISION_PATH_UNRESOLVED")
            if not self._decision_analysis_trusted(analysis, support_gate_refs):
                state = "DECISION_PATH_UNRESOLVED"
            decision_states.add(state)
            for node in result.nodes:
                if (
                    self._trusted(node, support_gate_refs)
                    and node.get("node_type") in _BUSINESS_NODE_TYPES
                ):
                    scoped_nodes[str(node["node_id"])] = node

        decision_state = self._aggregate_decision_state(decision_states)
        return RulePlanningBusinessScope(
            business_processes=self._labels(scoped_nodes.values(), "BUSINESS_PROCESS"),
            business_decisions=self._labels(scoped_nodes.values(), "BUSINESS_DECISION"),
            affected_subjects=self._labels(scoped_nodes.values(), "DATA_SUBJECT"),
            data_categories=self._data_categories(scoped_nodes.values()),
            ai_capabilities=self._labels(scoped_nodes.values(), "AI_CAPABILITY"),
            model_lifecycle_stages=self._lifecycle_stages(scoped_nodes.values()),
            decision_influence_state=decision_state,
            human_oversight_state=self._human_oversight_state(decision_state),
            material_source_refs=tuple(sorted(material_refs)[:_MAX_SCOPE_REFS]),
            unresolved_frontiers=tuple(sorted(unresolved)[:_MAX_SCOPE_FRONTIERS]),
        )

    @staticmethod
    def _trusted(
        node: dict[str, Any],
        material_refs: set[str] | None = None,
    ) -> bool:
        if is_internal_llm_runtime_node(node):
            return False
        state = str(node.get("resolution_state") or "OBSERVED")
        origin = str(node.get("origin") or "STATIC_ANALYSIS")
        if state not in _STRONG_RESOLUTION_STATES:
            return False
        if origin == "LLM_SEMANTIC_ENRICHMENT":
            support_refs = {
                str(value) for value in node.get("support_refs") or [] if value
            }
            if material_refs is None:
                return state == "CORROBORATED" and bool(support_refs)
            return state == "CORROBORATED" and bool(
                support_refs.intersection(material_refs)
            )
        return True

    def _decision_analysis_trusted(
        self,
        analysis: dict[str, Any],
        material_refs: set[str],
    ) -> bool:
        refs = {
            str(value)
            for key in ("decisionNodeRefs", "effectNodeRefs", "humanControlRefs")
            for value in analysis.get(key) or []
            if value
        }
        return all(
            self._trusted(self._nodes[ref], material_refs)
            for ref in refs
            if ref in self._nodes
        )

    def _packet_nodes(self, packet: InvestigationPacket) -> dict[str, dict[str, Any]]:
        rows: dict[str, dict[str, Any]] = {}
        for result in packet.initial_results:
            if not isinstance(result, dict):
                continue
            for node in result.get("nodes") or []:
                if not isinstance(node, dict) or not node.get("node_id"):
                    continue
                if self._trusted(node):
                    rows[str(node["node_id"])] = node
        return rows

    @staticmethod
    def _scope_seeds(nodes) -> tuple[dict[str, Any], ...]:
        priority = {
            "BUSINESS_PROCESS": 0,
            "BUSINESS_DECISION": 1,
            "AI_CAPABILITY": 2,
            "AI_MODEL_INVOCATION": 3,
            "AI_OUTPUT": 4,
            "MODEL_ENDPOINT": 5,
            "DATA_SUBJECT": 6,
            "SENSITIVE_DATA": 7,
            "PERSONAL_DATA": 8,
            "DATA_CATEGORY": 9,
        }
        ordered = sorted(
            (node for node in nodes if node.get("node_id")),
            key=lambda node: (
                priority.get(str(node.get("node_type") or ""), 50),
                str(node.get("node_id") or ""),
            ),
        )
        return tuple(ordered[:_MAX_SCOPE_SEEDS])

    @staticmethod
    def _decision_seeds(nodes) -> tuple[dict[str, Any], ...]:
        ordered = sorted(
            (
                node
                for node in nodes
                if node.get("node_id")
                and node.get("node_type") in _AI_DECISION_START_NODE_TYPES
            ),
            key=lambda node: str(node.get("node_id") or ""),
        )
        return tuple(ordered[:_MAX_SCOPE_SEEDS])

    @staticmethod
    def _labels(nodes, node_type: str) -> tuple[str, ...]:
        values = {
            str(node.get("label") or "").strip()
            for node in nodes
            if node.get("node_type") == node_type and str(node.get("label") or "").strip()
        }
        return tuple(sorted(values)[:_MAX_SCOPE_VALUES])

    @staticmethod
    def _data_categories(nodes) -> tuple[str, ...]:
        values: set[str] = set()
        for node in nodes:
            if node.get("node_type") not in {"DATA_CATEGORY", "PERSONAL_DATA", "SENSITIVE_DATA"}:
                continue
            label = str(node.get("label") or "").strip()
            if label:
                values.add(label)
            values.update(str(value) for value in node.get("semantic_types") or [] if value)
        return tuple(sorted(values)[:_MAX_SCOPE_VALUES])

    @staticmethod
    def _lifecycle_stages(nodes) -> tuple[str, ...]:
        values = {
            str(node.get("node_type"))
            for node in nodes
            if node.get("node_type") in _MODEL_LIFECYCLE_NODE_TYPES
        }
        return tuple(sorted(values)[:_MAX_SCOPE_VALUES])

    @staticmethod
    def _aggregate_decision_state(states: set[str]) -> str:
        if not states:
            return "NO_AI_DECISION_SIGNAL"
        if {
            "HUMAN_IN_LOOP_PRESENT",
            "AUTOMATED_DECISION_CANDIDATE",
        }.issubset(states):
            return "MIXED_HUMAN_AND_AUTOMATED_DECISION_PATHS"
        for state in (
            "HUMAN_IN_LOOP_PRESENT",
            "AUTOMATED_DECISION_CANDIDATE",
            "AI_INFLUENCES_DECISION",
            "DECISION_PATH_UNRESOLVED",
            "NO_DECISION_EFFECT_EVIDENCED",
        ):
            if state in states:
                return state
        return "DECISION_PATH_UNRESOLVED"

    @staticmethod
    def _human_oversight_state(decision_state: str) -> str:
        if decision_state == "HUMAN_IN_LOOP_PRESENT":
            return "PRESENT"
        if decision_state == "AUTOMATED_DECISION_CANDIDATE":
            return "ABSENT_WITH_BOUNDED_PATH"
        if decision_state == "MIXED_HUMAN_AND_AUTOMATED_DECISION_PATHS":
            return "MIXED"
        if decision_state in {"AI_INFLUENCES_DECISION", "DECISION_PATH_UNRESOLVED"}:
            return "UNKNOWN"
        return "NO_DECISION_EFFECT_EVIDENCED"


@dataclass(frozen=True)
class BusinessAwareScopedEngineeringRulePlanningCandidate(
    ScopedEngineeringRulePlanningCandidate
):
    """Scoped planning candidate carrying a bounded semantic business projection."""

    planning_business_scope: RulePlanningBusinessScope = field(
        default_factory=RulePlanningBusinessScope
    )

    @classmethod
    def from_rule_packet(
        cls,
        rule: EngineeringRule,
        packet: InvestigationPacket,
        projector: RulePlanningBusinessScopeProjector,
    ) -> "BusinessAwareScopedEngineeringRulePlanningCandidate":
        base = ScopedEngineeringRulePlanningCandidate.from_rule_packet(rule, packet)
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
            scope_coverage_state=base.scope_coverage_state,
            scoped_truncated_query_count=base.scoped_truncated_query_count,
            scoped_unresolved_frontier_count=base.scoped_unresolved_frontier_count,
            scope_coverage_reasons=base.scope_coverage_reasons,
            planning_business_scope=projector.project(packet),
        )

    def to_prompt_dict(self) -> dict[str, Any]:
        payload = super().to_prompt_dict()
        payload["planningBusinessScope"] = self.planning_business_scope.to_prompt_dict()
        return payload


class BusinessAwareScopedMaterialEngineeringRulePlanner(
    ScopedMaterialEngineeringRulePlanner
):
    """Planner that reasons from explicit provenance-gated business scope semantics."""

    @classmethod
    def _prompt(
        cls,
        candidates,
        confirmed_customer_context: dict[str, Any] | None,
        graph: ProgramEvidenceGraph,
        openwiki_context: dict[str, Any] | None = None,
    ) -> str:
        return (
            "Business-scope rule: use each rule's planningBusinessScope to distinguish "
            "business process, affected subject, data category, AI capability, model "
            "lifecycle, decision influence, and human oversight when deciding technical "
            "investigation relevance. These fields are provenance-gated graph facts, not "
            "legal applicability or risk-tier conclusions. A populated business scope may "
            "justify SOURCE relevance only for the matching EngineeringRule contract; do "
            "not generalize one process/domain signal to unrelated rules. Empty fields are "
            "not proof of absence when planningBusinessScope.unresolvedFrontiers is non-empty "
            "or scopeCoverage is UNRESOLVED.\n\n"
            + super()._prompt(
                candidates,
                confirmed_customer_context,
                graph,
                openwiki_context,
            )
        )
