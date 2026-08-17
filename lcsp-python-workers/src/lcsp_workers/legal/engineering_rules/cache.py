"""Persistent vectorless cache for LLM-compiled EngineeringRules.

The cache intentionally reuses the Chroma persistence already operated for legal
retrieval, but stores no embeddings and performs only exact fingerprint/ID lookups.
"""
from __future__ import annotations
import json, os
from typing import Iterable
from .models import EngineeringRule
from .validator import validate_engineering_rule

class EngineeringRuleCache:
    COLLECTION = "lcsp_engineering_rules_v1"
    def __init__(self, chroma_path: str | None = None) -> None:
        from lcsp_workers.platform.logging_path import get_repo_root
        self._chroma_path = chroma_path or os.getenv("LEGAL_CHROMA_PATH", os.path.join(get_repo_root(), "tmp", "lcsp-chroma"))

    def get(self, fingerprint: str) -> list[EngineeringRule]:
        result = self._collection().get(where={"source_fingerprint": fingerprint}, include=["documents", "metadatas"])
        documents = list(result.get("documents") or [])
        rules = []
        for raw in documents:
            if not raw: continue
            value = json.loads(str(raw))
            if isinstance(value, dict): rules.append(validate_engineering_rule(EngineeringRule.from_dict(value)))
        return sorted(rules, key=lambda item: item.engineering_rule_id)

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
        self._collection().upsert(ids=ids, documents=documents, metadatas=metadatas)

    def delete_fingerprint(self, fingerprint: str) -> None:
        self._collection().delete(where={"source_fingerprint": fingerprint})

    def _collection(self):
        try: import chromadb
        except ImportError as error: raise RuntimeError("chromadb is required for engineering-rule cache") from error
        return chromadb.PersistentClient(path=self._chroma_path).get_or_create_collection(name=self.COLLECTION, embedding_function=None)
