"""Authoritative data access and persistence for Legal Rule Triage.

The Managed Deep Agent performs the business reasoning. This service only provides
approved LegalRule/chunk inputs, validates the agent handoff, fingerprints it, and
persists READY EngineeringRules. It never calls an LLM.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.platform.config import load_config
from tools.legal.corpus.engineering_rules.orchestration.service import EngineeringRuleService
from tools.legal.retrieval.legal_basis.chromadb_citation_retriever import ChromaDbCitationRetriever
from tools.legal.sources.recovery.artifact_store import recovery_artifact_exists

from .singleton import TriageSingletonCoordinator


class LegalRuleTriageService:
    """Load approved triage work and persist only validated agent decisions."""

    def __init__(
        self,
        *,
        api_client: WorkerApiClient | None = None,
        retriever: ChromaDbCitationRetriever | None = None,
        rule_service: EngineeringRuleService | None = None,
        triage_completion_lookup: Callable[[str], bool] | None = None,
        coordinator: TriageSingletonCoordinator | None = None,
    ) -> None:
        if api_client is None:
            config = load_config()
            api_client = WorkerApiClient(
                config.nestjs_api_base_url,
                config.worker_api_key,
            )
        self.api_client = api_client
        self.retriever = retriever or ChromaDbCitationRetriever()
        self.rule_service = rule_service or EngineeringRuleService(
            retriever=self.retriever,
        )
        self.coordinator = coordinator or TriageSingletonCoordinator()
        self._triage_completion_lookup = triage_completion_lookup or (
            lambda fingerprint: recovery_artifact_exists(
                "legal-rule-triage",
                fingerprint,
            )
        )

    def get_work_items(
        self,
        *,
        affected_rule_ids: list[str] | None = None,
        include_completed: bool = False,
        idempotency_key: str | None = None,
        trigger: str = "LEGAL_MAINTENANCE",
        triage_execution_id: str | None = None,
    ) -> dict[str, Any]:
        lease = self.coordinator.submit_or_continue(
            affected_rule_ids=affected_rule_ids,
            idempotency_key=idempotency_key,
            trigger=trigger,
            include_completed=include_completed,
            execution_id=triage_execution_id,
        )
        if lease.status == "ALREADY_RUNNING":
            return {
                "status": "ALREADY_RUNNING",
                "triageExecutionId": lease.execution_id,
                "workItems": [],
                "limitations": ["TRIAGE_SINGLETON_ACTIVE"],
            }
        if not lease.execution_id:
            raise RuntimeError("triage singleton owner is missing execution id")

        effective_rule_ids = [] if lease.full_backlog else list(lease.affected_rule_ids)
        effective_include_completed = bool(include_completed or lease.include_completed)
        if not lease.full_backlog and not effective_rule_ids:
            raise RuntimeError("triage singleton owner received empty bounded scope")

        catalog, catalog_version_id, corpus_version_id, chunks, rules = self._load_sources()
        requested = {
            str(value) for value in effective_rule_ids if str(value).strip()
        }
        if requested:
            rules = [rule for rule in rules if self._rule_id(rule) in requested]

        active_chunks = [chunk for chunk in chunks if isinstance(chunk, dict)]
        self.retriever.index_corpus(corpus_version_id, active_chunks)
        chunk_by_id = {
            str(chunk.get("id")): chunk
            for chunk in active_chunks
            if chunk.get("id")
        }
        work_items: list[dict[str, Any]] = []
        completed_count = 0
        for rule in rules:
            chunk_ids = EngineeringRuleService._chunk_ids(rule)
            legal_context = [
                chunk_by_id[value] for value in chunk_ids if value in chunk_by_id
            ]
            missing_chunk_ids = [
                value for value in chunk_ids if value not in chunk_by_id
            ]
            ready_for_triage = bool(chunk_ids) and not missing_chunk_ids
            source_fingerprint: str | None = None
            triage_completed = False
            if ready_for_triage:
                _, source_fingerprint = self.rule_service.resolve_source_identity(
                    legal_rule=rule,
                    legal_corpus_version_id=corpus_version_id,
                )
                triage_completed = self._triage_completion_lookup(source_fingerprint)
                if triage_completed:
                    completed_count += 1
                    if not effective_include_completed:
                        continue

            work_items.append(
                {
                    "legalRuleId": self._rule_id(rule),
                    "legalRule": rule,
                    "legalContext": legal_context,
                    "sourceChunkIds": chunk_ids,
                    "missingChunkIds": missing_chunk_ids,
                    "readyForTriage": ready_for_triage,
                    "sourceFingerprint": source_fingerprint,
                    "triageCompleted": triage_completed,
                }
            )

        self.coordinator.set_batch_work(
            execution_id=lease.execution_id,
            legal_rule_ids=[
                str(item["legalRuleId"])
                for item in work_items
                if item.get("readyForTriage")
            ],
        )
        return {
            "status": "READY",
            "triageExecutionId": lease.execution_id,
            "singletonOwner": True,
            "fullBacklog": lease.full_backlog,
            "effectiveAffectedLegalRuleIds": effective_rule_ids,
            "legalRuleCatalogVersionId": catalog_version_id,
            "legalCorpusVersionId": corpus_version_id,
            "catalogRuleCount": len(catalog.get("rules") or []),
            "approvedRuleCount": len(rules),
            "completedRuleCount": completed_count,
            "pendingRuleCount": len(work_items),
            "workItems": work_items,
        }

    def persist_result(
        self,
        *,
        triage_execution_id: str,
        legal_rule_id: str,
        legal_rule_catalog_version_id: str,
        legal_corpus_version_id: str,
        chunk_analyses: list[dict[str, Any]],
        engineering_rules: list[dict[str, Any]],
        workflow_run_id: str,
        correlation_id: str | None = None,
    ) -> dict[str, Any]:
        self.coordinator.assert_owner(triage_execution_id)
        _, active_catalog_id, active_corpus_id, chunks, rules = self._load_sources()
        if legal_rule_catalog_version_id != active_catalog_id:
            raise ValueError("triage result targets a stale LegalRule catalog version")
        if legal_corpus_version_id != active_corpus_id:
            raise ValueError("triage result targets a stale legal corpus version")

        legal_rule = next(
            (rule for rule in rules if self._rule_id(rule) == legal_rule_id),
            None,
        )
        if legal_rule is None:
            raise ValueError("approved LegalRule is not available for triage")

        self.retriever.index_corpus(
            active_corpus_id,
            [chunk for chunk in chunks if isinstance(chunk, dict)],
        )
        prepared, _ = self.rule_service.prepare_from_triage(
            legal_rule=legal_rule,
            legal_rule_catalog_version_id=active_catalog_id,
            legal_corpus_version_id=active_corpus_id,
            chunk_analyses=chunk_analyses,
            engineering_rule_rows=engineering_rules,
            workflow_run_id=workflow_run_id,
            correlation_id=correlation_id,
        )
        self.coordinator.mark_rule_completed(
            execution_id=triage_execution_id,
            legal_rule_id=legal_rule_id,
        )
        return {
            "status": "READY",
            "triageExecutionId": triage_execution_id,
            "legalRuleId": legal_rule_id,
            "legalRuleCatalogVersionId": active_catalog_id,
            "legalCorpusVersionId": active_corpus_id,
            "triageDecisionCount": len(chunk_analyses),
            "engineeringRuleCount": len(prepared),
            "engineeringRuleIds": [rule.engineering_rule_id for rule in prepared],
        }

    def finish_or_drain(self, *, triage_execution_id: str) -> dict[str, Any]:
        """Finish the active batch and release the singleton; no request queue exists."""
        result = self.coordinator.finish_or_drain(execution_id=triage_execution_id)
        return result.to_dict()

    def _load_sources(
        self,
    ) -> tuple[dict[str, Any], str, str, list[dict[str, Any]], list[dict[str, Any]]]:
        catalog = self.api_client.get_active_legal_rule_catalog()
        corpus = self.api_client.get_active_legal_corpus()
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
        corpus_index = self.api_client.get_legal_corpus_chunks(corpus_version_id)
        chunks = corpus_index.get("chunks") or []
        if not isinstance(chunks, list):
            raise ValueError("active legal corpus chunks are invalid")
        rules = [
            rule
            for rule in (catalog.get("rules") or [])
            if isinstance(rule, dict) and self._is_approved_rule(rule)
        ]
        return catalog, catalog_version_id, corpus_version_id, chunks, rules

    @staticmethod
    def _required_id(payload: dict[str, Any], *keys: str, label: str) -> str:
        for key in keys:
            value = payload.get(key)
            if value:
                return str(value)
        raise ValueError(f"missing {label}")

    @staticmethod
    def _rule_id(rule: dict[str, Any]) -> str:
        value = rule.get("legalRuleId") or rule.get("legal_rule_id") or rule.get("id")
        return str(value or "")

    @staticmethod
    def _is_approved_rule(rule: dict[str, Any]) -> bool:
        status = str(
            rule.get("status")
            or rule.get("lifecycleState")
            or rule.get("lifecycle_state")
            or ""
        ).upper()
        return status in {"", "ACTIVE", "APPROVED", "PUBLISHED"}
