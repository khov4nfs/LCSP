"""Cache-aware orchestration for governed LegalRule -> EngineeringRule compilation."""
from __future__ import annotations

from typing import Any

from lcsp_workers.legal.chromadb_citation_retriever import ChromaDbCitationRetriever
from lcsp_workers.platform.logging import get_logger

from .cache import EngineeringRuleCache
from .compiler import COMPILER_VERSION, PROMPT_VERSION, EngineeringRuleCompiler
from .fingerprint import engineering_rule_fingerprint
from .models import (
    DEV_ENGINEERING_RULE_BOOTSTRAP_RULE_FAMILY,
    ENGINEERING_RULE_SCHEMA_VERSION,
    EngineeringRule,
)
from .precompiled_registry import PrecompiledEngineeringRuleRegistry


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

        hashes = {
            str(item["id"]): str(item.get("contentSha256") or "")
            for item in context
        }
        fingerprint = engineering_rule_fingerprint(
            legal_rule=legal_rule,
            legal_corpus_version_id=legal_corpus_version_id,
            chunk_hashes=hashes,
            schema_version=ENGINEERING_RULE_SCHEMA_VERSION,
            prompt_version=PROMPT_VERSION,
            compiler_version=COMPILER_VERSION,
        )
        cached = self.cache.get(fingerprint)
        if cached:
            return cached, True

        rule_family = str(
            legal_rule.get("ruleFamily") or legal_rule.get("rule_family") or ""
        ).strip()
        legal_rule_id = str(
            legal_rule.get("legalRuleId")
            or legal_rule.get("legal_rule_id")
            or legal_rule.get("id")
            or "unknown"
        )

        # DEV bootstrap LegalRules are governed identities for the checked-in,
        # precompiled legal-chunk -> EngineeringRule bundle. The Chroma collection is
        # only a cache: a fresh/cleared local cache must not make every assessment
        # BLOCKED. Recover deterministically from the governed bundle, validate exact
        # current legal chunk hashes/versions, then repopulate the cache. The LLM is
        # never used for this sentinel family.
        if rule_family == DEV_ENGINEERING_RULE_BOOTSTRAP_RULE_FAMILY:
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
        self.cache.put(fingerprint, compiled)
        return compiled, False

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
