from __future__ import annotations

import json
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Any, Protocol

from .chunk_integrity_repository import ChunkIntegrityRepository
from .chroma_path import default_legal_chroma_path
from .chroma_vectorless import zero_embeddings
from .legal_chunk_repository import LegalChunkRepository, LegalChunkSetRecord
from .legal_retrieval_index_repository import LegalRetrievalIndexRecord
from .official_text_extraction import _sha256_bytes
from .relationship_manifest_repository import RelationshipManifestRepository

LEGAL_RETRIEVAL_INDEX_TOOL = {
    "name": "build_legal_retrieval_index",
    "version": "1.0.0",
    "config_hash": "sha256:chroma-structure-v1",
}

LEGAL_RETRIEVAL_INDEX_PROFILES = {
    "chroma_structure_v1": "CHROMA_STRUCTURE_V1",
}

LEGAL_RETRIEVAL_INDEX_STATUSES = {
    "ready": "READY",
    "needs_input": "NEEDS_INPUT",
    "conflict": "CONFLICT",
    "blocked": "BLOCKED",
    "failed": "FAILED",
}

LEGAL_RETRIEVAL_INDEX_COVERAGE_STATES = {
    "sufficient": "SUFFICIENT",
    "partial": "PARTIAL",
    "unavailable": "UNAVAILABLE",
}

LEGAL_RETRIEVAL_INDEX_LIMITATION_CODES = {
    "chunk_set_missing": "CHUNK_SET_MISSING",
    "integrity_manifest_missing": "INTEGRITY_MANIFEST_MISSING",
    "integrity_gate_blocked": "INTEGRITY_GATE_BLOCKED",
    "integrity_manifest_mismatch": "INTEGRITY_MANIFEST_MISMATCH",
    "chunk_artifact_missing": "CHUNK_ARTIFACT_MISSING",
    "invalid_chunk_metadata": "INVALID_CHUNK_METADATA",
    "chroma_write_failed": "CHROMA_WRITE_FAILED",
    "index_checksum_mismatch": "INDEX_CHECKSUM_MISMATCH",
}


class LegalIndexStore(Protocol):
    def replace_collection(self, *, collection_name: str, records: list[dict[str, Any]]) -> int:
        ...


class ChromaLegalIndexStore:
    def __init__(self, *, chroma_path: Path) -> None:
        self._chroma_path = chroma_path

    def replace_collection(
        self, *, collection_name: str, records: list[dict[str, Any]]
    ) -> int:
        try:
            import chromadb
        except ImportError as error:
            raise RuntimeError("chromadb is required for legal retrieval indexing") from error
        client = chromadb.PersistentClient(path=str(self._chroma_path))
        try:
            client.delete_collection(collection_name)
        except Exception:
            pass
        collection = client.get_or_create_collection(
            name=collection_name,
            embedding_function=None,
        )
        if records:
            collection.upsert(
                ids=[str(record["id"]) for record in records],
                documents=[str(record["document"]) for record in records],
                metadatas=[record["metadata"] for record in records],
                embeddings=zero_embeddings(len(records)),
            )
        return collection.count()


@dataclass(frozen=True)
class BuildLegalRetrievalIndexRequest:
    chunk_set_ref: str
    integrity_manifest_ref: str
    index_profile: str


@dataclass(frozen=True)
class LegalRetrievalIndexResult:
    status: str
    index_ref: str
    index_id: str
    provenance_ref: str
    chunk_set_ref: str
    integrity_manifest_ref: str
    index_profile: str
    coverage_state: str
    evidence_refs: list[str]
    limitations: list[dict[str, Any]]
    collection_name: str
    index_checksum: str
    indexed_chunk_count: int
    manifest_path: Path
    records_path: Path

    def to_tool_response(self, *, correlationId: str) -> dict[str, Any]:
        return {
            "status": self.status,
            "toolName": LEGAL_RETRIEVAL_INDEX_TOOL["name"],
            "toolVersion": LEGAL_RETRIEVAL_INDEX_TOOL["version"],
            "configHash": LEGAL_RETRIEVAL_INDEX_TOOL["config_hash"],
            "correlationId": correlationId,
            "artifactVersions": {
                "chunkSetId": self.chunk_set_ref.split(":", 1)[1],
                "indexId": self.index_id,
            },
            "provenanceRef": self.provenance_ref,
            "coverageState": self.coverage_state,
            "evidenceRefs": self.evidence_refs,
            "limitations": self.limitations,
            "result": {
                "indexRef": self.index_ref,
                "collectionName": self.collection_name,
                "indexChecksum": self.index_checksum,
                "indexedChunkCount": self.indexed_chunk_count,
                "profile": self.index_profile,
            },
        }

    def to_record(self) -> LegalRetrievalIndexRecord:
        return LegalRetrievalIndexRecord(
            index_ref=self.index_ref,
            provenance_ref=self.provenance_ref,
            chunk_set_ref=self.chunk_set_ref,
            integrity_manifest_ref=self.integrity_manifest_ref,
            index_profile=self.index_profile,
            status=self.status,
            coverage_state=self.coverage_state,
            collection_name=self.collection_name,
            index_checksum=self.index_checksum,
            indexed_chunk_count=self.indexed_chunk_count,
            evidence_refs=self.evidence_refs,
            limitations=self.limitations,
            manifest_path=str(self.manifest_path),
            records_path=str(self.records_path),
        )


