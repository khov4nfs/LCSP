from __future__ import annotations

from typing import Any

from structlog import get_logger

from lcsp_workers.platform.api_client import WorkerApiClient, WorkerCallbackError
from lcsp_workers.platform.callback_schemas import LegalRuleMatchCallbackPayload
from lcsp_workers.platform.queue_consumer import ConsumerBase

from .chromadb_citation_retriever import ChromaDbCitationRetriever
from .legal_match_builder import LegalMatchBuilder
from .rule_applicability_evaluator import RuleApplicabilityEvaluator

logger = get_logger(__name__)


class LegalRetrievalConsumer(ConsumerBase):
    queue_name = "legal.legal-matching-requested"
    routing_key = "command.legal-matching.requested.v1"
    requires_pbac = False

    def __init__(
        self,
        config,
        pbac_client=None,
        api_client: WorkerApiClient | None = None,
        evaluator: RuleApplicabilityEvaluator | None = None,
        retriever: ChromaDbCitationRetriever | None = None,
        builder: LegalMatchBuilder | None = None,
    ) -> None:
        super().__init__(config, pbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._evaluator = evaluator or RuleApplicabilityEvaluator()
        self._retriever = retriever or ChromaDbCitationRetriever()
        self._builder = builder or LegalMatchBuilder()

    def handle(self, message: dict[str, Any], correlation_id: str) -> None:
        verified_profile_id = self._required_message_id(message, "verifiedProfileId")
        assessment_id = self._required_message_id(message, "assessmentId")
        corpus_version_id = self._required_message_id(message, "corpusVersionId")

        verified_profile = self._api_client.get_verified_profile_by_id(verified_profile_id)
        verified_profile_status = str(verified_profile.get("status") or "").upper()
        if verified_profile_status != "APPROVED":
            raise WorkerCallbackError("Verified profile is not approved.")

        legal_catalog = self._api_client.get_active_legal_rule_catalog()
        corpus_index = self._api_client.get_legal_corpus_chunks(corpus_version_id)
        self._retriever.index_corpus(corpus_version_id, corpus_index.get("chunks") or [])

        matches: list[dict[str, Any]] = []
        for rule in legal_catalog.get("rules", []):
            result = self._evaluator.evaluate_rule(
                rule=rule,
                verified_profile=verified_profile,
            )
            if result.status != "MATCHED":
                continue

            citation_ids = []
            for ref in (rule.get("citationLocatorRefs") or []):
                chunk_id = str(ref.get("id") or "")
                if chunk_id:
                    citation_ids.append(chunk_id)
            chunks = self._retriever.retrieve_exact(corpus_version_id, citation_ids)
            citation_result = self._retriever.build_citation_allowlist(chunks)
            allowlist = citation_result["allowlist"]
            if not allowlist:
                continue
            allowed_chunks = [chunk for chunk in chunks if chunk.id in allowlist]
            legal_statuses = {chunk.legal_status.upper() for chunk in allowed_chunks}
            if "REPEALED" in legal_statuses:
                raise WorkerCallbackError("Repealed citation escaped the legal allowlist.")
            legal_status = (
                next(iter(legal_statuses)) if len(legal_statuses) == 1 else "ACTIVE"
            )
            matches.append(
                {
                    "match_id": f"{result.rule_id}:{verified_profile_id}",
                    "rule_id": result.rule_id,
                    "legal_rule_catalog_version_id": legal_catalog.get("versionId") or legal_catalog.get("id") or "",
                    "article_ref": "",
                    "clause_ref": "",
                    "match_type": "PRIMARY_MATCH",
                    "citation_chunk_ids": allowlist,
                    "context_roles": [chunk.role for chunk in allowed_chunks],
                    "confidence": result.confidence,
                    "coverage_status": "COMPLETE_CITATION" if allowlist else "NO_CITATION",
                    "usage_claim_ref": verified_profile_id,
                    "legal_status": legal_status,
                }
            )

        payload = self._builder.build_payload(
            verified_profile_id=verified_profile_id,
            assessment_id=assessment_id,
            legal_rule_catalog_version_id=legal_catalog.get("versionId") or legal_catalog.get("id") or "",
            legal_corpus_version_id=corpus_version_id,
            matches=matches,
        )
        callback_payload = LegalRuleMatchCallbackPayload(
            verified_profile_id=payload["verified_profile_id"],
            assessment_id=payload["assessment_id"],
            corpus_version_id=payload["corpus_version_id"],
            legal_rule_catalog_version_id=payload["legal_rule_catalog_version_id"],
            schema_version=payload["schema_version"],
            matches=payload["matches"],
            citation_allowlist=payload["citation_allowlist"],
            overall_coverage_status=payload["overall_coverage_status"],
        )
        self._api_client.post_legal_rule_match_callback(callback_payload)
        logger.info(
            "LEGAL_RULE_MATCH_CALLBACK_SUBMITTED",
            assessment_id=assessment_id,
            match_count=len(matches),
            correlation_id=correlation_id,
        )

    def _required_message_id(self, message: dict[str, Any], key: str) -> str:
        value = message.get(key)
        if not value:
            raise ValueError(f"missing {key}")
        return str(value)
