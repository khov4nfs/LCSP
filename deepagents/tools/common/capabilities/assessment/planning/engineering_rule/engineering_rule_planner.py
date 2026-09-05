"""LLM-assisted EngineeringRule planning with deterministic fail-closed validation."""
from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, replace
from typing import Any, Iterable

from langchain.agents import create_agent

from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
from model_policy import PLANNER_MODEL_SPEC
from tools.legal.corpus.engineering_rules.contract.models import EngineeringRule
from tools.common.capabilities.platform.logging import get_logger
from tools.common.capabilities.evidence.graph.schema.models import ProgramEvidenceGraph
from .confirmed_business_context import (
    ConfirmedStructuredBusinessContext,
    coerce_confirmed_structured_business_context,
)

from tools.common.capabilities.assessment.claims.evidence_claim.models import InvestigationPacket


logger = get_logger(__name__)

ENGINEERING_RULE_PLAN_DECISIONS = {
    "select": "SELECT",
    "skip": "SKIP",
}

ENGINEERING_RULE_PLAN_REASON_CODES = {
    "customer_context_scope_match": "CUSTOMER_CONTEXT_SCOPE_MATCH",
    "source_scope_match": "SOURCE_SCOPE_MATCH",
    "customer_context_and_source_match": "CUSTOMER_CONTEXT_AND_SOURCE_MATCH",
    "baseline_control_relevant": "BASELINE_CONTROL_RELEVANT",
    "uncertain_scope_investigate": "UNCERTAIN_SCOPE_INVESTIGATE",
    "no_scope_signal": "NO_CUSTOMER_CONTEXT_OR_SOURCE_SCOPE_SIGNAL",
    "customer_context_scope_excludes": "CUSTOMER_CONTEXT_SCOPE_EXCLUDES_RULE",
    "source_signal_not_material": "SOURCE_SIGNAL_NOT_MATERIAL",
    "rule_scope_not_applicable": "RULE_SCOPE_NOT_APPLICABLE",
}

ENGINEERING_RULE_PLAN_BASIS = {
    "customer_context": "CUSTOMER_CONTEXT",
    "source": "SOURCE",
    "rule_contract": "RULE_CONTRACT",
}

_SELECT_REASONS = {
    ENGINEERING_RULE_PLAN_REASON_CODES["customer_context_scope_match"],
    ENGINEERING_RULE_PLAN_REASON_CODES["source_scope_match"],
    ENGINEERING_RULE_PLAN_REASON_CODES["customer_context_and_source_match"],
    ENGINEERING_RULE_PLAN_REASON_CODES["baseline_control_relevant"],
    ENGINEERING_RULE_PLAN_REASON_CODES["uncertain_scope_investigate"],
}
_SKIP_REASONS = {
    ENGINEERING_RULE_PLAN_REASON_CODES["no_scope_signal"],
    ENGINEERING_RULE_PLAN_REASON_CODES["customer_context_scope_excludes"],
    ENGINEERING_RULE_PLAN_REASON_CODES["source_signal_not_material"],
    ENGINEERING_RULE_PLAN_REASON_CODES["rule_scope_not_applicable"],
}