class LegalRetrievalIndexBuilder:
    def __init__(
        self,
        *,
        storage_root: Path,
        chunk_repository: LegalChunkRepository,
        integrity_repository: ChunkIntegrityRepository,
        relationship_repository: RelationshipManifestRepository | None = None,
        index_store: LegalIndexStore | None = None,
    ) -> None:
        self._storage_root = storage_root
        self._chunk_repository = chunk_repository
        self._integrity_repository = integrity_repository
        self._relationship_repository = relationship_repository or RelationshipManifestRepository(
            storage_root=storage_root
        )
        self._index_store = index_store or ChromaLegalIndexStore(
            chroma_path=default_legal_chroma_path()
        )

    def build(self, request: BuildLegalRetrievalIndexRequest) -> LegalRetrievalIndexResult:
        profile = self._normalize_profile(request.index_profile)
        index_id = _index_id(
            chunk_set_ref=request.chunk_set_ref,
            integrity_manifest_ref=request.integrity_manifest_ref,
            index_profile=profile,
        )
        index_ref = f"legal-index:{index_id}"
        provenance_ref = f"prov:index-build:{index_id}"
        collection_name = f"legal_chunks_{request.chunk_set_ref.split(':', 1)[1]}"

        existing = self._load_existing(index_ref=index_ref)
        if existing is not None:
            return existing

        integrity_record = self._integrity_repository.get_by_validation_manifest_ref(
            request.integrity_manifest_ref
        )
        if integrity_record is None:
            return self._problem_result(
                status=LEGAL_RETRIEVAL_INDEX_STATUSES["needs_input"],
                coverage_state=LEGAL_RETRIEVAL_INDEX_COVERAGE_STATES["partial"],
                index_id=index_id,
                index_ref=index_ref,
                provenance_ref=provenance_ref,
                request=request,
                code=LEGAL_RETRIEVAL_INDEX_LIMITATION_CODES["integrity_manifest_missing"],
                reason="integrity manifest record was not found",
                collection_name=collection_name,
            )
        if integrity_record.chunk_set_ref != request.chunk_set_ref:
            return self._problem_result(
                status=LEGAL_RETRIEVAL_INDEX_STATUSES["needs_input"],
                coverage_state=LEGAL_RETRIEVAL_INDEX_COVERAGE_STATES["partial"],
                index_id=index_id,
                index_ref=index_ref,
                provenance_ref=provenance_ref,
                request=request,
                code=LEGAL_RETRIEVAL_INDEX_LIMITATION_CODES["integrity_manifest_mismatch"],
                reason="integrity manifest does not belong to the requested chunk set",
                collection_name=collection_name,
            )
        if integrity_record.status != "READY" or integrity_record.decision != "PASS":
            return self._problem_result(
                status=LEGAL_RETRIEVAL_INDEX_STATUSES["blocked"],
                coverage_state=LEGAL_RETRIEVAL_INDEX_COVERAGE_STATES["unavailable"],
                index_id=index_id,
                index_ref=index_ref,
                provenance_ref=provenance_ref,
                request=request,
                code=LEGAL_RETRIEVAL_INDEX_LIMITATION_CODES["integrity_gate_blocked"],
                reason="integrity gate did not pass for the requested chunk set",
                collection_name=collection_name,
                evidence_refs=[request.integrity_manifest_ref],
            )
        relationship_record = self._relationship_repository.get_by_relationship_manifest_ref(
            integrity_record.relationship_manifest_ref
        )

        chunk_record = self._chunk_repository.get_by_chunk_set_ref(request.chunk_set_ref)
        if chunk_record is None:
            return self._problem_result(
                status=LEGAL_RETRIEVAL_INDEX_STATUSES["needs_input"],
                coverage_state=LEGAL_RETRIEVAL_INDEX_COVERAGE_STATES["partial"],
                index_id=index_id,
                index_ref=index_ref,
                provenance_ref=provenance_ref,
                request=request,
                code=LEGAL_RETRIEVAL_INDEX_LIMITATION_CODES["chunk_set_missing"],
                reason="chunk set record was not found",
                collection_name=collection_name,
                evidence_refs=[request.integrity_manifest_ref],
            )

        chunks, issue = self._load_chunks(chunk_record)
        if issue is not None:
            return self._problem_result(
                status=issue["status"],
                coverage_state=issue["coverage_state"],
                index_id=index_id,
                index_ref=index_ref,
                provenance_ref=provenance_ref,
                request=request,
                code=issue["code"],
                reason=issue["reason"],
                collection_name=collection_name,
                evidence_refs=[request.integrity_manifest_ref],
            )

        records = [
            self._to_index_record(
                chunk,
                source_effect_status=(
                    relationship_record.source_effect_status
                    if relationship_record is not None
                    else ""
                ),
            )
            for chunk in chunks
        ]
        records_json = json.dumps(records, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
        index_checksum = _sha256_bytes(records_json.encode("utf-8"))
        output_dir = self._storage_root / "legal-indexes" / index_id
        output_dir.mkdir(parents=True, exist_ok=True)
        records_path = output_dir / "records.json"
        manifest_path = output_dir / "manifest.json"
        records_path.write_text(records_json, encoding="utf-8")

        try:
            indexed_count = self._index_store.replace_collection(
                collection_name=collection_name,
                records=records,
            )
        except Exception as exc:
            return self._problem_result(
                status=LEGAL_RETRIEVAL_INDEX_STATUSES["failed"],
                coverage_state=LEGAL_RETRIEVAL_INDEX_COVERAGE_STATES["unavailable"],
                index_id=index_id,
                index_ref=index_ref,
                provenance_ref=provenance_ref,
                request=request,
                code=LEGAL_RETRIEVAL_INDEX_LIMITATION_CODES["chroma_write_failed"],
                reason=str(exc),
                collection_name=collection_name,
                evidence_refs=[request.integrity_manifest_ref],
            )
        if indexed_count != len(records):
            return self._problem_result(
                status=LEGAL_RETRIEVAL_INDEX_STATUSES["conflict"],
                coverage_state=LEGAL_RETRIEVAL_INDEX_COVERAGE_STATES["unavailable"],
                index_id=index_id,
                index_ref=index_ref,
                provenance_ref=provenance_ref,
                request=request,
                code=LEGAL_RETRIEVAL_INDEX_LIMITATION_CODES["index_checksum_mismatch"],
                reason="indexed count does not match the deterministic record set",
                collection_name=collection_name,
                evidence_refs=[request.integrity_manifest_ref],
            )

        manifest_path.write_text(
            json.dumps(
                {
                    "indexRef": index_ref,
                    "provenanceRef": provenance_ref,
                    "chunkSetRef": request.chunk_set_ref,
                    "integrityManifestRef": request.integrity_manifest_ref,
                    "indexProfile": profile,
                    "collectionName": collection_name,
                    "indexChecksum": index_checksum,
                    "indexedChunkCount": indexed_count,
                    "recordsFile": records_path.name,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        return LegalRetrievalIndexResult(
            status=LEGAL_RETRIEVAL_INDEX_STATUSES["ready"],
            index_ref=index_ref,
            index_id=index_id,
            provenance_ref=provenance_ref,
            chunk_set_ref=request.chunk_set_ref,
            integrity_manifest_ref=request.integrity_manifest_ref,
            index_profile=profile,
            coverage_state=LEGAL_RETRIEVAL_INDEX_COVERAGE_STATES["sufficient"],
            evidence_refs=[f"{index_ref}:{index_checksum}", request.integrity_manifest_ref],
            limitations=[],
            collection_name=collection_name,
            index_checksum=index_checksum,
            indexed_chunk_count=indexed_count,
            manifest_path=manifest_path,
            records_path=records_path,
        )

    def _load_existing(self, *, index_ref: str) -> LegalRetrievalIndexResult | None:
        manifest_path = (
            self._storage_root
            / "legal-indexes"
            / "registry"
            / "index-refs"
            / f"{index_ref.replace(':', '__')}.json"
        )
        if not manifest_path.is_file():
            return None
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        return LegalRetrievalIndexResult(
            status=str(payload["status"]),
            index_ref=str(payload["indexRef"]),
            index_id=str(payload["indexRef"]).split(":", 1)[1],
            provenance_ref=str(payload["provenanceRef"]),
            chunk_set_ref=str(payload["chunkSetRef"]),
            integrity_manifest_ref=str(payload["integrityManifestRef"]),
            index_profile=str(payload["indexProfile"]),
            coverage_state=str(payload["coverageState"]),
            evidence_refs=[str(value) for value in payload.get("evidenceRefs", [])],
            limitations=[
                item for item in payload.get("limitations", []) if isinstance(item, dict)
            ],
            collection_name=str(payload["collectionName"]),
            index_checksum=str(payload["indexChecksum"]),
            indexed_chunk_count=int(payload["indexedChunkCount"]),
            manifest_path=Path(str(payload["manifestPath"])),
            records_path=Path(str(payload["recordsPath"])),
        )

    def _normalize_profile(self, profile: str) -> str:
        normalized = profile.strip().upper()
        if normalized != LEGAL_RETRIEVAL_INDEX_PROFILES["chroma_structure_v1"]:
            raise ValueError("unsupported index profile")
        return normalized

    def _load_chunks(
        self, chunk_record: LegalChunkSetRecord
    ) -> tuple[list[dict[str, Any]], dict[str, str] | None]:
        chunks_path = Path(chunk_record.chunks_path)
        if not chunks_path.is_file():
            return [], {
                "status": LEGAL_RETRIEVAL_INDEX_STATUSES["needs_input"],
                "coverage_state": LEGAL_RETRIEVAL_INDEX_COVERAGE_STATES["partial"],
                "code": LEGAL_RETRIEVAL_INDEX_LIMITATION_CODES["chunk_artifact_missing"],
                "reason": "chunk payload file is missing from storage",
            }
        payload = json.loads(chunks_path.read_text(encoding="utf-8"))
        if not isinstance(payload, list):
            raise RuntimeError("chunk payload must be a JSON list")
        return [item for item in payload if isinstance(item, dict)], None

    def _to_index_record(
        self, chunk: dict[str, Any], *, source_effect_status: str
    ) -> dict[str, Any]:
        chunk_id = str(chunk.get("id", "")).strip()
        content = str(chunk.get("content", "")).strip()
        locator = str(chunk.get("locator", "")).strip()
        hierarchy = chunk.get("hierarchy", {})
        if not chunk_id or not content or not locator or not isinstance(hierarchy, dict):
            raise RuntimeError("invalid chunk metadata")
        effect_metadata = _effect_metadata(hierarchy.get("legalEffectObservations"))
        metadata = {
            "corpus_version_id": "",
            "doc_id": chunk_id.split(":", 1)[0],
            "document_number": str(hierarchy.get("documentNumber", "")),
            "document_title": str(hierarchy.get("documentTitle", "")),
            "document_type": str(hierarchy.get("documentType", "")),
            "issuing_authority": str(hierarchy.get("issuingAuthority", "")),
            "article_id": f"{chunk_id.split('::cl-',1)[0].split('::pt-',1)[0]}" if "::art-" in chunk_id or ":art-" in chunk_id else "",
            "article_number": str(hierarchy.get("articleNumber", "")),
            "article_title": str(hierarchy.get("articleTitle", "")),
            "clause_id": str(hierarchy.get("parentChunkId", "")) if "::cl-" in locator or "::pt-" in locator else "",
            "clause_number": str(hierarchy.get("clauseNumber", "")),
            "point_id": chunk_id if "::pt-" in locator else "",
            "point_code": str(hierarchy.get("pointCode", "")),
            "hierarchical_path": locator,
            "effective_from": str(hierarchy.get("effectiveFrom", "")),
            "effective_to": str(hierarchy.get("effectiveTo", "")),
            "legal_status": str(chunk.get("legalStatus", "ACTIVE")),
            "source_effect_status": str(
                hierarchy.get("sourceEffectStatus", "") or source_effect_status
            ),
            "source_url": str(hierarchy.get("sourceUrl", "")),
            "source_checksum": str(hierarchy.get("sourceChecksum", "")),
            "chunk_checksum": str(chunk.get("contentSha256", "")),
            "outgoing_ref_ids": json.dumps(hierarchy.get("outgoingRefIds", [])),
            "incoming_ref_ids": json.dumps(hierarchy.get("incomingRefIds", [])),
            "supersedes_chunk_id": str(hierarchy.get("supersedesChunkId", "")),
            "repealed_by_ref": json.dumps(hierarchy.get("repealedByRef", {})),
            **effect_metadata,
        }
        return {"id": chunk_id, "document": content, "metadata": metadata}

    def _problem_result(
        self,
        *,
        status: str,
        coverage_state: str,
        index_id: str,
        index_ref: str,
        provenance_ref: str,
        request: BuildLegalRetrievalIndexRequest,
        code: str,
        reason: str,
        collection_name: str,
        evidence_refs: list[str] | None = None,
    ) -> LegalRetrievalIndexResult:
        output_dir = self._storage_root / "legal-indexes" / index_id
        output_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = output_dir / "manifest.json"
        records_path = output_dir / "records.json"
        if not records_path.exists():
            records_path.write_text("[]\n", encoding="utf-8")
        manifest_path.write_text(
            json.dumps(
                {
                    "indexRef": index_ref,
                    "provenanceRef": provenance_ref,
                    "chunkSetRef": request.chunk_set_ref,
                    "integrityManifestRef": request.integrity_manifest_ref,
                    "indexProfile": request.index_profile,
                    "status": status,
                    "coverageState": coverage_state,
                    "collectionName": collection_name,
                    "indexChecksum": _sha256_bytes(b"[]\n"),
                    "indexedChunkCount": 0,
                    "limitations": [
                        _limitation(code=code, scope_ref=request.chunk_set_ref, reason=reason)
                    ],
                    "recordsFile": records_path.name,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        return LegalRetrievalIndexResult(
            status=status,
            index_ref=index_ref,
            index_id=index_id,
            provenance_ref=provenance_ref,
            chunk_set_ref=request.chunk_set_ref,
            integrity_manifest_ref=request.integrity_manifest_ref,
            index_profile=request.index_profile,
            coverage_state=coverage_state,
            evidence_refs=evidence_refs or [],
            limitations=[_limitation(code=code, scope_ref=request.chunk_set_ref, reason=reason)],
            collection_name=collection_name,
            index_checksum=_sha256_bytes(b"[]\n"),
            indexed_chunk_count=0,
            manifest_path=manifest_path,
            records_path=records_path,
        )


def _index_id(
    *, chunk_set_ref: str, integrity_manifest_ref: str, index_profile: str
) -> str:
    return sha256(
        f"{chunk_set_ref}|{integrity_manifest_ref}|{index_profile}".encode("utf-8")
    ).hexdigest()[:24]


def _effect_metadata(value: Any) -> dict[str, Any]:
    observations = value if isinstance(value, list) else []
    effect_kinds: list[str] = []
    type_codes: list[str] = []
    type_refs: list[str] = []
    new_type_codes: list[str] = []
    new_type_refs: list[str] = []
    review_required = False
    for observation in observations:
        if not isinstance(observation, dict):
            continue
        effect_kind = str(observation.get("effectKind") or "").strip()
        if effect_kind:
            effect_kinds.append(effect_kind)
        marker = observation.get("type")
        if isinstance(marker, dict):
            type_code = str(marker.get("typeCode") or "").strip()
            type_ref = str(marker.get("typeRef") or "").strip()
            if type_code:
                type_codes.append(type_code)
            if type_ref:
                type_refs.append(type_ref)
        new_marker = observation.get("newType")
        if isinstance(new_marker, dict):
            new_type_code = str(new_marker.get("typeCode") or "").strip()
            new_type_ref = str(new_marker.get("typeRef") or "").strip()
            if new_type_code:
                new_type_codes.append(new_type_code)
            if new_type_ref:
                new_type_refs.append(new_type_ref)
        review_required = review_required or bool(observation.get("reviewRequired"))
    return {
        "effect_kinds": json.dumps(_unique(effect_kinds)),
        "effect_type_codes": json.dumps(_unique(type_codes)),
        "effect_type_refs": json.dumps(_unique(type_refs)),
        "effect_new_type_codes": json.dumps(_unique(new_type_codes)),
        "effect_new_type_refs": json.dumps(_unique(new_type_refs)),
        "effect_observation_count": len(
            [item for item in observations if isinstance(item, dict)]
        ),
        "effect_review_required": "true" if review_required else "false",
    }


def _unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _limitation(*, code: str, scope_ref: str | None, reason: str) -> dict[str, Any]:
    return {
        "code": code,
        "affectedScopeRef": scope_ref,
        "reason": reason,
        "retryable": False,
    }
