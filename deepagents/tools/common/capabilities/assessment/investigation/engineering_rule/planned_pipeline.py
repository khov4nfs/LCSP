"""Planner-gated direct EngineeringRule investigation runtime."""
from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

from model_policy import INVESTIGATOR_MODEL_SPEC, PLANNER_MODEL_SPEC
from tools.common.capabilities.platform.logging import get_logger
from tools.common.capabilities.evidence.graph.schema.source_roles import filter_program_evidence_graph

from tools.common.capabilities.assessment.investigation.engineering_rule.code_context import CodeContextSession
from tools.common.capabilities.assessment.investigation.engineering_rule.code_context_investigator import CodeContextLawGuidedInvestigator
from tools.common.capabilities.assessment.investigation.engineering_rule.deterministic_investigator import DeterministicCodeContextLawGuidedInvestigator
from tools.common.capabilities.assessment.planning.engineering_rule.confirmed_business_context import (
    ConfirmedStructuredBusinessContext,
    coerce_confirmed_structured_business_context,
)
from tools.common.capabilities.assessment.planning.engineering_rule.engineering_rule_planner import (
    EngineeringRulePlan,
    EngineeringRulePlanDecisionAudit,
    EngineeringRulePlanner,
)
from tools.common.capabilities.assessment.planning.engineering_rule.material_scope import material_planning_packet
from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_EVIDENCE_CLAIM_TYPES,
    ENGINEERING_LIMITATION_CODES,
    EvidenceClaim,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.openwiki_context import OpenWikiContextProvider, OpenWikiContextRequiredError
from .pipeline import EngineeringInvestigationPipeline, EngineeringInvestigationResult
from tools.common.capabilities.assessment.planning.engineering_rule.plan_audit_result import PlannedEngineeringInvestigationResult
from tools.common.capabilities.assessment.planning.engineering_rule.planning_business_scope import (
    BusinessAwareScopedEngineeringRulePlanningCandidate,
    BusinessAwareScopedMaterialEngineeringRulePlanner,
    RulePlanningBusinessScopeProjector,
)
from .selected_rule_orchestration import augment_selected_rule_packet


logger = get_logger(__name__)

LEGAL_RULE_ONLY_RECOVERY_REASONS = frozenset(
    {
        "LEGAL_RULE_SOURCE_LOAD_FAILED",
        "NO_ACTIVE_LEGAL_RULE_CATALOG",
        "NO_APPROVED_ENGINEERING_RULE_SOURCE_RULES",
    }
)


