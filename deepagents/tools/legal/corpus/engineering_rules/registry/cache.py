"""Persistent vectorless cache for LLM-compiled EngineeringRules.

The cache intentionally reuses the Chroma persistence already operated for legal
retrieval, but stores no embeddings and performs only exact fingerprint/ID lookups.
"""
from __future__ import annotations
import json
from typing import Iterable
from tools.legal.retrieval.index.chroma_path import resolve_legal_chroma_path
from tools.legal.retrieval.index.chroma_vectorless import zero_embeddings
from ..contract.models import EngineeringRule
from ..contract.validator import validate_engineering_rule

NO_ENGINEERING_RULES_MARKER = "__NO_ENGINEERING_RULES__"


class EngineeringRuleCache:
    COLLECTION = "lcsp_engineering_rules_v1"
    def __init__(self, chroma_path: str | None = None) -> None:
        self._chroma_path = resolve_legal_chroma_path(chroma_path)

    def get(self, fingerprint: str) -> list[EngineeringRule]:
        result = self._collection().get(where={"source_fingerprint": fingerprint}, include=["documents", "metadatas"])
        documents = list(result.get("documents") or [])
        metadatas = list(result.get("metadatas") or [])
        rules = []
        for index, raw in enumerate(documents):
            if not raw: continue
            metadata = metadatas[index] if index < len(metadatas) else None
            if (metadata or {}).get("triage_outcome") == NO_ENGINEERING_RULES_MARKER: continue
            value = json.loads(str(raw))
            if isinstance(value, dict): rules.append(validate_engineering_rule(EngineeringRule.from_dict(value)))
        return sorted(rules, key=lambda item: item.engineering_rule_id)

    def mark_no_engineering_rules(self, fingerprint: str, *, legal_rule_id: str) -> None:
        """Record that triage ran on this exact legal source and produced no candidates.

        Without this marker a legitimately context-only LegalRule is indistinguishable
        from one that has never been prepared, so the readiness gate keeps re-requesting
        triage forever. The marker is keyed by source fingerprint, so changed legal text
        or a changed contract retires it automatically.
        """
        self._collection().upsert(
            ids=[f"{fingerprint}:{NO_ENGINEERING_RULES_MARKER}"],
            documents=[json.dumps({"triageOutcome": NO_ENGINEERING_RULES_MARKER, "legalRuleId": legal_rule_id}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))],
            metadatas=[{"source_fingerprint": fingerprint, "triage_outcome": NO_ENGINEERING_RULES_MARKER, "legal_rule_id": legal_rule_id}],
            embeddings=zero_embeddings(1),
        )

    def is_triaged_without_rules(self, fingerprint: str) -> bool:
        """Return whether triage already decided this legal source yields no rules."""
        result = self._collection().get(ids=[f"{fingerprint}:{NO_ENGINEERING_RULES_MARKER}"])
        return bool(result.get("ids"))

    def put(self, fingerprint: str, rules: Iterable[EngineeringRule]) -> None:
        values = list(rules)
        if not values: return
        ids, documents, metadatas = [], [], []
        for rule in values:
            validate_engineering_rule(rule)
            if rule.source_fingerprint != fingerprint: raise ValueError("engineering rule fingerprint mismatch")
            ids.append(f"{fingerprint}:{rule.engineering_rule_id}")
            documents.append(json.dumps(rule.to_dict(), ensure_ascii=False, sort_keys=True, separators=(",", ":")))
            metadatas.append({"source_fingerprint": fingerprint, "engineering_rule_id": rule.engineering_rule_id, "legal_rule_id": rule.legal_rule_id, "legal_rule_catalog_version_id": rule.legal_rule_catalog_version_id, "legal_corpus_version_id": rule.legal_corpus_version_id, "schema_version": rule.schema_version})
        self._collection().upsert(ids=ids, documents=documents, metadatas=metadatas, embeddings=zero_embeddings(len(ids)))

    def delete_fingerprint(self, fingerprint: str) -> None:
        self._collection().delete(where={"source_fingerprint": fingerprint})

    def _collection(self):
        try: import chromadb
        except ImportError as error: raise RuntimeError("chromadb is required for engineering-rule cache") from error
        return chromadb.PersistentClient(path=self._chroma_path).get_or_create_collection(name=self.COLLECTION, embedding_function=None)
