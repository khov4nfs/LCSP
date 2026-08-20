"""Planner-gated direct EngineeringRule investigation runtime."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from lcsp_workers.llm.fallback_client import LLMClientProtocol
from lcsp_workers.platform.logging import get_logger
from lcsp_workers.scanner.program_graph.source_roles import filter_program_evidence_graph

from .code_context import CodeContextSession
from .code_context_investigator import CodeContextLawGuidedInvestigator
from .deterministic_investigator import DeterministicCodeContextLawGuidedInvestigator
from .engineering_rule_planner import EngineeringRulePlanner
from .material_scope import material_planning_packet
from .models import (
    ENGINEERING_EVIDENCE_CLAIM_TYPES,
    ENGINEERING_LIMITATION_CODES,
    EvidenceClaim,
)
from .pipeline import EngineeringInvestigationPipeline, EngineeringInvestigationResult
from .plan_audit_result import PlannedEngineeringInvestigationResult
from .planning_scope import (
    ScopedEngineeringRulePlanningCandidate,
    ScopedMaterialEngineeringRulePlanner,
)
from .selected_rule_orchestration import augment_selected_rule_packet


logger = get_logger(__name__)


class PlannedEngineeringInvestigationPipeline(EngineeringInvestigationPipeline):
    """Plan once, validate deterministically, then investigate selected rules only."""

    def __init__(
        self,
        *,
        api_client,
        llm_client: LLMClientProtocol,
        retriever=None,
        rule_service=None,
        query_executor=None,
        investigator=None,
        evaluator=None,
        planner: EngineeringRulePlanner | None = None,
    ) -> None:
        super().__init__(
            api_client=api_client,
            llm_client=llm_client,
            retriever=retriever,
            rule_service=rule_service,
            query_executor=query_executor,
            investigator=(
                investigator or DeterministicCodeContextLawGuidedInvestigator(llm_client)
            ),
            evaluator=evaluator,
        )
        self._planner = planner or ScopedMaterialEngineeringRulePlanner(llm_client)

    def run(
        self,
        *,
        evidence_report: dict[str, Any],
        workflow_run_id: str,
        correlation_id: str | None = None,
        wizard_context: dict[str, Any] | None = None,
        workspace_path: str | Path | None = None,
    ) -> EngineeringInvestigationResult:
        raw_graph = self._graph(evidence_report)
        graph = filter_program_evidence_graph(raw_graph)
        if graph.node_count != raw_graph.node_count:
            logger.info(
                "ENGINEERING_TEST_SOURCES_FILTERED",
                removed_node_count=raw_graph.node_count - graph.node_count,
                remaining_node_count=graph.node_count,
                workflow_run_id=workflow_run_id,
                correlationId=correlation_id,
            )

        # CodeContextSession is built only after the runtime graph has been cleaned,
        # so search_code/repo_map/get_symbol/get_code cannot surface test/spec symbols
        # even when a classification rerun references an older persisted graph.
        code_context = CodeContextSession(graph, workspace_path=workspace_path)
        catalog = self._api_client.get_active_legal_rule_catalog()
        corpus = self._api_client.get_active_legal_corpus()
        catalog_version_id = self._required_id(
            catalog,
            "versionId",
            "version_id",
            "id",
            label="legal rule catalog version",
        )
        corpus_version_id = self._required_id(
            corpus,
            "versionId",
            "version_id",
            "corpusVersionId",
            "corpus_version_id",
            "id",
            label="legal corpus version",
        )
        corpus_index = self._api_client.get_legal_corpus_chunks(corpus_version_id)
        chunks = corpus_index.get("chunks") or []
        if not isinstance(chunks, list):
            raise ValueError("active legal corpus chunks are invalid")
        self._retriever.index_corpus(
            corpus_version_id,
            [item for item in chunks if isinstance(item, dict)],
        )

        rules = [
            rule
            for rule in (catalog.get("rules") or [])
            if isinstance(rule, dict) and self._is_approved_rule(rule)
        ]
        if not rules:
            return EngineeringInvestigationResult(
                status="BLOCKED",
                legal_rule_catalog_version_id=catalog_version_id,
                legal_corpus_version_id=corpus_version_id,
                rules_considered=0,
                engineering_rules_executed=0,
                engineering_rule_cache_hits=0,
                limitations=(
                    ENGINEERING_LIMITATION_CODES["no_engineering_rule_source_rules"],
                ),
            )

        limitations: list[str] = []
        cache_hits = 0
        prepared: list[tuple[Any, Any]] = []

        # Materialize/cache governed EngineeringRule contracts and run deterministic
        # seed queries against the test-free runtime graph before planning.
        for rule in rules:
            legal_rule_id = str(
                rule.get("legalRuleId")
                or rule.get("legal_rule_id")
                or rule.get("id")
                or "unknown"
            )
            try:
                engineering_rules, cache_hit = self._rule_service.get_or_compile(
                    legal_rule=rule,
                    legal_rule_catalog_version_id=catalog_version_id,
                    legal_corpus_version_id=corpus_version_id,
                    workflow_run_id=workflow_run_id,
                    correlation_id=correlation_id,
                )
                if cache_hit:
                    cache_hits += 1
            except Exception as error:
                logger.warning(
                    "ENGINEERING_RULE_COMPILATION_FAILED",
                    legal_rule_id=legal_rule_id,
                    error_type=type(error).__name__,
                    workflow_run_id=workflow_run_id,
                    correlationId=correlation_id,
                )
                limitations.append(
                    ENGINEERING_LIMITATION_CODES["engineering_rule_compilation_failed"]
                )
                continue

            for engineering_rule in engineering_rules:
                packet = self._query_executor.execute(
                    engineering_rule,
                    graph,
                    wizard_context=wizard_context,
                )
                prepared.append((engineering_rule, packet))

        if not prepared:
            return EngineeringInvestigationResult(
                status="BLOCKED",
                legal_rule_catalog_version_id=catalog_version_id,
                legal_corpus_version_id=corpus_version_id,
                rules_considered=len(rules),
                engineering_rules_executed=0,
                engineering_rule_cache_hits=cache_hits,
                limitations=tuple(dict.fromkeys(limitations)),
            )

        # Planner does not receive every broad start-node hit. Each packet is projected
        # into rule-specific material production signals first; the original packet is
        # retained for the investigator after the rule passes the plan gate. Coverage is
        # also derived from that material packet, never inherited from graph-global LIMITED.
        candidates = tuple(
            ScopedEngineeringRulePlanningCandidate.from_rule_packet(
                rule,
                material_planning_packet(rule, packet),
            )
            for rule, packet in prepared
        )
        plan = self._planner.plan(
            candidates=candidates,
            wizard_context=wizard_context,
            graph=graph,
            workflow_run_id=workflow_run_id,
            correlation_id=correlation_id,
        )
        selected_ids = set(plan.selected_rule_ids)
        logger.info(
            "ENGINEERING_RULE_PLAN_APPLIED",
            candidate_count=len(candidates),
            selected_count=len(selected_ids),
            skipped_count=len(plan.skipped_rule_ids),
            fallback_used=plan.fallback_used,
            selected_rule_ids=sorted(selected_ids),
            workflow_run_id=workflow_run_id,
            correlationId=correlation_id,
        )

        # P0 observability: persist and log one decision row per EngineeringRule. This
        # answers not only which rules were SELECTed, but whether SELECT came from the
        # model, a deterministic fail-closed override, material source evidence, Wizard
        # scope, or scoped uncertainty. This metadata is investigation-scope diagnostics,
        # never legal applicability/risk/compliance authority.
        candidate_by_id = {
            candidate.engineering_rule_id: candidate for candidate in candidates
        }
        planner_decisions: list[dict[str, Any]] = []
        for audit in plan.decision_audit:
            candidate = candidate_by_id.get(audit.engineering_rule_id)
            decision_row = {
                "engineering_rule_id": audit.engineering_rule_id,
                "requested_decision": audit.requested_decision,
                "final_decision": audit.final_decision,
                "reason_code": audit.reason_code,
                "basis": list(audit.basis),
                "validation_override": audit.validation_override,
                "material_source_hit_count": (
                    candidate.source_hit_count if candidate is not None else 0
                ),
                "material_source_evidence_count": (
                    candidate.source_evidence_count if candidate is not None else 0
                ),
                "material_source_node_types": (
                    list(candidate.source_node_types) if candidate is not None else []
                ),
                "scope_coverage_state": (
                    candidate.scope_coverage_state if candidate is not None else "UNKNOWN"
                ),
                "scoped_truncated_query_count": (
                    candidate.scoped_truncated_query_count if candidate is not None else 0
                ),
                "scoped_unresolved_frontier_count": (
                    candidate.scoped_unresolved_frontier_count
                    if candidate is not None
                    else 0
                ),
            }
            planner_decisions.append(decision_row)
            logger.info(
                "ENGINEERING_RULE_PLAN_DECISION",
                **decision_row,
                workflow_run_id=workflow_run_id,
                correlationId=correlation_id,
            )

        claims: list[EvidenceClaim] = []
        evaluations = []
        technical_evidence_by_rule: dict[str, tuple[dict[str, Any], ...]] = {}
        executed = 0

        for engineering_rule, packet in prepared:
            if engineering_rule.engineering_rule_id not in selected_ids:
                continue

            # P1 deterministic orchestration: only selected rules receive a few bounded
            # contract-owned graph traces before the first LLM turn. This reduces model
            # tool retries/invalid ref calls and gives the model enough concrete topology
            # to finish naturally without restoring the old eager fan-out.
            packet = augment_selected_rule_packet(
                packet,
                graph,
                workflow_run_id=workflow_run_id,
                correlation_id=correlation_id,
            )
            try:
                if isinstance(self._investigator, CodeContextLawGuidedInvestigator):
                    rule_claims = self._investigator.investigate(
                        packet=packet,
                        graph=graph,
                        workflow_run_id=workflow_run_id,
                        correlation_id=correlation_id,
                        code_context=code_context,
                    )
                else:
                    rule_claims = self._investigator.investigate(
                        packet=packet,
                        graph=graph,
                        workflow_run_id=workflow_run_id,
                        correlation_id=correlation_id,
                    )
            except Exception as error:
                logger.warning(
                    "ENGINEERING_INVESTIGATION_FAILED",
                    engineering_rule_id=engineering_rule.engineering_rule_id,
                    error_type=type(error).__name__,
                    workflow_run_id=workflow_run_id,
                    correlationId=correlation_id,
                )
                rule_claims = [
                    EvidenceClaim(
                        claim_id=f"claim:failed:{engineering_rule.engineering_rule_id}",
                        engineering_rule_id=engineering_rule.engineering_rule_id,
                        claim_type=ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"],
                        value=None,
                        evidence_refs=tuple(packet.evidence_refs),
                        confidence=0.0,
                        limitations=(
                            ENGINEERING_LIMITATION_CODES[
                                "engineering_investigation_failed"
                            ],
                        ),
                    )
                ]
                limitations.append(
                    ENGINEERING_LIMITATION_CODES["engineering_investigation_failed"]
                )

            claims.extend(rule_claims)
            evaluation = self._evaluator.evaluate(engineering_rule, rule_claims)
            evaluations.append(evaluation)
            technical_evidence_by_rule[evaluation.engineering_rule_id] = tuple(
                self._technical_evidence_displays(graph, evaluation.evidence_refs)
            )
            executed += 1

        status = "COMPLETE"
        if not evaluations:
            status = "BLOCKED"
        elif limitations:
            status = "PARTIAL"

        return PlannedEngineeringInvestigationResult(
            status=status,
            legal_rule_catalog_version_id=catalog_version_id,
            legal_corpus_version_id=corpus_version_id,
            rules_considered=len(rules),
            engineering_rules_executed=executed,
            engineering_rule_cache_hits=cache_hits,
            claims=tuple(claims),
            evaluations=tuple(evaluations),
            limitations=tuple(dict.fromkeys(limitations)),
            technical_evidence_by_rule=technical_evidence_by_rule,
            planner_fallback_used=plan.fallback_used,
            planner_decisions=tuple(planner_decisions),
        )