class PlannedEngineeringInvestigationPipeline(EngineeringInvestigationPipeline):
    """Plan once, validate deterministically, then investigate selected rules only."""

    def __init__(
        self,
        *,
        api_client,
        model: str = INVESTIGATOR_MODEL_SPEC,
        planner_model: str = PLANNER_MODEL_SPEC,
        retriever=None,
        rule_service=None,
        query_executor=None,
        investigator=None,
        evaluator=None,
        planner: EngineeringRulePlanner | None = None,
        corpus_recovery_driver=None,
    ) -> None:
        super().__init__(
            api_client=api_client,
            model=model,
            compiler_model=planner_model,
            retriever=retriever,
            rule_service=rule_service,
            query_executor=query_executor,
            investigator=(
                investigator or DeterministicCodeContextLawGuidedInvestigator(model)
            ),
            evaluator=evaluator,
        )
        self._planner = planner or BusinessAwareScopedMaterialEngineeringRulePlanner(
            planner_model
        )
        self._corpus_recovery_driver = corpus_recovery_driver

    def run(
        self,
        *,
        evidence_report: dict[str, Any],
        workflow_run_id: str,
        correlation_id: str | None = None,
        confirmed_customer_context: ConfirmedStructuredBusinessContext
        | dict[str, Any]
        | None = None,
        workspace_path: str | Path | None = None,
        recovery_source_crawl_requests: list[dict[str, Any]] | None = None,
        assessment_id: str | None = None,
        user_id: str | None = None,
    ) -> EngineeringInvestigationResult:
        try:
            confirmed_context = coerce_confirmed_structured_business_context(
                confirmed_customer_context
            )
        except ValueError as error:
            logger.warning(
                "PLANNER_CONFIRMED_STRUCTURED_CONTEXT_REQUIRED",
                reason=str(error),
                workflow_run_id=workflow_run_id,
                correlationId=correlation_id,
            )
            return self._blocked_before_llm(
                catalog_version_id="",
                corpus_version_id="",
                rules_considered=0,
                cache_hits=0,
                limitations=("CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_REQUIRED",),
                reason="CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_REQUIRED",
                workflow_run_id=workflow_run_id,
                correlation_id=correlation_id,
            )

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
        (
            catalog_version_id,
            corpus_version_id,
            corpus_chunks,
            rules,
        ) = self._load_or_recover_legal_rule_sources(
            workflow_run_id=workflow_run_id,
            correlation_id=correlation_id,
            reason="LEGAL_RULE_SOURCE_LOAD_FAILED",
            source_crawl_requests=recovery_source_crawl_requests,
        )
        if not catalog_version_id:
            return self._blocked_before_llm(
                catalog_version_id=catalog_version_id,
                corpus_version_id=corpus_version_id,
                rules_considered=0,
                cache_hits=0,
                limitations=[
                    ENGINEERING_LIMITATION_CODES["no_legal_rule_catalog"],
                ],
                reason="NO_ACTIVE_LEGAL_RULE_CATALOG",
                workflow_run_id=workflow_run_id,
                correlation_id=correlation_id,
            )
        if not corpus_version_id or not corpus_chunks:
            recovered = self._recover_legal_rule_sources(
                workflow_run_id=workflow_run_id,
                correlation_id=correlation_id,
                reason="NO_ACTIVE_LEGAL_CORPUS_SOURCE",
                source_crawl_requests=recovery_source_crawl_requests,
            )
            if recovered:
                (
                    catalog_version_id,
                    corpus_version_id,
                    corpus_chunks,
                    rules,
                ) = self._reload_legal_rule_sources(
                    workflow_run_id=workflow_run_id,
                    correlation_id=correlation_id,
                    reason="NO_ACTIVE_LEGAL_CORPUS_SOURCE",
                )
        if not corpus_version_id or not corpus_chunks:
            return self._blocked_before_llm(
                catalog_version_id=catalog_version_id,
                corpus_version_id=corpus_version_id,
                rules_considered=0,
                cache_hits=0,
                limitations=[
                    ENGINEERING_LIMITATION_CODES["no_legal_corpus_source"],
                ],
                reason="NO_ACTIVE_LEGAL_CORPUS_SOURCE",
                workflow_run_id=workflow_run_id,
                correlation_id=correlation_id,
            )
        if not rules:
            recovered = self._recover_legal_rule_sources(
                workflow_run_id=workflow_run_id,
                correlation_id=correlation_id,
                reason="NO_APPROVED_ENGINEERING_RULE_SOURCE_RULES",
                source_crawl_requests=recovery_source_crawl_requests,
            )
            if recovered:
                (
                    catalog_version_id,
                    corpus_version_id,
                    corpus_chunks,
                    rules,
                ) = self._reload_legal_rule_sources(
                    workflow_run_id=workflow_run_id,
                    correlation_id=correlation_id,
                    reason="NO_APPROVED_ENGINEERING_RULE_SOURCE_RULES",
                )
        if not rules:
            return self._waiting_before_llm(
                catalog_version_id=catalog_version_id,
                corpus_version_id=corpus_version_id,
                rules_considered=0,
                cache_hits=0,
                limitations=(
                    ENGINEERING_LIMITATION_CODES["no_engineering_rule_source_rules"],
                ),
                reason="NO_APPROVED_ENGINEERING_RULE_SOURCE_RULES",
                workflow_run_id=workflow_run_id,
                correlation_id=correlation_id,
            )

        (
            limitations,
            cache_hits,
            prepared,
            preparation_observability,
        ) = self._prepare_engineering_rules(
            rules=rules,
            catalog_version_id=catalog_version_id,
            corpus_version_id=corpus_version_id,
            graph=graph,
            confirmed_customer_context=confirmed_context,
            workflow_run_id=workflow_run_id,
            correlation_id=correlation_id,
        )

        if not prepared:
            recovered = self._recover_legal_rule_sources(
                workflow_run_id=workflow_run_id,
                correlation_id=correlation_id,
                reason="NO_ENGINEERING_RULE_CANDIDATES_AFTER_TRIAGE",
                source_crawl_requests=recovery_source_crawl_requests,
            )
            if recovered:
                (
                    catalog_version_id,
                    corpus_version_id,
                    corpus_chunks,
                    rules,
                ) = self._reload_legal_rule_sources(
                    workflow_run_id=workflow_run_id,
                    correlation_id=correlation_id,
                    reason="NO_ENGINEERING_RULE_CANDIDATES_AFTER_TRIAGE",
                )
                if not corpus_version_id or not corpus_chunks or not rules:
                    if corpus_version_id and corpus_chunks and not rules:
                        return self._waiting_before_llm(
                            catalog_version_id=catalog_version_id,
                            corpus_version_id=corpus_version_id,
                            rules_considered=len(rules),
                            cache_hits=cache_hits,
                            limitations=tuple(
                                dict.fromkeys(
                                    [
                                        *limitations,
                                        ENGINEERING_LIMITATION_CODES[
                                            "no_engineering_rule_source_rules"
                                        ],
                                    ]
                                )
                            ),
                            reason="ENGINEERING_RULE_SOURCE_RECOVERY_INCOMPLETE",
                            workflow_run_id=workflow_run_id,
                            correlation_id=correlation_id,
                        )
                    return self._blocked_before_llm(
                        catalog_version_id=catalog_version_id,
                        corpus_version_id=corpus_version_id,
                        rules_considered=len(rules),
                        cache_hits=cache_hits,
                        limitations=tuple(
                            dict.fromkeys(
                                [
                                    *limitations,
                                    (
                                        ENGINEERING_LIMITATION_CODES[
                                            "no_legal_corpus_source"
                                        ]
                                        if not corpus_version_id or not corpus_chunks
                                        else ENGINEERING_LIMITATION_CODES[
                                            "no_engineering_rule_source_rules"
                                        ]
                                    ),
                                ]
                            )
                        ),
                        reason="ENGINEERING_RULE_SOURCE_RECOVERY_INCOMPLETE",
                        workflow_run_id=workflow_run_id,
                        correlation_id=correlation_id,
                    )
                (
                    limitations,
                    cache_hits,
                    prepared,
                    preparation_observability,
                ) = self._prepare_engineering_rules(
                    rules=rules,
                    catalog_version_id=catalog_version_id,
                    corpus_version_id=corpus_version_id,
                    graph=graph,
                    confirmed_customer_context=confirmed_context,
                    workflow_run_id=workflow_run_id,
                    correlation_id=correlation_id,
                )

        if not prepared:
            return self._blocked_before_llm(
                catalog_version_id=catalog_version_id,
                corpus_version_id=corpus_version_id,
                rules_considered=len(rules),
                cache_hits=cache_hits,
                limitations=tuple(
                    dict.fromkeys(
                        [
                            *limitations,
                            ENGINEERING_LIMITATION_CODES[
                                "no_engineering_rule_candidates"
                            ],
                        ]
                    )
                ),
                reason="NO_ENGINEERING_RULE_CANDIDATES_AFTER_TRIAGE",
                workflow_run_id=workflow_run_id,
                correlation_id=correlation_id,
                observability=preparation_observability,
            )

        return self._run_planned_investigation(
            graph=graph,
            code_context=code_context,
            rules=rules,
            prepared=prepared,
            preparation_observability=preparation_observability,
            limitations=limitations,
            cache_hits=cache_hits,
            catalog_version_id=catalog_version_id,
            corpus_version_id=corpus_version_id,
            workflow_run_id=workflow_run_id,
            correlation_id=correlation_id,
            confirmed_customer_context=confirmed_context,
            workspace_path=workspace_path,
            evidence_report=evidence_report,
            assessment_id=assessment_id,
            user_id=user_id,
        )

    def _run_planned_investigation(
        self,
        *,
        graph,
        code_context: CodeContextSession,
        rules: list[dict[str, Any]],
        prepared: list[tuple[Any, Any]],
        preparation_observability: dict[str, Any],
        limitations: list[str],
        cache_hits: int,
        catalog_version_id: str,
        corpus_version_id: str,
        workflow_run_id: str,
        correlation_id: str | None,
        confirmed_customer_context: ConfirmedStructuredBusinessContext,
        workspace_path: str | Path | None,
        evidence_report: dict[str, Any],
        assessment_id: str | None,
        user_id: str | None,
    ) -> EngineeringInvestigationResult:
        # Planner does not receive every broad start-node hit. Each packet is projected
        # into rule-specific material production signals first. A single graph projector
        # then expands only those material seeds through bounded executable/business/data
        # edges so the Planner receives concrete business process/subject/capability/
        # decision context rather than only hit counts and node-type names. The original
        # packet is retained for the investigator after the rule passes the plan gate.
        material_prepared = tuple(
            (rule, material_planning_packet(rule, packet)) for rule, packet in prepared
        )
        business_scope_projector = RulePlanningBusinessScopeProjector(graph)
        candidates = tuple(
            BusinessAwareScopedEngineeringRulePlanningCandidate.from_rule_packet(
                rule,
                material_packet,
                business_scope_projector,
            )
            for rule, material_packet in material_prepared
        )
        observability = {
            **dict(preparation_observability),
            "candidate_source_hit_distribution": self._candidate_source_hit_distribution(
                candidates
            ),
        }
        try:
            openwiki_context = OpenWikiContextProvider(
                workspace_path or Path.cwd()
            ).collect_required_for_candidates(candidates)
            observability["openwiki"] = {
                "available": True,
                "hint_count": int(openwiki_context.get("hintCount") or 0),
                "authority": str(openwiki_context.get("authority") or ""),
            }
            logger.info(
                "OPENWIKI_PLANNER_HINTS_READY",
                hint_count=openwiki_context.get("hintCount", 0),
                authority=openwiki_context.get("authority"),
                workflow_run_id=workflow_run_id,
                correlationId=correlation_id,
            )
            plan = self._planner.plan(
                candidates=candidates,
                confirmed_customer_context=confirmed_customer_context,
                graph=graph,
                workflow_run_id=workflow_run_id,
                correlation_id=correlation_id,
                openwiki_context=openwiki_context,
            )
        except OpenWikiContextRequiredError as error:
            observability["openwiki"] = {
                "available": False,
                "error": str(error),
                "fallback": "OPENWIKI_REQUIRED_FALLBACK_ALL",
            }
            logger.warning(
                "OPENWIKI_PLANNER_HINTS_REQUIRED_FALLBACK_ALL",
                reason=str(error),
                candidate_count=len(candidates),
                workflow_run_id=workflow_run_id,
                correlationId=correlation_id,
            )
            plan = EngineeringRulePlan(
                selected_rule_ids=tuple(
                    candidate.engineering_rule_id for candidate in candidates
                ),
                skipped_rule_ids=(),
                fallback_used=True,
                decision_audit=tuple(
                    EngineeringRulePlanDecisionAudit(
                        engineering_rule_id=candidate.engineering_rule_id,
                        requested_decision="FALLBACK",
                        final_decision="SELECT",
                        reason_code="OPENWIKI_REQUIRED_CONTEXT_UNAVAILABLE",
                        basis=(),
                        validation_override="OPENWIKI_REQUIRED_FALLBACK_ALL",
                        interview_context_revision_used=(
                            confirmed_customer_context.context_revision
                        ),
                        confirmed_statement_refs_used=(
                            confirmed_customer_context.confirmed_statement_refs
                        ),
                        context_limitations_used=confirmed_customer_context.limitations,
                        source_version_ref=confirmed_customer_context.source_version_ref,
                        pge_version=confirmed_customer_context.pge_version,
                        guidance_version=confirmed_customer_context.guidance_version,
                    )
                    for candidate in candidates
                ),
            )

        # Existing implementation continues below in this helper.
        return self._finish_planned_investigation(
            graph=graph,
            code_context=code_context,
            prepared=prepared,
            candidates=candidates,
            plan=plan,
            limitations=limitations,
            cache_hits=cache_hits,
            catalog_version_id=catalog_version_id,
            corpus_version_id=corpus_version_id,
            rules=rules,
            workflow_run_id=workflow_run_id,
            correlation_id=correlation_id,
            observability=observability,
            evidence_report=evidence_report,
            assessment_id=assessment_id,
            user_id=user_id,
        )

    def _finish_planned_investigation(
        self,
        *,
        graph,
        code_context: CodeContextSession,
        prepared: list[tuple[Any, Any]],
        candidates: tuple[Any, ...],
        plan: EngineeringRulePlan,
        limitations: list[str],
        cache_hits: int,
        catalog_version_id: str,
        corpus_version_id: str,
        rules: list[dict[str, Any]],
        workflow_run_id: str,
        correlation_id: str | None,
        observability: dict[str, Any],
        evidence_report: dict[str, Any],
        assessment_id: str | None,
        user_id: str | None,
    ) -> EngineeringInvestigationResult:
        selected_ids = set(plan.selected_rule_ids)
        context_provenance = dict(plan.context_provenance)
        observability = {
            **dict(observability),
            "planner_context_provenance": context_provenance,
            "planner_decision_distribution": {
                "final_decision_counts": dict(
                    Counter(item.final_decision for item in plan.decision_audit)
                ),
                "reason_code_counts": dict(
                    Counter(item.reason_code for item in plan.decision_audit)
                ),
                "validation_override_counts": dict(
                    Counter(
                        item.validation_override
                        for item in plan.decision_audit
                        if item.validation_override
                    )
                ),
            },
        }
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
        # model, a deterministic fail-closed override, material source evidence,
        # confirmed customer context, scoped uncertainty, or the provenance-gated
        # business scope supplied to the model. This metadata is investigation-scope diagnostics, never legal
        # applicability/risk/compliance authority.
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
                "planning_business_scope": (
                    candidate.planning_business_scope.to_prompt_dict()
                    if candidate is not None
                    else {}
                ),
                "interviewContextRevisionUsed": audit.interview_context_revision_used,
                "confirmedStatementRefsUsed": list(audit.confirmed_statement_refs_used),
                "contextLimitationsUsed": list(audit.context_limitations_used),
                "sourceVersionRef": audit.source_version_ref,
                "pgeVersion": audit.pge_version,
                "guidanceVersion": audit.guidance_version,
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

            validated_rule_claims = self._validated_claims_for_evaluation(
                rule_claims,
                graph,
            )
            claims.extend(validated_rule_claims)
            evaluation = self._evaluator.evaluate(
                engineering_rule,
                validated_rule_claims,
            )
            evaluations.append(evaluation)
            technical_evidence_by_rule[evaluation.engineering_rule_id] = tuple(
                self._technical_evidence_displays(graph, evaluation.evidence_refs)
            )
            self._capture_verified_episode_after_evaluation(
                engineering_rule=engineering_rule,
                claims=validated_rule_claims,
                raw_claim_count=len(rule_claims),
                evaluation=evaluation,
                evidence_report=evidence_report,
                workflow_run_id=workflow_run_id,
                assessment_id=assessment_id,
                user_id=user_id,
                legal_rule_catalog_version_id=catalog_version_id,
                legal_corpus_version_id=corpus_version_id,
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
            observability=observability,
        )

    def _load_legal_rule_sources(
        self,
    ) -> tuple[str, str, list[dict[str, Any]], list[dict[str, Any]]]:
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
        return (
            catalog_version_id,
            corpus_version_id,
            [item for item in chunks if isinstance(item, dict)],
            rules,
        )

    def _load_or_recover_legal_rule_sources(
        self,
        *,
        workflow_run_id: str,
        correlation_id: str | None,
        reason: str,
        source_crawl_requests: list[dict[str, Any]] | None = None,
    ) -> tuple[str, str, list[dict[str, Any]], list[dict[str, Any]]]:
        try:
            return self._load_legal_rule_sources()
        except Exception as error:
            logger.warning(
                "ENGINEERING_RULE_SOURCE_LOAD_FAILED",
                reason=reason,
                error_type=type(error).__name__,
                error_message=str(error)[:500],
                workflow_run_id=workflow_run_id,
                correlationId=correlation_id,
            )
            recovered = self._recover_legal_rule_sources(
                workflow_run_id=workflow_run_id,
                correlation_id=correlation_id,
                reason=reason,
                source_crawl_requests=source_crawl_requests,
            )
            if recovered:
                try:
                    return self._load_legal_rule_sources()
                except Exception as retry_error:
                    logger.warning(
                        "ENGINEERING_RULE_SOURCE_RELOAD_FAILED",
                        reason=reason,
                        error_type=type(retry_error).__name__,
                        error_message=str(retry_error)[:500],
                        workflow_run_id=workflow_run_id,
                        correlationId=correlation_id,
                    )
        return ("", "", [], [])

    def _reload_legal_rule_sources(
        self,
        *,
        workflow_run_id: str,
        correlation_id: str | None,
        reason: str,
    ) -> tuple[str, str, list[dict[str, Any]], list[dict[str, Any]]]:
        try:
            return self._load_legal_rule_sources()
        except Exception as error:
            logger.warning(
                "ENGINEERING_RULE_SOURCE_RELOAD_FAILED",
                reason=reason,
                error_type=type(error).__name__,
                error_message=str(error)[:500],
                workflow_run_id=workflow_run_id,
                correlationId=correlation_id,
            )
            return ("", "", [], [])

    def _blocked_before_llm(
        self,
        *,
        catalog_version_id: str,
        corpus_version_id: str,
        rules_considered: int,
        cache_hits: int,
        limitations: tuple[str, ...] | list[str],
        reason: str,
        workflow_run_id: str,
        correlation_id: str | None,
        observability: dict[str, Any] | None = None,
    ) -> EngineeringInvestigationResult:
        logger.warning(
            "ENGINEERING_INVESTIGATION_STOPPED_BEFORE_PLANNER",
            reason=reason,
            limitations=list(dict.fromkeys(limitations)),
            rules_considered=rules_considered,
            workflow_run_id=workflow_run_id,
            correlationId=correlation_id,
        )
        return EngineeringInvestigationResult(
            status="BLOCKED",
            legal_rule_catalog_version_id=catalog_version_id,
            legal_corpus_version_id=corpus_version_id,
            rules_considered=rules_considered,
            engineering_rules_executed=0,
            engineering_rule_cache_hits=cache_hits,
            limitations=tuple(dict.fromkeys(limitations)),
            observability=dict(observability or {}),
        )

    def _waiting_before_llm(
        self,
        *,
        catalog_version_id: str,
        corpus_version_id: str,
        rules_considered: int,
        cache_hits: int,
        limitations: tuple[str, ...] | list[str],
        reason: str,
        workflow_run_id: str,
        correlation_id: str | None,
        observability: dict[str, Any] | None = None,
    ) -> EngineeringInvestigationResult:
        logger.warning(
            "ENGINEERING_INVESTIGATION_WAITING_FOR_RULE_SOURCE_REBUILD",
            reason=reason,
            limitations=list(dict.fromkeys(limitations)),
            rules_considered=rules_considered,
            workflow_run_id=workflow_run_id,
            correlationId=correlation_id,
        )
        return EngineeringInvestigationResult(
            status="WAITING",
            legal_rule_catalog_version_id=catalog_version_id,
            legal_corpus_version_id=corpus_version_id,
            rules_considered=rules_considered,
            engineering_rules_executed=0,
            engineering_rule_cache_hits=cache_hits,
            limitations=tuple(dict.fromkeys(limitations)),
            observability=dict(observability or {}),
        )

    def _prepare_engineering_rules(
        self,
        *,
        rules: list[dict[str, Any]],
        catalog_version_id: str,
        corpus_version_id: str,
        graph,
        confirmed_customer_context: ConfirmedStructuredBusinessContext,
        workflow_run_id: str,
        correlation_id: str | None,
    ) -> tuple[list[str], int, list[tuple[Any, Any]], dict[str, Any]]:
        limitations: list[str] = []
        cache_hits = 0
        prepared: list[tuple[Any, Any]] = []
        compile_failures: list[dict[str, Any]] = []
        compile_skipped_legal_rule_ids: list[str] = []
        compiled_rule_counts: list[dict[str, Any]] = []

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
                    error_message=str(error)[:500],
                    workflow_run_id=workflow_run_id,
                    correlationId=correlation_id,
                )
                limitations.append(
                    ENGINEERING_LIMITATION_CODES["engineering_rule_compilation_failed"]
                )
                compile_failures.append(
                    {
                        "legal_rule_id": legal_rule_id,
                        "error_type": type(error).__name__,
                        "error_message": str(error)[:500],
                    }
                )
                continue
            if not engineering_rules:
                compile_skipped_legal_rule_ids.append(legal_rule_id)
            compiled_rule_counts.append(
                {
                    "legal_rule_id": legal_rule_id,
                    "engineering_rule_count": len(engineering_rules),
                    "cache_hit": cache_hit,
                }
            )

            for engineering_rule in engineering_rules:
                packet = self._query_executor.execute(
                    engineering_rule,
                    graph,
                    confirmed_customer_context=(
                        confirmed_customer_context.to_legacy_customer_context()
                    ),
                )
                prepared.append((engineering_rule, packet))

        return limitations, cache_hits, prepared, {
            "engineering_rule_preparation": {
                "legal_rules_seen": len(rules),
                "candidate_count": len(prepared),
                "compile_failed_count": len(compile_failures),
                "compile_failed_legal_rule_ids": [
                    item["legal_rule_id"] for item in compile_failures
                ],
                "compile_failures": compile_failures,
                "compile_skipped_count": len(compile_skipped_legal_rule_ids),
                "compile_skipped_legal_rule_ids": compile_skipped_legal_rule_ids,
                "compiled_engineering_rule_counts": compiled_rule_counts,
            },
        }

    @staticmethod
    def _candidate_source_hit_distribution(
        candidates: tuple[Any, ...],
    ) -> dict[str, Any]:
        hit_buckets: Counter[str] = Counter()
        evidence_buckets: Counter[str] = Counter()
        scope_states: Counter[str] = Counter()
        node_types: Counter[str] = Counter()
        for candidate in candidates:
            hit_buckets[
                PlannedEngineeringInvestigationPipeline._count_bucket(
                    int(getattr(candidate, "source_hit_count", 0) or 0)
                )
            ] += 1
            evidence_buckets[
                PlannedEngineeringInvestigationPipeline._count_bucket(
                    int(getattr(candidate, "source_evidence_count", 0) or 0)
                )
            ] += 1
            scope_states[
                str(getattr(candidate, "scope_coverage_state", "UNKNOWN"))
            ] += 1
            node_types.update(
                str(item)
                for item in getattr(candidate, "source_node_types", ()) or ()
            )
        return {
            "candidate_count": len(candidates),
            "source_hit_count_buckets": dict(sorted(hit_buckets.items())),
            "source_evidence_count_buckets": dict(sorted(evidence_buckets.items())),
            "scope_coverage_counts": dict(sorted(scope_states.items())),
            "source_node_type_counts": dict(node_types.most_common(20)),
        }

    @staticmethod
    def _count_bucket(count: int) -> str:
        if count <= 0:
            return "0"
        if count == 1:
            return "1"
        if count <= 5:
            return "2_5"
        if count <= 20:
            return "6_20"
        return "21_plus"

    def _recover_legal_rule_sources(
        self,
        *,
        workflow_run_id: str,
        correlation_id: str | None,
        reason: str,
        source_crawl_requests: list[dict[str, Any]] | None = None,
    ) -> bool:
        logger.info(
            "ENGINEERING_RULE_SOURCE_RECOVERY_REQUESTED",
            reason=reason,
            workflow_run_id=workflow_run_id,
            correlationId=correlation_id,
        )
        driver = self._corpus_recovery_driver
        if driver is None:
            from tools.legal.sources.recovery.legal_corpus_recovery_driver import (
                LegalCorpusRecoveryDriver,
            )

            driver = LegalCorpusRecoveryDriver(api_client=self._api_client)

        recovery_modes = (
            (True, "legal-rules-only"),
            (False, "corpus-rebuild"),
        ) if reason in LEGAL_RULE_ONLY_RECOVERY_REASONS else (
            (False, "corpus-rebuild"),
        )
        for recover_legal_rules_only, recovery_mode in recovery_modes:
            try:
                payload: dict[str, Any] = {
                    "idempotencyKey": (
                        f"{workflow_run_id}:engineering-rule-source-recovery"
                    ),
                    "maxRuns": 0,
                    "recoverLegalRulesOnly": recover_legal_rules_only,
                }
                if source_crawl_requests:
                    payload["sourceCrawlRequests"] = source_crawl_requests
                response = driver.run(
                    payload,
                    correlation_id or workflow_run_id,
                )
            except Exception as error:
                logger.warning(
                    "ENGINEERING_RULE_SOURCE_RECOVERY_FAILED",
                    reason=reason,
                    recovery_mode=recovery_mode,
                    error_type=type(error).__name__,
                    error_message=str(error)[:500],
                    workflow_run_id=workflow_run_id,
                    correlationId=correlation_id,
                )
                continue
            logger.info(
                "ENGINEERING_RULE_SOURCE_RECOVERY_COMPLETED",
                reason=reason,
                recovery_mode=recovery_mode,
                status=response.get("status") if isinstance(response, dict) else None,
                corpus_version_id=(
                    response.get("corpusVersionId")
                    if isinstance(response, dict)
                    else None
                ),
                workflow_run_id=workflow_run_id,
                correlationId=correlation_id,
            )
            return True
        return False
