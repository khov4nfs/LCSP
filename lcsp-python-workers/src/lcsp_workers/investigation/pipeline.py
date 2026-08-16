"""Production lifecycle owner for LegalRule -> EngineeringRule -> EvidenceClaim investigation."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from lcsp_workers.legal.chromadb_citation_retriever import ChromaDbCitationRetriever
from lcsp_workers.legal.engineering_rules.compiler import EngineeringRuleCompiler
from lcsp_workers.legal.engineering_rules.service import EngineeringRuleService
from lcsp_workers.llm.budget_tracker import BudgetExceeded
from lcsp_workers.llm.fallback_client import LLMClientProtocol
from lcsp_workers.platform.api_client import WorkerApiClient
from lcsp_workers.scanner.program_graph.models import ProgramEvidenceGraph

from .initial_query_executor import InitialQueryExecutor
from .investigator import LawGuidedInvestigator
from .models import EvidenceClaim


@dataclass(frozen=True)
class EngineeringInvestigationResult:
    """Validated, persistence-safe result of one pre-profile engineering investigation."""

    status: str
    legal_rule_catalog_version_id: str
    legal_corpus_version_id: str
    rules_considered: int
    engineering_rules_executed: int
    engineering_rule_cache_hits: int
    claims: tuple[EvidenceClaim, ...] = ()
    limitations: tuple[str, ...] = ()

    def to_profile_data(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "legal_rule_catalog_version_id": self.legal_rule_catalog_version_id,
            "legal_corpus_version_id": self.legal_corpus_version_id,
            "rules_considered": self.rules_considered,
            "engineering_rules_executed": self.engineering_rules_executed,
            "engineering_rule_cache_hits": self.engineering_rule_cache_hits,
            "claims": [claim.to_dict() for claim in self.claims],
            "limitations": list(self.limitations),
        }


class EngineeringInvestigationPipeline:
    """Own the pre-profile EngineeringRule investigation lifecycle in Python.

    Nest remains the authority/read boundary for the active legal catalog and
    corpus. Python owns compilation, deterministic ProgramGraph pre-query,
    LLM semantic synthesis, and EvidenceClaim validation. Only validated claims
    are returned to TechnicalProfile persistence.
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
    ) -> None:
        self._api_client = api_client
        self._retriever = retriever or ChromaDbCitationRetriever()
        self._rule_service = rule_service or EngineeringRuleService(
            compiler=EngineeringRuleCompiler(llm_client),
            retriever=self._retriever,
        )
        self._query_executor = query_executor or InitialQueryExecutor()
        self._investigator = investigator or LawGuidedInvestigator(llm_client)

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
        limitations: list[str] = []
        executed = 0
        cache_hits = 0

        for rule in rules:
            legal_rule_id = str(
                rule.get("legalRuleId") or rule.get("legal_rule_id") or rule.get("id") or "unknown"
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
                for engineering_rule in engineering_rules:
                    packet = self._query_executor.execute(
                        engineering_rule,
                        graph,
                        wizard_context=wizard_context,
                    )
                    claims.extend(
                        self._investigator.investigate(
                            packet=packet,
                            graph=graph,
                            workflow_run_id=workflow_run_id,
                            correlation_id=correlation_id,
                        )
                    )
                    executed += 1
            except BudgetExceeded:
                limitations.append(
                    f"ENGINEERING_INVESTIGATION_BUDGET_EXHAUSTED:{legal_rule_id}"
                )
                break
            except Exception as error:
                limitations.append(
                    f"ENGINEERING_RULE_INVESTIGATION_FAILED:{legal_rule_id}:{type(error).__name__}"
                )

        return EngineeringInvestigationResult(
            status="COMPLETE" if not limitations else "PARTIAL",
            legal_rule_catalog_version_id=catalog_version_id,
            legal_corpus_version_id=corpus_version_id,
            rules_considered=len(rules),
            engineering_rules_executed=executed,
            engineering_rule_cache_hits=cache_hits,
            claims=tuple(claims),
            limitations=tuple(limitations),
        )

    @staticmethod
    def _graph(evidence_report: dict[str, Any]) -> ProgramEvidenceGraph:
        payload = evidence_report.get("evidence_payload") or evidence_report.get("evidencePayload")
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
