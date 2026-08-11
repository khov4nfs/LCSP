from __future__ import annotations

import os
import json
from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class RetrievedChunk:
    id: str
    document_id: str
    locator: str
    legal_status: str
    role: str


class ChromaDbCitationRetriever:
    """Structure-first ChromaDB retrieval with no embeddings or similarity search."""

    def __init__(self, chroma_path: str | None = None) -> None:
        self._chroma_path = chroma_path or os.getenv("LEGAL_CHROMA_PATH", "/tmp/lcsp-chroma")

    def index_corpus(self, corpus_version_id: str, chunks: list[dict[str, Any]]) -> None:
        collection = self._collection(corpus_version_id)
        ids: list[str] = []
        documents: list[str] = []
        metadatas: list[dict[str, str | int | float | bool]] = []
        for chunk in chunks:
            chunk_id = str(chunk.get("id") or "")
            content = str(chunk.get("content") or "")
            if not chunk_id or not content:
                raise ValueError("Legal index requires stable chunk IDs and content")
            ids.append(chunk_id)
            documents.append(content)
            hierarchy = chunk.get("hierarchy") or {}
            parent_chunk_id = str(
                hierarchy.get("parentChunkId")
                or hierarchy.get("parent_chunk_id")
                or ""
            )
            related_chunk_ids = self._related_chunk_ids(hierarchy)
            metadatas.append(
                {
                    "corpus_version_id": corpus_version_id,
                    "document_id": str(chunk.get("documentId") or ""),
                    "locator": str(chunk.get("locator") or ""),
                    "legal_status": str(chunk.get("legalStatus") or "ACTIVE"),
                    "parent_chunk_id": parent_chunk_id,
                    "related_chunk_ids": json.dumps(related_chunk_ids),
                }
            )
        if ids:
            collection.upsert(ids=ids, documents=documents, metadatas=metadatas)

    def retrieve_exact(self, corpus_version_id: str, chunk_ids: list[str]) -> list[RetrievedChunk]:
        if not chunk_ids:
            return []
        primary_records = self._records(corpus_version_id, chunk_ids)
        parent_ids = [
            str(metadata.get("parent_chunk_id") or "")
            for _, metadata in primary_records
            if str(metadata.get("parent_chunk_id") or "")
        ]
        referenced_ids = [
            related_id
            for _, metadata in primary_records
            for related_id in self._metadata_related_ids(metadata)
        ]
        primary_ids = {str(chunk_id) for chunk_id, _ in primary_records}
        parent_records = self._records(corpus_version_id, self._unique(parent_ids))
        referenced_records = self._records(
            corpus_version_id,
            self._unique(
                chunk_id
                for chunk_id in referenced_ids
                if chunk_id not in primary_ids and chunk_id not in set(parent_ids)
            ),
        )
        return [
            *self._to_chunks(primary_records, "PRIMARY_MATCH"),
            *self._to_chunks(parent_records, "PARENT_CONTEXT"),
            *self._to_chunks(referenced_records, "REFERENCED_CONTEXT"),
        ]

    def build_citation_allowlist(self, chunks: list[RetrievedChunk]) -> dict[str, Any]:
        allowlist = [chunk.id for chunk in chunks if chunk.legal_status != "REPEALED"]
        repealed = [chunk.id for chunk in chunks if chunk.legal_status == "REPEALED"]
        return {"allowlist": allowlist, "repealed_chunk_ids": repealed}

    def _collection(self, corpus_version_id: str):
        try:
            import chromadb
        except ImportError as error:
            raise RuntimeError("chromadb is required for legal retrieval") from error
        client = chromadb.PersistentClient(path=self._chroma_path)
        return client.get_or_create_collection(
            name=f"lcsp_legal_{corpus_version_id}",
            embedding_function=None,
        )

    def _records(
        self, corpus_version_id: str, chunk_ids: list[str]
    ) -> list[tuple[str, dict[str, Any]]]:
        if not chunk_ids:
            return []
        result = self._collection(corpus_version_id).get(
            ids=chunk_ids, include=["metadatas"]
        )
        return [
            (str(chunk_id), metadata or {})
            for chunk_id, metadata in zip(
                result.get("ids") or [],
                result.get("metadatas") or [],
                strict=True,
            )
        ]

    def _to_chunks(
        self, records: list[tuple[str, dict[str, Any]]], role: str
    ) -> list[RetrievedChunk]:
        return [
            RetrievedChunk(
                id=chunk_id,
                document_id=str(metadata.get("document_id") or ""),
                locator=str(metadata.get("locator") or ""),
                legal_status=str(metadata.get("legal_status") or "ACTIVE"),
                role=role,
            )
            for chunk_id, metadata in records
        ]

    def _metadata_related_ids(self, metadata: dict[str, Any]) -> list[str]:
        raw = metadata.get("related_chunk_ids")
        if not isinstance(raw, str):
            return []
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return []
        return [str(value) for value in parsed if str(value)] if isinstance(parsed, list) else []

    def _related_chunk_ids(self, hierarchy: dict[str, Any]) -> list[str]:
        values = [
            *(hierarchy.get("outgoingRefIds") or hierarchy.get("outgoing_ref_ids") or []),
            *(hierarchy.get("incomingRefIds") or hierarchy.get("incoming_ref_ids") or []),
        ]
        return self._unique(str(value) for value in values if str(value))

    def _unique(self, values: Any) -> list[str]:
        return list(dict.fromkeys(value for value in values if value))
