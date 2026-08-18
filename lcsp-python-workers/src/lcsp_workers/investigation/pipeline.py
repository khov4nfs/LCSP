"""Direct LegalRule -> EngineeringRule -> graph investigation -> rule evaluation runtime."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from lcsp_workers.legal.chromadb_citation_retriever import ChromaDbCitationRetriever
from lcsp_workers.legal.engineering_rules.compiler import EngineeringRuleCompiler
from lcsp_workers.legal.engineering_rules.service import EngineeringRuleService
from lcsp_workers.llm.fallback_client import LLMClientProtocol
from lcsp_workers.platform.api_client import WorkerApiClient
from lcsp_workers.platform.logging import get_logger
from lcsp_workers.scanner.program_graph.models import ProgramEvidenceGraph

from .initial_query_executor import InitialQueryExecutor
from .investigator import LawGuidedInvestigator
from .models import (
    ENGINEERING_EVIDENCE_CLAIM_TYPES,
    ENGINEERING_LIMITATION_CODES,
    EvidenceClaim,
)
from .rule_evaluator import EngineeringRuleEvaluation, EngineeringRuleEvaluator


logger = get_logger(__name__)


@dataclass(frozen=True)
class EngineeringInvestigationResult:
    """Canonical direct assessment output produced from the Program Evidence Graph."""

    status: str
    legal_rule_catalog_version_id: str
    legal_corpus_version_id: str
    rules_considered: int
    engineering_rules_executed: int
    engineering_rule_cache_hits: int
    claims: tuple[EvidenceClaim, ...] = ()
    evaluations: tuple[EngineeringRuleEvaluation, ...] = ()
    limitations: tuple[str, ...] = ()

    def to_assessment_data(self) -> dict[str, Any]:
        evaluations = [evaluation.to_dict() for evaluation in self.evaluations]
        return {
            "mode": "ENGINEERING_RULE_EVALUATION",
            "status": self.status,
            "legal_rule_catalog_version_id": self.legal_rule_catalog_version_id,
            "legal_corpus_version_id": self.legal_corpus_version_id,
            "rules_considered": self.rules_considered,
            "engineering_rules_executed": self.engineering_rules_executed,
            "engineering_rule_cache_hits": self.engineering_rule_cache_hits,
            "summary": {
                "compliant": sum(
                    1 for item in self.evaluations if item.status == "COMPLIANT"
                ),
                "non_compliant": sum(
                    1 for item in self.evaluations if item.status == "NON_COMPLIANT"
                ),
                "unknown": sum(
                    1 for item in self.evaluations if item.status == "UNKNOWN"
                ),
                "total": len(self.evaluations),
            },
            "evaluations": evaluations,
            "claims": [claim.to_dict() for claim in self.claims],
            "limitations": list(self.limitations),
        }

    # Compatibility for any tests/readers still calling the old method name. The
    # payload is no longer persisted as TechnicalProfile data.
    def to_profile_data(self) -> dict[str, Any]:
        return self.to_assessment_data()


class EngineeringInvestigationPipeline:
    """Own the direct repository compliance investigation lifecycle in Python.

    Legal chunks and approved LegalRule identities are used only to compile/cache
    EngineeringRules. EngineeringRules guide Program Evidence Graph investigation;
    deterministic evaluation then emits COMPLIANT/NON_COMPLIANT/UNKNOWN outcomes.
    No TechnicalProfile, AIUsageFlow, VerifiedProfile, or LegalRuleMatch is required.
    """

    def __init__(
        self,
        *,
        api_client: WorkerApiClient,
        llm_client: LLMClientProtocol,
        retriever: ChromaDbCitationRetriever | None = None,
        rule_service: EngineeringRuleService | None = None,
        query_executor: InitialQueryExecutor | None = None,
        investigator: LawGuidedInvestigator | None = None,
        evaluator: EngineeringRuleEvaluator | None = None,
    ) -> None:
        self._api_client = api_client
        self._retriever = retriever or ChromaDbCitationRetriever()
        self._rule_service = rule_service or EngineeringRuleService(
            compiler=EngineeringRuleCompiler(llm_client),
            retriever=self._retriever,
        )
        self._query_executor = query_executor or InitialQueryExecutor()
        self._investigator = investigator or LawGuidedInvestigator(llm_client)
        self._evaluator = evaluator or EngineeringRuleEvaluator()

    def run(
        self,
        *,
        evidence_report: dict[str, Any],
        workflow_run_id: str,
        correlation_id: str | None = None,
        wizard_context: dict[str, Any] | None = None,
    ) -> EngineeringInvestigationResult:
        graph = self._graph(evidence_report)
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
        claims: list[EvidenceClaim] = []
        evaluations: list[EngineeringRuleEvaluation] = []
        limitations: list[str] = []
        executed = 0
        cache_hits = 0

        if not rules:
            return EngineeringInvestigationResult(
                status="BLOCKED",
                legal_rule_catalog_version_id=catalog_version_id,
                legal_corpus_version_id=corpus_version_id,
                rules_considered=0,
                engineering_rules_executed=0,
                engineering_rule_cache_hits=0,
                limitations=(
                    ENGINEERING_LIMITATION_CODES[
                        "no_engineering_rule_source_rules"
                    ],
                ),
            )

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
                    ENGINEERING_LIMITATION_CODES[
                        "engineering_rule_compilation_failed"
                    ]
                )
                continue

            for engineering_rule in engineering_rules:
                packet = self._query_executor.execute(
                    engineering_rule,
                    graph,
                    wizard_context=wizard_context,
                )
                try:
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
                        ENGINEERING_LIMITATION_CODES[
                            "engineering_investigation_failed"
                        ]
                    )

                claims.extend(rule_claims)
                evaluations.append(
                    self._evaluator.evaluate(engineering_rule, rule_claims)
                )
                executed += 1

        status = "COMPLETE"
        if not evaluations:
            status = "BLOCKED"
        elif limitations or any(item.status == "UNKNOWN" for item in evaluations):
            status = "PARTIAL"

        return EngineeringInvestigationResult(
            status=status,
            legal_rule_catalog_version_id=catalog_version_id,
            legal_corpus_version_id=corpus_version_id,
            rules_considered=len(rules),
            engineering_rules_executed=executed,
            engineering_rule_cache_hits=cache_hits,
            claims=tuple(claims),
            evaluations=tuple(evaluations),
            limitations=tuple(dict.fromkeys(limitations)),
        )

    @staticmethod
    def _graph(evidence_report: dict[str, Any]) -> ProgramEvidenceGraph:
        payload = evidence_report.get("evidence_payload") or evidence_report.get(
            "evidencePayload"
        )
        if not isinstance(payload, dict):
            raise ValueError("technical evidence report has no evidence payload")
        graph_payload = payload.get("evidence_graph") or payload.get("evidenceGraph")
        if not isinstance(graph_payload, dict):
            raise ValueError("technical evidence report has no Program Evidence Graph")
        graph = ProgramEvidenceGraph.from_dict(graph_payload)
        if not graph.graph_id or not graph.graph_hash:
            raise ValueError("Program Evidence Graph provenance is incomplete")
        return graph

    @staticmethod
    def _required_id(
        payload: dict[str, Any],
        *keys: str,
        label: str,
    ) -> str:
        for key in keys:
            value = payload.get(key)
            if value:
                return str(value)
        raise ValueError(f"missing {label}")

    @staticmethod
    def _is_approved_rule(rule: dict[str, Any]) -> bool:
        status = str(
            rule.get("status")
            or rule.get("lifecycleState")
            or rule.get("lifecycle_state")
            or ""
        ).upper()
        return status in {"", "ACTIVE", "APPROVED", "PUBLISHED"}