@dataclass(frozen=True)
class EngineeringRulePlanningCandidate:
    """Bounded metadata supplied to the planner for one EngineeringRule."""

    engineering_rule_id: str
    concept: str
    legal_intent: dict[str, Any]
    investigation_goals: tuple[str, ...]
    required_evidence: tuple[str, ...]
    legal_reasoning_contract: dict[str, Any]
    starting_node_types: tuple[str, ...]
    target_node_types: tuple[str, ...]
    source_hit_count: int
    source_evidence_count: int
    source_node_types: tuple[str, ...]

    @classmethod
    def from_rule_packet(
        cls,
        rule: EngineeringRule,
        packet: InvestigationPacket,
    ) -> "EngineeringRulePlanningCandidate":
        nodes: list[dict[str, Any]] = []
        evidence_refs: set[str] = set()
        for row in packet.initial_results:
            if not isinstance(row, dict):
                continue
            for node in row.get("nodes") or []:
                if isinstance(node, dict):
                    nodes.append(node)
            for ref in row.get("evidenceRefs") or row.get("evidence_refs") or []:
                if ref:
                    evidence_refs.add(str(ref))
        source_node_types = tuple(
            sorted(
                {
                    str(node.get("node_type"))
                    for node in nodes
                    if node.get("node_type")
                }
            )
        )
        legal_reasoning_contract = getattr(rule, "legal_reasoning_contract", None)
        return cls(
            engineering_rule_id=rule.engineering_rule_id,
            concept=rule.concept,
            legal_intent=dict(rule.legal_intent),
            investigation_goals=tuple(rule.investigation_goals),
            required_evidence=tuple(rule.required_evidence),
            legal_reasoning_contract=(
                legal_reasoning_contract.to_prompt_dict()
                if hasattr(legal_reasoning_contract, "to_prompt_dict")
                else
                legal_reasoning_contract.to_dict()
                if hasattr(legal_reasoning_contract, "to_dict")
                else (
                    legal_reasoning_contract
                    if isinstance(legal_reasoning_contract, dict)
                    else {}
                )
            ),
            starting_node_types=tuple(rule.starting_node_types),
            target_node_types=tuple(rule.target_node_types),
            source_hit_count=len(nodes),
            source_evidence_count=len(evidence_refs),
            source_node_types=source_node_types,
        )

    def to_prompt_dict(self) -> dict[str, Any]:
        return {
            "engineeringRuleId": self.engineering_rule_id,
            "concept": self.concept,
            "legalIntent": self.legal_intent,
            "investigationGoals": list(self.investigation_goals),
            "requiredEvidence": list(self.required_evidence),
            "legalReasoningContract": self.legal_reasoning_contract,
            "startingNodeTypes": list(self.starting_node_types),
            "targetNodeTypes": list(self.target_node_types),
            "sourceSeed": {
                "hitCount": self.source_hit_count,
                "evidenceRefCount": self.source_evidence_count,
                "nodeTypes": list(self.source_node_types),
            },
        }


@dataclass(frozen=True)
class EngineeringRulePlanDecisionAudit:
    """Observed planner decision plus deterministic validation outcome for one rule."""

    engineering_rule_id: str
    requested_decision: str
    final_decision: str
    reason_code: str
    basis: tuple[str, ...]
    validation_override: str | None = None
    interview_context_revision_used: int | None = None
    confirmed_statement_refs_used: tuple[str, ...] = ()
    context_limitations_used: tuple[str, ...] = ()
    source_version_ref: str | None = None
    pge_version: str | None = None
    guidance_version: str | None = None


@dataclass(frozen=True)
class EngineeringRulePlan:
    """Validated plan consumed by the deterministic investigation pipeline."""

    selected_rule_ids: tuple[str, ...]
    skipped_rule_ids: tuple[str, ...]
    fallback_used: bool = False
    decision_audit: tuple[EngineeringRulePlanDecisionAudit, ...] = ()

    @property
    def context_provenance(self) -> dict[str, Any]:
        for row in self.decision_audit:
            if row.interview_context_revision_used is not None:
                return {
                    "interviewContextRevisionUsed": row.interview_context_revision_used,
                    "confirmedStatementRefsUsed": list(
                        row.confirmed_statement_refs_used
                    ),
                    "contextLimitationsUsed": list(row.context_limitations_used),
                    "sourceVersionRef": row.source_version_ref,
                    "pgeVersion": row.pge_version,
                    "guidanceVersion": row.guidance_version,
                    "authority": "CUSTOMER_CONFIRMED_CONFIRMED_ONLY",
                    "orchestrationStalenessPolicy": (
                        "RECORDED_ONLY_PLANNER_DOES_NOT_CHOOSE_RERUN_GRANULARITY"
                    ),
                }
        return {}


