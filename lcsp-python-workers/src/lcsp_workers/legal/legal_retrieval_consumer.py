"""Match approved verified profiles against active legal rules and exact corpus citations."""

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

MAX_RULE_DIAGNOSTICS = 50


class LegalRetrievalConsumer(ConsumerBase):
    """Evaluate active rules and attach only exact, non-repealed corpus citations."""

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
        """Create the consumer with injectable API, evaluator, retriever, and builder."""
        super().__init__(config, pbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._evaluator = evaluator or RuleApplicabilityEvaluator()
        self._retriever = retriever or ChromaDbCitationRetriever()
        self._builder = builder or LegalMatchBuilder()

    def handle(self, message: dict[str, Any], correlationId: str) -> None:
        """Evaluate legal rules against an approved verified profile and persist matches."""
        verified_profile_id = self._required_message_id(message, "verifiedProfileId")
        assessment_id = self._required_message_id(message, "assessmentId")
        corpus_version_id = self._required_message_id(message, "corpusVersionId")

        verified_profile = self._api_client.get_verified_profile_by_id(verified_profile_id)
        verified_profile_status = str(verified_profile.get("status") or "").upper()
        if verified_profile_status != "APPROVED":
            raise WorkerCallbackError("Verified profile is not approved.")

        legal_catalog = self._api_client.get_active_legal_rule_catalog()
        catalog_id = str(
            legal_catalog.get("versionId") or legal_catalog.get("id") or ""
        )
        corpus_index = self._api_client.get_legal_corpus_chunks(corpus_version_id)
        corpus_chunks = corpus_index.get("chunks") or []
        self._retriever.index_corpus(corpus_version_id, corpus_chunks)

        rules = legal_catalog.get("rules", [])
        rule_count = len(rules)
        chunk_count = len(corpus_chunks)
        merged_profile = _record(verified_profile.get("mergedProfile")) or _record(
            verified_profile.get("merged_profile")
        )
        fact_evidence_refs = _record(
            verified_profile.get("factEvidenceRefs")
        ) or _record(verified_profile.get("fact_evidence_refs"))

        matches: list[dict[str, Any]] = []
        evaluations: list[dict[str, Any]] = []
        deterministic_match_count = 0
        matched_without_citation_count = 0

        for rule in rules:
            result = self._evaluator.evaluate_rule(
                rule=rule,
                verified_profile=verified_profile,
            )
            evaluation = {
                "rule_id": result.rule_id,
                "status": result.status,
                "rationale": list(result.rationale),
                "matched_required_facts": list(result.matched_required_facts),
                "blocking_facts": list(result.blocking_facts),
            }

            if result.status != "MATCHED":
                evaluations.append(evaluation)
                continue

            deterministic_match_count += 1
            citation_ids = []
            for ref in (rule.get("citationLocatorRefs") or []):
                chunk_id = str(ref.get("id") or "")
                if chunk_id:
                    citation_ids.append(chunk_id)
            citation_chunks = self._retriever.retrieve_exact(
                corpus_version_id, citation_ids
            )
            citation_result = self._retriever.build_citation_allowlist(citation_chunks)
            allowlist = citation_result["allowlist"]
            if not allowlist:
                matched_without_citation_count += 1
                evaluation["status"] = "NO_CITATION_FOR_MATCHED_RULE"
                evaluation["rationale"] = [
                    *evaluation["rationale"],
                    "matched rule has no valid non-repealed citation chunk",
                ]
                evaluations.append(evaluation)
                continue

            allowed_chunks = [
                chunk for chunk in citation_chunks if chunk.id in allowlist
            ]
            legal_statuses = {chunk.legal_status.upper() for chunk in allowed_chunks}
            if "REPEALED" in legal_statuses:
                raise WorkerCallbackError(
                    "Repealed citation escaped the legal allowlist."
                )
            legal_status = (
                next(iter(legal_statuses))
                if len(legal_statuses) == 1
                else "ACTIVE"
            )
            evaluations.append(evaluation)
            matches.append(
                {
                    "match_id": f"{result.rule_id}:{verified_profile_id}",
                    "rule_id": result.rule_id,
                    "legal_rule_catalog_version_id": catalog_id,
                    "article_ref": "",
                    "clause_ref": "",
                    "match_type": "PRIMARY_MATCH",
                    "citation_chunk_ids": allowlist,
                    "context_roles": [chunk.role for chunk in allowed_chunks],
                    "confidence": result.confidence,
                    "coverage_status": "COMPLETE_CITATION",
                    "usage_claim_ref": verified_profile_id,
                    "legal_status": legal_status,
                }
            )

        match_count = len(matches)
        no_match_reason = _no_match_reason(
            rule_count=rule_count,
            match_count=match_count,
            deterministic_match_count=deterministic_match_count,
            matched_without_citation_count=matched_without_citation_count,
            evaluations=evaluations,
        )
        diagnostics = {
            "no_match_reason": no_match_reason,
            "rule_count": rule_count,
            "candidate_rule_count": rule_count,
            "chunk_count": chunk_count,
            "deterministic_match_count": deterministic_match_count,
            "matched_without_citation_count": matched_without_citation_count,
            "match_count": match_count,
            "profile_fact_fields": sorted(merged_profile.keys())
            if merged_profile
            else [],
            "profile_evidence_fields": sorted(fact_evidence_refs.keys())
            if fact_evidence_refs
            else [],
            "evaluations": evaluations[:MAX_RULE_DIAGNOSTICS],
            "evaluations_truncated": len(evaluations) > MAX_RULE_DIAGNOSTICS,
        }

        logger.info(
            "LEGAL_RULE_MATCH_EVALUATION_SUMMARY",
            verified_profile_id=verified_profile_id,
            catalog_id=catalog_id,
            corpus_version_id=corpus_version_id,
            rule_count=rule_count,
            candidate_rule_count=rule_count,
            chunk_count=chunk_count,
            deterministic_match_count=deterministic_match_count,
            match_count=match_count,
            no_match_reason=no_match_reason,
            profile_fact_fields=diagnostics["profile_fact_fields"],
            profile_evidence_fields=diagnostics["profile_evidence_fields"],
            correlationId=correlationId,
        )

        payload = self._builder.build_payload(
            verified_profile_id=verified_profile_id,
            assessment_id=assessment_id,
            legal_rule_catalog_version_id=catalog_id,
            legal_corpus_version_id=corpus_version_id,
            matches=matches,
        )
        callback_payload = LegalRuleMatchCallbackPayload(
            verified_profile_id=payload["verified_profile_id"],
            assessment_id=payload["assessment_id"],
            corpus_version_id=payload["corpus_version_id"],
            legal_rule_catalog_version_id=payload[
                "legal_rule_catalog_version_id"
            ],
            schema_version=payload["schema_version"],
            matches=payload["matches"],
            citation_allowlist=payload["citation_allowlist"],
            overall_coverage_status=payload["overall_coverage_status"],
            diagnostics=diagnostics,
        )
        self._api_client.post_legal_rule_match_callback(callback_payload)
        logger.info(
            "LEGAL_RULE_MATCH_CALLBACK_SUBMITTED",
            verified_profile_id=verified_profile_id,
            catalog_id=catalog_id,
            corpus_version_id=corpus_version_id,
            assessment_id=assessment_id,
            rule_count=rule_count,
            candidate_rule_count=rule_count,
            chunk_count=chunk_count,
            deterministic_match_count=deterministic_match_count,
            match_count=match_count,
            overall_coverage_status=payload["overall_coverage_status"],
            no_match_reason=no_match_reason,
            correlationId=correlationId,
        )

    def _required_message_id(self, message: dict[str, Any], key: str) -> str:
        """Read and stringify a required command identifier."""
        value = message.get(key)
        if not value:
            raise ValueError(f"missing {key}")
        return str(value)


def _record(value: Any) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def _no_match_reason(
    *,
    rule_count: int,
    match_count: int,
    deterministic_match_count: int,
    matched_without_citation_count: int,
    evaluations: list[dict[str, Any]],
) -> str | None:
    if match_count > 0:
        return None
    if rule_count == 0:
        return "RULE_CATALOG_EMPTY"
    if deterministic_match_count > 0 and matched_without_citation_count > 0:
        return "MATCHED_RULE_HAS_NO_VALID_CITATION"
    statuses = {str(item.get("status") or "") for item in evaluations}
    if "BLOCKED_UNKNOWN_FACT" in statuses:
        return "VERIFIED_PROFILE_FACTS_UNRESOLVED"
    return "NO_APPLICABLE_RULE"
