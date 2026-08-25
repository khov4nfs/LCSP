"""Index and retrieve approved legal chunks by exact structural identifiers in ChromaDB."""
from __future__ import annotations
import json
from dataclasses import dataclass
from typing import Any

from tools.legal.retrieval.index.chroma_path import resolve_legal_chroma_path
from tools.legal.retrieval.index.chroma_vectorless import zero_embeddings

@dataclass(slots=True)
class RetrievedChunk:
    id: str
    document_id: str
    locator: str
    legal_status: str
    role: str

class ChromaDbCitationRetriever:
    """Vectorless structure-first retrieval; embeddings/similarity are deliberately disabled."""
    def __init__(self, chroma_path: str | None = None) -> None:
        self._chroma_path = resolve_legal_chroma_path(chroma_path)

    def index_corpus(self, corpus_version_id: str, chunks: list[dict[str, Any]]) -> None:
        collection = self._collection(corpus_version_id); ids = []; documents = []; metadatas = []
        for chunk in chunks:
            chunk_id, content = str(chunk.get("id") or ""), str(chunk.get("content") or "")
            if not chunk_id or not content: raise ValueError("Legal index requires stable chunk IDs and content")
            hierarchy = chunk.get("hierarchy") or {}; ids.append(chunk_id); documents.append(content)
            metadatas.append({"corpus_version_id": corpus_version_id, "document_id": str(chunk.get("documentId") or ""), "locator": str(chunk.get("locator") or ""), "legal_status": str(chunk.get("legalStatus") or "ACTIVE"), "content_sha256": str(chunk.get("contentSha256") or chunk.get("content_sha256") or ""), "parent_chunk_id": str(hierarchy.get("parentChunkId") or hierarchy.get("parent_chunk_id") or ""), "related_chunk_ids": json.dumps(self._related_chunk_ids(hierarchy))})
        if ids: collection.upsert(ids=ids, documents=documents, metadatas=metadatas, embeddings=zero_embeddings(len(ids)))

    def retrieve_exact(self, corpus_version_id: str, chunk_ids: list[str]) -> list[RetrievedChunk]:
        records = self._structural_records(corpus_version_id, chunk_ids)
        return [RetrievedChunk(item["id"], str(item["metadata"].get("document_id") or ""), str(item["metadata"].get("locator") or ""), str(item["metadata"].get("legal_status") or "ACTIVE"), item["role"]) for item in records]

    def retrieve_exact_context(self, corpus_version_id: str, chunk_ids: list[str]) -> list[dict[str, Any]]:
        """Return exact text plus parent/reference context for EngineeringRule compilation."""
        return [{"id": item["id"], "documentId": str(item["metadata"].get("document_id") or ""), "locator": str(item["metadata"].get("locator") or ""), "legalStatus": str(item["metadata"].get("legal_status") or "ACTIVE"), "contentSha256": str(item["metadata"].get("content_sha256") or ""), "role": item["role"], "content": item["document"]} for item in self._structural_records(corpus_version_id, chunk_ids)]

    def build_citation_allowlist(self, chunks: list[RetrievedChunk]) -> dict[str, Any]:
        return {"allowlist": [c.id for c in chunks if c.legal_status != "REPEALED"], "repealed_chunk_ids": [c.id for c in chunks if c.legal_status == "REPEALED"]}

    def _structural_records(self, corpus_version_id: str, chunk_ids: list[str]) -> list[dict[str, Any]]:
        if not chunk_ids: return []
        primary = self._records(corpus_version_id, chunk_ids); primary_ids = {item["id"] for item in primary}
        parent_ids = self._unique(str(item["metadata"].get("parent_chunk_id") or "") for item in primary)
        parent_set = set(parent_ids)
        referenced_ids = self._unique(ref for item in primary for ref in self._metadata_related_ids(item["metadata"]) if ref not in primary_ids and ref not in parent_set)
        rows = []
        for role, records in (("PRIMARY_MATCH", primary), ("PARENT_CONTEXT", self._records(corpus_version_id, parent_ids)), ("REFERENCED_CONTEXT", self._records(corpus_version_id, referenced_ids))):
            rows.extend({**item, "role": role} for item in records)
        return rows

    def _collection(self, corpus_version_id: str):
        try: import chromadb
        except ImportError as error: raise RuntimeError("chromadb is required for legal retrieval") from error
        return chromadb.PersistentClient(path=self._chroma_path).get_or_create_collection(name=f"lcsp_legal_{corpus_version_id}", embedding_function=None)

    def _records(self, corpus_version_id: str, chunk_ids: list[str]) -> list[dict[str, Any]]:
        if not chunk_ids: return []
        result = self._collection(corpus_version_id).get(ids=chunk_ids, include=["documents", "metadatas"])
        ids = list(result.get("ids") or [])
        metadatas = list(result.get("metadatas") or [])
        documents = list(result.get("documents") or [])
        # Citation-only callers and lightweight test doubles may omit documents. Exact
        # identity/metadata retrieval must still work; compiler callers receive empty
        # text only when their backing collection truly did not return documents.
        if len(documents) < len(ids): documents.extend([""] * (len(ids) - len(documents)))
        if len(metadatas) < len(ids): metadatas.extend([{}] * (len(ids) - len(metadatas)))
        return [{"id": str(chunk_id), "document": str(documents[index] or ""), "metadata": metadatas[index] or {}} for index, chunk_id in enumerate(ids)]

    @staticmethod
    def _metadata_related_ids(metadata: dict[str, Any]) -> list[str]:
        raw = metadata.get("related_chunk_ids")
        if not isinstance(raw, str): return []
        try: parsed = json.loads(raw)
        except json.JSONDecodeError: return []
        return [str(v) for v in parsed if str(v)] if isinstance(parsed, list) else []

    def _related_chunk_ids(self, hierarchy: dict[str, Any]) -> list[str]:
        return self._unique(str(v) for v in [*(hierarchy.get("outgoingRefIds") or hierarchy.get("outgoing_ref_ids") or []), *(hierarchy.get("incomingRefIds") or hierarchy.get("incoming_ref_ids") or [])] if str(v))

    @staticmethod
    def _unique(values) -> list[str]: return list(dict.fromkeys(value for value in values if value))
