from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class LegalRetrievalIndexRecord:
    index_ref: str
    provenance_ref: str
    chunk_set_ref: str
    integrity_manifest_ref: str
    index_profile: str
    status: str
    coverage_state: str
    collection_name: str
    index_checksum: str
    indexed_chunk_count: int
    evidence_refs: list[str]
    limitations: list[dict[str, Any]]
    manifest_path: str
    records_path: str

    def to_json(self) -> dict[str, Any]:
        return {
            "indexRef": self.index_ref,
            "provenanceRef": self.provenance_ref,
            "chunkSetRef": self.chunk_set_ref,
            "integrityManifestRef": self.integrity_manifest_ref,
            "indexProfile": self.index_profile,
            "status": self.status,
            "coverageState": self.coverage_state,
            "collectionName": self.collection_name,
            "indexChecksum": self.index_checksum,
            "indexedChunkCount": self.indexed_chunk_count,
            "evidenceRefs": self.evidence_refs,
            "limitations": self.limitations,
            "manifestPath": self.manifest_path,
            "recordsPath": self.records_path,
        }

    @classmethod
    def from_json(cls, payload: dict[str, Any]) -> "LegalRetrievalIndexRecord":
        return cls(
            index_ref=str(payload["indexRef"]),
            provenance_ref=str(payload["provenanceRef"]),
            chunk_set_ref=str(payload["chunkSetRef"]),
            integrity_manifest_ref=str(payload["integrityManifestRef"]),
            index_profile=str(payload["indexProfile"]),
            status=str(payload["status"]),
            coverage_state=str(payload["coverageState"]),
            collection_name=str(payload["collectionName"]),
            index_checksum=str(payload["indexChecksum"]),
            indexed_chunk_count=int(payload["indexedChunkCount"]),
            evidence_refs=[str(value) for value in payload.get("evidenceRefs", [])],
            limitations=[
                item for item in payload.get("limitations", []) if isinstance(item, dict)
            ],
            manifest_path=str(payload["manifestPath"]),
            records_path=str(payload["recordsPath"]),
        )


class LegalRetrievalIndexRepository:
    def __init__(self, *, storage_root: Path) -> None:
        self._storage_root = storage_root

    def save(self, record: LegalRetrievalIndexRecord) -> LegalRetrievalIndexRecord:
        payload = record.to_json()
        self._write_json(self._path_for_index_ref(record.index_ref), payload)
        self._write_json(self._path_for_provenance_ref(record.provenance_ref), payload)
        return record

    def get_by_index_ref(self, index_ref: str) -> LegalRetrievalIndexRecord | None:
        path = self._path_for_index_ref(index_ref)
        if not path.is_file():
            return None
        return LegalRetrievalIndexRecord.from_json(
            json.loads(path.read_text(encoding="utf-8"))
        )

    def get_by_provenance_ref(
        self, provenance_ref: str
    ) -> LegalRetrievalIndexRecord | None:
        path = self._path_for_provenance_ref(provenance_ref)
        if not path.is_file():
            return None
        return LegalRetrievalIndexRecord.from_json(
            json.loads(path.read_text(encoding="utf-8"))
        )

    def _path_for_index_ref(self, index_ref: str) -> Path:
        return (
            self._storage_root
            / "legal-indexes"
            / "registry"
            / "index-refs"
            / f"{_safe_ref(index_ref)}.json"
        )

    def _path_for_provenance_ref(self, provenance_ref: str) -> Path:
        return (
            self._storage_root
            / "legal-indexes"
            / "registry"
            / "provenance"
            / f"{_safe_ref(provenance_ref)}.json"
        )

    @staticmethod
    def _write_json(path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )


def _safe_ref(value: str) -> str:
    return value.replace(":", "__")
