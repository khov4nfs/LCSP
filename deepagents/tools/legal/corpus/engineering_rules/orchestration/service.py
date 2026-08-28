"""Cache-aware orchestration for governed LegalRule -> EngineeringRule preparation."""
from __future__ import annotations

import os
from typing import Any

from tools.legal.retrieval.legal_basis.chromadb_citation_retriever import ChromaDbCitationRetriever
from tools.common.capabilities.platform.logging import get_logger
from tools.legal.corpus.artifact_store import write_recovery_artifact

from ..registry.cache import EngineeringRuleCache
from ..registry.precompiled_registry import PrecompiledEngineeringRuleRegistry
from ..compilation.compiler import COMPILER_VERSION, PROMPT_VERSION, EngineeringRuleCompiler
from ..compilation.chunk_triage import LegalChunkEngineeringRuleTriage
from ..compilation.fingerprint import engineering_rule_fingerprint
from ..contract.models import (
    DEV_ENGINEERING_RULE_BOOTSTRAP_RULE_FAMILY,
    ENGINEERING_RULE_SCHEMA_VERSION,
    EngineeringRule,
    build_legal_reasoning_contract,
)
from ..contract.validator import validate_engineering_rule


logger = get_logger(__name__)


class EngineeringRuleService:
    """Persist rules during legal preparation and expose READY rules to assessments."""

    def __init__(
        self,
        *,
        compiler: EngineeringRuleCompiler | None = None,
        retriever: ChromaDbCitationRetriever | None = None,
        cache: EngineeringRuleCache | None = None,
        precompiled_registry: PrecompiledEngineeringRuleRegistry | None = None,
    ) -> None:
        # Kept for compatibility with operator/import construction. Assessment reads no
        # longer delegate compilation to this object.
        self.compiler = compiler
        self.retriever = retriever or ChromaDbCitationRetriever()
        self.cache = cache or EngineeringRuleCache()
        self.precompiled_registry = (
            precompiled_registry or PrecompiledEngineeringRuleRegistry()
        )

    def get_or_compile(
        self,
        *,
        legal_rule: dict[str, Any],
        legal_rule_catalog_version_id: str,
        legal_corpus_version_id: str,
        workflow_run_id: str,
        correlation_id: str | None = None,
    ) -> tuple[list[EngineeringRule], bool]:
        """Return only READY cached rules; never compile as an Assessment side effect.

        The method name remains temporarily for caller compatibility. LCSP-263 moves
        business triage and EngineeringRule creation to the Legal Rule Triage subagent.
        A cache miss therefore means the legal-preparation workflow has not produced a
        READY EngineeringRule yet.
        """
        context, fingerprint = self.resolve_source_identity(
            legal_rule=legal_rule,
            legal_corpus_version_id=legal_corpus_version_id,
        )
        cached = self.cache.get(fingerprint)
        if cached:
            return self._retarget_cached_rules(
                cached,
                legal_rule=legal_rule,
                legal_rule_catalog_version_id=legal_rule_catalog_version_id,
                legal_corpus_version_id=legal_corpus_version_id,
                legal_context=context,
            ), True

        logger.info(
            "ENGINEERING_RULE_NOT_READY",
            legal_rule_id=self._legal_rule_id(legal_rule),
            source_fingerprint=fingerprint,
            workflow_run_id=workflow_run_id,
            correlationId=correlation_id,
        )
        return [], False

    def prepare_from_triage(
        self,
        *,
        legal_rule: dict[str, Any],
        legal_rule_catalog_version_id: str,
        legal_corpus_version_id: str,
        chunk_analyses: list[dict[str, Any]],
        engineering_rule_rows: list[dict[str, Any]],
        workflow_run_id: str,
        correlation_id: str | None = None,
    ) -> tuple[list[EngineeringRule], bool]:
        """Validate and persist the triage agent's business decision handoff.

        No LLM is called here. The triage subagent owns Candidate/Context/Reject and
        Candidate-to-EngineeringRule reasoning. This service is the deterministic gate
        for source identity, normative eligibility, schema, graph vocabulary, cache and
        recovery artifacts.
        """
        context, fingerprint = self.resolve_source_identity(
            legal_rule=legal_rule,
            legal_corpus_version_id=legal_corpus_version_id,
        )
        decisions = LegalChunkEngineeringRuleTriage._parse_decisions(
            {"chunkAnalyses": chunk_analyses},
            context,
        )
        compile_context = LegalChunkEngineeringRuleTriage.select_engineering_rule_context(
            context,
            decisions,
        )

        if not compile_context:
            if engineering_rule_rows:
                raise ValueError(
                    "EngineeringRules cannot be persisted when triage produced no candidates"
                )
            self._store_triage_artifact(
                fingerprint=fingerprint,
                legal_rule=legal_rule,
                legal_rule_catalog_version_id=legal_rule_catalog_version_id,
                legal_corpus_version_id=legal_corpus_version_id,
                chunk_analyses=chunk_analyses,
                compile_context=compile_context,
            )
            logger.info(
                "ENGINEERING_RULE_PREPARATION_SKIPPED",
                legal_rule_id=self._legal_rule_id(legal_rule),
                reason="NO_ENGINEERING_RULE_CANDIDATES_AFTER_TRIAGE",
                workflow_run_id=workflow_run_id,
                correlationId=correlation_id,
            )
            return [], False
        if not engineering_rule_rows:
            raise ValueError(
                "triage candidates require at least one EngineeringRule proposal"
            )

        existing = self.cache.get(fingerprint)
        if existing:
            prepared = self._retarget_cached_rules(
                existing,
                legal_rule=legal_rule,
                legal_rule_catalog_version_id=legal_rule_catalog_version_id,
                legal_corpus_version_id=legal_corpus_version_id,
                legal_context=context,
            )
            self._store_engineering_rule_artifact(
                fingerprint=fingerprint,
                rules=prepared,
                legal_rule=legal_rule,
                legal_rule_catalog_version_id=legal_rule_catalog_version_id,
                legal_corpus_version_id=legal_corpus_version_id,
            )
            self._store_triage_artifact(
                fingerprint=fingerprint,
                legal_rule=legal_rule,
                legal_rule_catalog_version_id=legal_rule_catalog_version_id,
                legal_corpus_version_id=legal_corpus_version_id,
                chunk_analyses=chunk_analyses,
                compile_context=compile_context,
            )
            return prepared, True

        prepared = self._materialize_engineering_rules(
            legal_rule=legal_rule,
            legal_rule_catalog_version_id=legal_rule_catalog_version_id,
            legal_corpus_version_id=legal_corpus_version_id,
            legal_context=compile_context,
            source_fingerprint=fingerprint,
            rows=engineering_rule_rows,
        )
        self.cache.put(fingerprint, prepared)
        self._store_engineering_rule_artifact(
            fingerprint=fingerprint,
            rules=prepared,
            legal_rule=legal_rule,
            legal_rule_catalog_version_id=legal_rule_catalog_version_id,
            legal_corpus_version_id=legal_corpus_version_id,
        )
        self._store_triage_artifact(
            fingerprint=fingerprint,
            legal_rule=legal_rule,
            legal_rule_catalog_version_id=legal_rule_catalog_version_id,
            legal_corpus_version_id=legal_corpus_version_id,
            chunk_analyses=chunk_analyses,
            compile_context=compile_context,
        )
        logger.info(
            "ENGINEERING_RULE_PREPARED_BY_TRIAGE",
            legal_rule_id=self._legal_rule_id(legal_rule),
            engineering_rule_count=len(prepared),
            source_fingerprint=fingerprint,
            workflow_run_id=workflow_run_id,
            correlationId=correlation_id,
        )
        return prepared, False

    def resolve_source_identity(
        self,
        *,
        legal_rule: dict[str, Any],
        legal_corpus_version_id: str,
    ) -> tuple[list[dict[str, Any]], str]:
        """Resolve exact active citation context and its governed source fingerprint."""
        chunk_ids = self._chunk_ids(legal_rule)
        if not chunk_ids:
            raise ValueError("approved legal rule has no resolvable citation chunk IDs")
        context = self.retriever.retrieve_exact_context(
            legal_corpus_version_id,
            chunk_ids,
        )
        if not context:
            raise ValueError("legal rule citation context is unavailable")
        inactive = [
            item["id"]
            for item in context
            if str(item.get("legalStatus") or "ACTIVE") == "REPEALED"
        ]
        if inactive:
            raise ValueError(f"legal rule references repealed chunks: {inactive}")

        hashes = {
            str(item["id"]): str(item.get("contentSha256") or "")
            for item in context
        }
        fingerprint_compiler_version = COMPILER_VERSION
        rule_family = str(
            legal_rule.get("ruleFamily") or legal_rule.get("rule_family") or ""
        ).strip()
        if (
            self._allow_precompiled_fallback()
            and rule_family == DEV_ENGINEERING_RULE_BOOTSTRAP_RULE_FAMILY
        ):
            fingerprint_compiler_version = (
                f"{COMPILER_VERSION}|precompiled-contract:"
                f"{self.precompiled_registry.contract_version}"
            )
        fingerprint = engineering_rule_fingerprint(
            legal_rule=legal_rule,
            legal_corpus_version_id=legal_corpus_version_id,
            chunk_hashes=hashes,
            schema_version=ENGINEERING_RULE_SCHEMA_VERSION,
            prompt_version=PROMPT_VERSION,
            compiler_version=fingerprint_compiler_version,
        )
        return context, fingerprint

    # Temporary compatibility for callers/tests outside the LCSP-263 branch. New code
    # must use the public source-identity contract above rather than a private helper.
    def _context_and_fingerprint(
        self,
        *,
        legal_rule: dict[str, Any],
        legal_corpus_version_id: str,
    ) -> tuple[list[dict[str, Any]], str]:
        return self.resolve_source_identity(
            legal_rule=legal_rule,
            legal_corpus_version_id=legal_corpus_version_id,
        )

    @staticmethod
    def _materialize_engineering_rules(
        *,
        legal_rule: dict[str, Any],
        legal_rule_catalog_version_id: str,
        legal_corpus_version_id: str,
        legal_context: list[dict[str, Any]],
        source_fingerprint: str,
        rows: list[dict[str, Any]],
    ) -> list[EngineeringRule]:
        legal_rule_id = EngineeringRuleService._legal_rule_id(legal_rule)
        chunk_ids = [str(value.get("id")) for value in legal_context if value.get("id")]
        locators = [
            str(value.get("locator"))
            for value in legal_context
            if value.get("locator")
        ]
        prepared: list[EngineeringRule] = []
        for index, raw in enumerate(rows, start=1):
            if not isinstance(raw, dict):
                raise ValueError("EngineeringRule proposal must be an object")
            item = dict(raw)
            item.setdefault("engineeringRuleId", f"{legal_rule_id}::ENG::{index}")
            required_evidence = tuple(
                str(value) for value in item.get("requiredEvidence") or [] if str(value)
            )
            supporting_evidence = tuple(
                str(value)
                for value in item.get("supportingEvidence") or []
                if str(value)
            )
            negative_evidence = tuple(
                str(value) for value in item.get("negativeEvidence") or [] if str(value)
            )
            item.update(
                {
                    "legalRuleId": legal_rule_id,
                    "legalRuleCatalogVersionId": legal_rule_catalog_version_id,
                    "legalCorpusVersionId": legal_corpus_version_id,
                    "sourceChunkIds": chunk_ids,
                    "sourceLocators": locators,
                    "legalReasoningContract": build_legal_reasoning_contract(
                        legal_rule=legal_rule,
                        legal_rule_catalog_version_id=legal_rule_catalog_version_id,
                        legal_corpus_version_id=legal_corpus_version_id,
                        legal_context=legal_context,
                        required_evidence=required_evidence,
                        supporting_evidence=supporting_evidence,
                        negative_evidence=negative_evidence,
                    ),
                    "sourceFingerprint": source_fingerprint,
                    "compilerModel": "managed-deep-agent:triage",
                    "compilerVersion": COMPILER_VERSION,
                    "promptVersion": PROMPT_VERSION,
                    "schemaVersion": ENGINEERING_RULE_SCHEMA_VERSION,
                }
            )
            prepared.append(
                validate_engineering_rule(EngineeringRule.from_dict(item))
            )
        return prepared

    @staticmethod
    def _allow_precompiled_fallback() -> bool:
        return os.getenv("ENGINEERING_RULE_ALLOW_PRECOMPILED_FALLBACK", "").strip() in {
            "1",
            "true",
            "TRUE",
            "yes",
            "YES",
        }

    @staticmethod
    def _retarget_cached_rules(
        rules: list[EngineeringRule],
        *,
        legal_rule: dict[str, Any],
        legal_rule_catalog_version_id: str,
        legal_corpus_version_id: str,
        legal_context: list[dict[str, Any]],
    ) -> list[EngineeringRule]:
        retargeted: list[EngineeringRule] = []
        for rule in rules:
            if (
                rule.legal_rule_catalog_version_id == legal_rule_catalog_version_id
                and rule.legal_corpus_version_id == legal_corpus_version_id
            ):
                retargeted.append(rule)
                continue
            payload = rule.to_dict()
            payload["legal_rule_catalog_version_id"] = legal_rule_catalog_version_id
            payload["legal_corpus_version_id"] = legal_corpus_version_id
            payload["legal_reasoning_contract"] = build_legal_reasoning_contract(
                legal_rule=legal_rule,
                legal_rule_catalog_version_id=legal_rule_catalog_version_id,
                legal_corpus_version_id=legal_corpus_version_id,
                legal_context=legal_context,
                required_evidence=rule.required_evidence,
                supporting_evidence=rule.supporting_evidence,
                negative_evidence=rule.negative_evidence,
            ).to_dict()
            retargeted.append(EngineeringRule.from_dict(payload))
        return retargeted

    @staticmethod
    def _chunk_ids(legal_rule: dict[str, Any]) -> list[str]:
        refs = legal_rule.get("citationLocatorRefs") or legal_rule.get(
            "citation_locator_refs"
        ) or []
        result: list[str] = []
        for value in refs:
            if isinstance(value, str):
                result.append(value.removeprefix("legal-chunk:"))
                continue
            if not isinstance(value, dict):
                continue
            direct = value.get("chunkId") or value.get("chunk_id") or value.get("id")
            if direct:
                result.append(str(direct).removeprefix("legal-chunk:"))
                continue
            identity = value.get("documentIdentityToken") or value.get(
                "document_identity_token"
            )
            locator = value.get("locator")
            if identity and locator:
                result.append(f"{identity}:{locator}")
        return list(dict.fromkeys(result))

    @staticmethod
    def _legal_rule_id(legal_rule: dict[str, Any]) -> str:
        return str(
            legal_rule.get("legalRuleId")
            or legal_rule.get("legal_rule_id")
            or legal_rule.get("id")
            or "unknown"
        )

    @staticmethod
    def _store_triage_artifact(
        *,
        fingerprint: str,
        legal_rule: dict[str, Any],
        legal_rule_catalog_version_id: str,
        legal_corpus_version_id: str,
        chunk_analyses: list[dict[str, Any]],
        compile_context: list[dict[str, Any]],
    ) -> None:
        write_recovery_artifact(
            "legal-rule-triage",
            fingerprint,
            {
                "sourceFingerprint": fingerprint,
                "legalRuleId": EngineeringRuleService._legal_rule_id(legal_rule),
                "legalRuleCatalogVersionId": legal_rule_catalog_version_id,
                "legalCorpusVersionId": legal_corpus_version_id,
                "chunkAnalyses": chunk_analyses,
                "candidateChunkIds": [
                    str(value.get("id"))
                    for value in compile_context
                    if value.get("id")
                ],
            },
        )

    @staticmethod
    def _store_engineering_rule_artifact(
        *,
        fingerprint: str,
        rules: list[EngineeringRule],
        legal_rule: dict[str, Any],
        legal_rule_catalog_version_id: str,
        legal_corpus_version_id: str,
    ) -> None:
        """Persist prepared EngineeringRule contracts outside Chroma/DB."""
        write_recovery_artifact(
            "engineering-rules",
            fingerprint,
            {
                "sourceFingerprint": fingerprint,
                "legalRuleId": EngineeringRuleService._legal_rule_id(legal_rule),
                "legalRuleCatalogVersionId": legal_rule_catalog_version_id,
                "legalCorpusVersionId": legal_corpus_version_id,
                "legalRule": legal_rule,
                "engineeringRules": [rule.to_dict() for rule in rules],
            },
        )
