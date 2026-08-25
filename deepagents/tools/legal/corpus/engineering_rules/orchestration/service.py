"""Cache-aware orchestration for governed LegalRule -> EngineeringRule compilation."""
from __future__ import annotations

import os
from typing import Any

from tools.legal.retrieval.legal_basis.chromadb_citation_retriever import ChromaDbCitationRetriever
from tools.common.capabilities.platform.logging import get_logger

from ..registry.cache import EngineeringRuleCache
from ..compilation.compiler import COMPILER_VERSION, PROMPT_VERSION, EngineeringRuleCompiler
from ..compilation.fingerprint import engineering_rule_fingerprint
from ..contract.models import (
    DEV_ENGINEERING_RULE_BOOTSTRAP_RULE_FAMILY,
    ENGINEERING_RULE_SCHEMA_VERSION,
    EngineeringRule,
    build_legal_reasoning_contract,
)
from ..registry.precompiled_registry import PrecompiledEngineeringRuleRegistry


logger = get_logger(__name__)


class EngineeringRuleService:
    def __init__(
        self,
        *,
        compiler: EngineeringRuleCompiler,
        retriever: ChromaDbCitationRetriever | None = None,
        cache: EngineeringRuleCache | None = None,
        precompiled_registry: PrecompiledEngineeringRuleRegistry | None = None,
    ) -> None:
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

        rule_family = str(
            legal_rule.get("ruleFamily") or legal_rule.get("rule_family") or ""
        ).strip()
        legal_rule_id = str(
            legal_rule.get("legalRuleId")
            or legal_rule.get("legal_rule_id")
            or legal_rule.get("id")
            or "unknown"
        )

        hashes = {
            str(item["id"]): str(item.get("contentSha256") or "")
            for item in context
        }
        fingerprint_compiler_version = COMPILER_VERSION
        allow_precompiled_fallback = self._allow_precompiled_fallback()
        if (
            allow_precompiled_fallback
            and rule_family == DEV_ENGINEERING_RULE_BOOTSTRAP_RULE_FAMILY
        ):
            # The governed precompiled technical overlay is part of the effective
            # EngineeringRule contract. Include its version in the cache fingerprint so
            # a prior broad transparency rule cannot survive a contract hardening change
            # merely because the underlying legal chunk hashes did not change.
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
        cached = self.cache.get(fingerprint)
        if cached:
            return self._retarget_cached_rules(
                cached,
                legal_rule=legal_rule,
                legal_rule_catalog_version_id=legal_rule_catalog_version_id,
                legal_corpus_version_id=legal_corpus_version_id,
                legal_context=context,
            ), True

        # The normal path compiles from the active legal chunks after LLM triage.
        # The checked-in precompiled bundle is now an explicit operator fallback only;
        # it must not silently replace the corpus -> chunk -> triage -> compile flow.
        if (
            allow_precompiled_fallback
            and rule_family == DEV_ENGINEERING_RULE_BOOTSTRAP_RULE_FAMILY
        ):
            recovered = self.precompiled_registry.materialize(
                legal_rule=legal_rule,
                legal_rule_catalog_version_id=legal_rule_catalog_version_id,
                legal_corpus_version_id=legal_corpus_version_id,
                legal_context=context,
                source_fingerprint=fingerprint,
            )
            self.cache.put(fingerprint, recovered)
            logger.info(
                "ENGINEERING_RULE_PRECOMPILED_CACHE_RECOVERED",
                legal_rule_id=legal_rule_id,
                engineering_rule_count=len(recovered),
                precompiled_contract_version=self.precompiled_registry.contract_version,
                source_fingerprint=fingerprint,
                workflow_run_id=workflow_run_id,
                correlationId=correlation_id,
            )
            return recovered, False

        compiled = self.compiler.compile(
            legal_rule=legal_rule,
            legal_rule_catalog_version_id=legal_rule_catalog_version_id,
            legal_corpus_version_id=legal_corpus_version_id,
            legal_context=context,
            source_fingerprint=fingerprint,
            workflow_run_id=workflow_run_id,
            correlation_id=correlation_id,
        )
        if not compiled:
            logger.info(
                "ENGINEERING_RULE_COMPILATION_SKIPPED",
                legal_rule_id=legal_rule_id,
                reason="NO_ENGINEERING_RULE_CANDIDATES_AFTER_TRIAGE",
                workflow_run_id=workflow_run_id,
                correlationId=correlation_id,
            )
            return [], False
        self.cache.put(fingerprint, compiled)
        return compiled, False

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
            # Current legal chunks use `<DOCUMENT-IDENTITY>:<locator>`. A catalog may
            # store an identity token explicitly; do not guess it from a display title.
            identity = value.get("documentIdentityToken") or value.get(
                "document_identity_token"
            )
            locator = value.get("locator")
            if identity and locator:
                result.append(f"{identity}:{locator}")
        return list(dict.fromkeys(result))