class EngineeringRulePlanner:
    """Use one LLM planning pass to narrow the EngineeringRule investigation set.

    The model decides investigation relevance only. It cannot create EngineeringRule
    identities, decide a legal risk tier, or produce the final rule outcome. Every
    plan is validated against the immutable candidate set before execution.
    """

    def __init__(self, model: str = PLANNER_MODEL_SPEC) -> None:
        self._model = model

    def plan(
        self,
        *,
        candidates: Iterable[EngineeringRulePlanningCandidate],
        confirmed_customer_context: ConfirmedStructuredBusinessContext
        | dict[str, Any]
        | None,
        graph: ProgramEvidenceGraph,
        workflow_run_id: str,
        correlation_id: str | None = None,
        openwiki_context: dict[str, Any] | None = None,
    ) -> EngineeringRulePlan:
        rows = tuple(candidates)
        if not rows:
            return EngineeringRulePlan((), ())
        confirmed_context = coerce_confirmed_structured_business_context(
            confirmed_customer_context
        )
        provenance = _context_audit_kwargs(confirmed_context)
        if len(rows) == 1:
            rule_id = rows[0].engineering_rule_id
            return EngineeringRulePlan(
                (rule_id,),
                (),
                decision_audit=(
                    EngineeringRulePlanDecisionAudit(
                        engineering_rule_id=rule_id,
                        requested_decision="AUTO_SELECT",
                        final_decision="SELECT",
                        reason_code="SINGLE_CANDIDATE",
                        basis=(),
                        **provenance,
                    ),
                ),
            )

        try:
            agent = create_agent(
                model=self._model,
                system_prompt=(
                    "Plan the bounded technical investigation only. Do not make "
                    "legal applicability, risk, or compliance decisions."
                ),
                response_format=self._plan_response_schema(),
                middleware=MODEL_GOVERNANCE_MIDDLEWARE,
                name="lcsp-engineering-rule-planner",
            )
            response = agent.invoke(
                {
                    "messages": [
                        {
                            "role": "user",
                            "content": self._prompt(
                                rows,
                                confirmed_context,
                                graph,
                                openwiki_context,
                            ),
                        }
                    ]
                },
                config={
                    "metadata": {
                        "workflow_run_id": workflow_run_id,
                        "node_name": "plan_engineering_rules",
                        "correlationId": correlation_id,
                    },
                    "configurable": {"thread_id": workflow_run_id},
                },
            )
            plan = self._validate_plan(
                rows,
                response.get("structured_response") or {},
                confirmed_context=confirmed_context,
            )
            requested = Counter(row.requested_decision for row in plan.decision_audit)
            reasons = Counter(row.reason_code or "MISSING" for row in plan.decision_audit)
            basis = Counter(value for row in plan.decision_audit for value in row.basis)
            overrides = Counter(
                row.validation_override
                for row in plan.decision_audit
                if row.validation_override
            )
            logger.info(
                "ENGINEERING_RULE_PLAN_READY",
                candidate_count=len(rows),
                selected_count=len(plan.selected_rule_ids),
                skipped_count=len(plan.skipped_rule_ids),
                fallback_used=plan.fallback_used,
                planner_requested_select_count=requested.get("SELECT", 0),
                planner_requested_skip_count=requested.get("SKIP", 0),
                validation_override_count=sum(overrides.values()),
                validation_override_counts=dict(overrides),
                reason_code_counts=dict(reasons),
                basis_counts=dict(basis),
                workflow_run_id=workflow_run_id,
                correlationId=correlation_id,
            )
            return plan
        except Exception as error:
            # Planning is an optimization/relevance layer, never an authority that
            # may silently remove controls. If the provider or plan contract fails,
            # preserve the previous fail-safe behavior and investigate all rules.
            logger.warning(
                "ENGINEERING_RULE_PLAN_FALLBACK_ALL",
                candidate_count=len(rows),
                error_type=type(error).__name__,
                workflow_run_id=workflow_run_id,
                correlationId=correlation_id,
            )
            return EngineeringRulePlan(
                tuple(row.engineering_rule_id for row in rows),
                (),
                fallback_used=True,
                decision_audit=tuple(
                    EngineeringRulePlanDecisionAudit(
                        engineering_rule_id=row.engineering_rule_id,
                        requested_decision="FALLBACK",
                        final_decision="SELECT",
                        reason_code="PLANNER_FAILURE",
                        basis=(),
                        validation_override="FALLBACK_ALL",
                        **provenance,
                    )
                    for row in rows
                ),
            )

    @staticmethod
    def _validate_plan(
        candidates: tuple[EngineeringRulePlanningCandidate, ...],
        payload: dict[str, Any],
        *,
        confirmed_context: ConfirmedStructuredBusinessContext,
    ) -> EngineeringRulePlan:
        known = {row.engineering_rule_id: row for row in candidates}
        raw = payload.get("decisions")
        if not isinstance(raw, list):
            raise ValueError("planner decisions must be an array")

        decisions: dict[str, tuple[str, str, set[str]]] = {}
        invalid_ids: set[str] = set()
        duplicates: set[str] = set()
        for item in raw:
            if not isinstance(item, dict):
                continue
            rule_id = str(item.get("engineeringRuleId") or "")
            if rule_id not in known:
                if rule_id:
                    invalid_ids.add(rule_id)
                continue
            if rule_id in decisions:
                duplicates.add(rule_id)
                continue
            decision = str(item.get("decision") or "")
            reason_code = str(item.get("reasonCode") or "")
            basis = {
                str(value)
                for value in (item.get("basis") or [])
                if isinstance(value, str)
            }
            decisions[rule_id] = (decision, reason_code, basis)

        if invalid_ids:
            raise ValueError("planner returned unknown EngineeringRule IDs")

        selected: list[str] = []
        skipped: list[str] = []
        audits: dict[str, EngineeringRulePlanDecisionAudit] = {}
        provenance = _context_audit_kwargs(confirmed_context)

        def choose(
            *,
            rule_id: str,
            requested: str,
            final: str,
            reason_code: str,
            basis: set[str],
            override: str | None = None,
        ) -> None:
            audits[rule_id] = EngineeringRulePlanDecisionAudit(
                engineering_rule_id=rule_id,
                requested_decision=requested or "MISSING",
                final_decision=final,
                reason_code=reason_code or "MISSING",
                basis=tuple(sorted(basis)),
                validation_override=override,
                **provenance,
            )
            (selected if final == "SELECT" else skipped).append(rule_id)

        for candidate in candidates:
            rule_id = candidate.engineering_rule_id
            row = decisions.get(rule_id)
            # Missing or duplicate decisions fail closed to SELECT rather than
            # allowing a model formatting mistake to suppress an investigation.
            if row is None:
                choose(
                    rule_id=rule_id,
                    requested="MISSING",
                    final="SELECT",
                    reason_code="MISSING",
                    basis=set(),
                    override="MISSING_DECISION",
                )
                continue
            decision, reason_code, decision_basis = row
            if rule_id in duplicates:
                choose(
                    rule_id=rule_id,
                    requested=decision,
                    final="SELECT",
                    reason_code=reason_code,
                    basis=decision_basis,
                    override="DUPLICATE_DECISION",
                )
                continue
            if decision == ENGINEERING_RULE_PLAN_DECISIONS["select"]:
                choose(
                    rule_id=rule_id,
                    requested=decision,
                    final="SELECT",
                    reason_code=reason_code,
                    basis=decision_basis,
                    override=(None if reason_code in _SELECT_REASONS else "INVALID_SELECT_REASON"),
                )
                continue
            if decision != ENGINEERING_RULE_PLAN_DECISIONS["skip"]:
                choose(
                    rule_id=rule_id,
                    requested=decision,
                    final="SELECT",
                    reason_code=reason_code,
                    basis=decision_basis,
                    override="INVALID_DECISION",
                )
                continue
            if reason_code not in _SKIP_REASONS:
                choose(
                    rule_id=rule_id,
                    requested=decision,
                    final="SELECT",
                    reason_code=reason_code,
                    basis=decision_basis,
                    override="INVALID_SKIP_REASON",
                )
                continue

            # A rule with repository seed hits may be skipped only when the plan
            # explicitly considered SOURCE evidence. This catches the dangerous
            # case where Customer context alone suppresses contradictory code facts.
            if (
                candidate.source_hit_count > 0
                and ENGINEERING_RULE_PLAN_BASIS["source"] not in decision_basis
            ):
                choose(
                    rule_id=rule_id,
                    requested=decision,
                    final="SELECT",
                    reason_code=reason_code,
                    basis=decision_basis,
                    override="SOURCE_BASIS_REQUIRED",
                )
                continue
            if (
                candidate.source_hit_count > 0
                and reason_code
                == ENGINEERING_RULE_PLAN_REASON_CODES[
                    "customer_context_scope_excludes"
                ]
            ):
                choose(
                    rule_id=rule_id,
                    requested=decision,
                    final="SELECT",
                    reason_code=reason_code,
                    basis=decision_basis,
                    override="SOURCE_CONTRADICTS_CUSTOMER_CONTEXT_EXCLUSION",
                )
                continue
            choose(
                rule_id=rule_id,
                requested=decision,
                final="SKIP",
                reason_code=reason_code,
                basis=decision_basis,
            )

        if not selected:
            # An all-SKIP plan is never trusted blindly. Prefer source-backed rules;
            # when no source seed exists, preserve the previous full investigation.
            source_backed = [
                row.engineering_rule_id for row in candidates if row.source_hit_count > 0
            ]
            selected = source_backed or [row.engineering_rule_id for row in candidates]
            selected_set = set(selected)
            skipped = [rule_id for rule_id in known if rule_id not in selected_set]
            for rule_id in selected:
                current = audits.get(rule_id)
                if current is None:
                    continue
                audits[rule_id] = replace(
                    current,
                    final_decision="SELECT",
                    validation_override=(
                        "ALL_SKIP_SOURCE_BACKED_RECOVERY"
                        if source_backed
                        else "ALL_SKIP_FALLBACK_ALL"
                    ),
                )

        return EngineeringRulePlan(
            tuple(selected),
            tuple(skipped),
            decision_audit=tuple(audits[row.engineering_rule_id] for row in candidates),
        )

    @staticmethod
    def _graph_summary(graph: ProgramEvidenceGraph) -> dict[str, Any]:
        node_types = Counter(
            str(node.get("node_type"))
            for node in graph.nodes
            if isinstance(node, dict) and node.get("node_type")
        )
        semantic_types = Counter(
            str(value)
            for node in graph.nodes
            if isinstance(node, dict)
            for value in (node.get("semantic_types") or [])
            if value
        )
        return {
            "coverageState": graph.coverage_state,
            "nodeCount": graph.node_count,
            "edgeCount": graph.edge_count,
            "nodeTypes": dict(node_types.most_common(40)),
            "semanticTypes": dict(semantic_types.most_common(40)),
            "unresolvedFrontierCount": len(graph.unresolved_frontiers),
        }

    @classmethod
    def _prompt(
        cls,
        candidates: tuple[EngineeringRulePlanningCandidate, ...],
        confirmed_customer_context: ConfirmedStructuredBusinessContext,
        graph: ProgramEvidenceGraph,
        openwiki_context: dict[str, Any] | None = None,
    ) -> str:
        payload = {
            "confirmedStructuredBusinessContext": (
                confirmed_customer_context.to_prompt_dict()
            ),
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
            "engineeringRules": [row.to_prompt_dict() for row in candidates],
        }
        return (
            "You are the LCSP EngineeringRule Planner. Select only the technical "
            "EngineeringRules that should be investigated for this assessment using "
            "both confirmed structured business context and repository evidence summaries. "
            "Use only confirmedStructuredBusinessContext.statements where source is "
            "CUSTOMER_CONFIRMED and resolutionState is CONFIRMED. This is an "
            "investigation-scope plan, not a legal applicability or legal risk-tier "
            "decision. Never invent rule IDs. Never create, rewrite, or promote Customer "
            "context; never use raw Interview turns, model strategy traces, learning signals, "
            "legacy wizard-derived fields, CUSTOMER_STATED, UNCERTAIN, CONFLICTED, "
            "or SUPERSEDED as factual planning input. Never treat "
            "Customer context as stronger "
            "than contradictory repository evidence. If scope is uncertain, SELECT "
            "the rule. Treat LegalReasoningContract as the only legal authority: "
            "citationSet, version IDs, jurisdiction, applicabilityCriteria, "
            "requiredEvidence, acceptedEvidenceTypes, negativeEvidenceTypes, and "
            "validationPolicy bound what may be investigated. Do not create legal "
            "claims or compliance conclusions. OpenWiki architecture hints, when "
            "present, are unverified documentation hints for prioritizing search "
            "only; they are not SOURCE basis, citation evidence, source anchors, "
            "and not proof of compliance. Domain-specific "
            "rules such as healthcare, education, public-sector, high-risk, or "
            "medium-risk should be SKIP only when neither Customer context nor source "
            "signals make their technical requirement materially relevant. For every "
            "rule submit one decision and use only the declared reason codes/basis.\n\n"
            + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        )

    @staticmethod
    def _plan_response_schema() -> dict[str, Any]:
        decision_values = list(ENGINEERING_RULE_PLAN_DECISIONS.values())
        reason_values = list(ENGINEERING_RULE_PLAN_REASON_CODES.values())
        basis_values = list(ENGINEERING_RULE_PLAN_BASIS.values())
        return {
            "title": "EngineeringRulePlanResponse",
            "description": (
                "Exactly one relevance decision per candidate EngineeringRule. "
                "This plans technical investigation only."
            ),
            "type": "object",
            "additionalProperties": False,
            "required": ["decisions"],
            "properties": {
                "decisions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": [
                            "engineeringRuleId",
                            "decision",
                            "reasonCode",
                            "basis",
                        ],
                        "properties": {
                            "engineeringRuleId": {"type": "string", "minLength": 1},
                            "decision": {"type": "string", "enum": decision_values},
                            "reasonCode": {"type": "string", "enum": reason_values},
                            "basis": {
                                "type": "array",
                                "items": {"type": "string", "enum": basis_values},
                                "uniqueItems": True,
                            },
                        },
                    },
                }
            },
        }


def _context_audit_kwargs(
    confirmed_context: ConfirmedStructuredBusinessContext,
) -> dict[str, Any]:
    return {
        "interview_context_revision_used": confirmed_context.context_revision,
        "confirmed_statement_refs_used": confirmed_context.confirmed_statement_refs,
        "context_limitations_used": confirmed_context.limitations,
        "source_version_ref": confirmed_context.source_version_ref,
        "pge_version": confirmed_context.pge_version,
        "guidance_version": confirmed_context.guidance_version,
    }
