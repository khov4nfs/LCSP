from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class LegalChunkSetRecord:
    chunk_set_ref: str
    provenance_ref: str
    reviewed_input_ref: str
    document_identity_ref: str
    chunk_schema_version: str
    status: str
    coverage_state: str
    chunk_count: int
    chunk_manifest_sha256: str
    document_id: str
    chunks_path: str
    manifest_path: str
    evidence_refs: list[str]
    limitations: list[dict[str, Any]]

    def to_json(self) -> dict[str, Any]:
        return {
            "chunkSetRef": self.chunk_set_ref,
            "provenanceRef": self.provenance_ref,
            "reviewedInputRef": self.reviewed_input_ref,
            "documentIdentityRef": self.document_identity_ref,
            "chunkSchemaVersion": self.chunk_schema_version,
            "status": self.status,
            "coverageState": self.coverage_state,
            "chunkCount": self.chunk_count,
            "chunkManifestSha256": self.chunk_manifest_sha256,
            "documentId": self.document_id,
            "chunksPath": self.chunks_path,
            "manifestPath": self.manifest_path,
            "evidenceRefs": self.evidence_refs,
            "limitations": self.limitations,
        }

    @classmethod
    def from_json(cls, payload: dict[str, Any]) -> "LegalChunkSetRecord":
        return cls(
            chunk_set_ref=str(payload["chunkSetRef"]),
            provenance_ref=str(payload["provenanceRef"]),
            reviewed_input_ref=str(payload["reviewedInputRef"]),
            document_identity_ref=str(payload["documentIdentityRef"]),
            chunk_schema_version=str(payload["chunkSchemaVersion"]),
            status=str(payload["status"]),
            coverage_state=str(payload["coverageState"]),
            chunk_count=int(payload["chunkCount"]),
            chunk_manifest_sha256=str(payload["chunkManifestSha256"]),
            document_id=str(payload["documentId"]),
            chunks_path=str(payload["chunksPath"]),
            manifest_path=str(payload["manifestPath"]),
            evidence_refs=[str(value) for value in payload.get("evidenceRefs", [])],
            limitations=[
                item for item in payload.get("limitations", []) if isinstance(item, dict)
            ],
        )


class LegalChunkRepository:
    def __init__(self, *, storage_root: Path) -> None:
        self._storage_root = storage_root

    def save(self, record: LegalChunkSetRecord) -> LegalChunkSetRecord:
        payload = record.to_json()
        self._write_json(self._path_for_chunk_set_ref(record.chunk_set_ref), payload)
        self._write_json(self._path_for_provenance_ref(record.provenance_ref), payload)
        return record

    def get_by_chunk_set_ref(self, chunk_set_ref: str) -> LegalChunkSetRecord | None:
        path = self._path_for_chunk_set_ref(chunk_set_ref)
        if not path.is_file():
            return None
        return LegalChunkSetRecord.from_json(json.loads(path.read_text(encoding="utf-8")))

    def get_by_provenance_ref(self, provenance_ref: str) -> LegalChunkSetRecord | None:
        path = self._path_for_provenance_ref(provenance_ref)
        if not path.is_file():
            return None
        return LegalChunkSetRecord.from_json(json.loads(path.read_text(encoding="utf-8")))

    def _path_for_chunk_set_ref(self, chunk_set_ref: str) -> Path:
        return (
            self._storage_root
            / "legal-chunk-sets"
            / "registry"
            / "chunk-sets"
            / f"{_safe_ref(chunk_set_ref)}.json"
        )

    def _path_for_provenance_ref(self, provenance_ref: str) -> Path:
        return (
            self._storage_root
            / "legal-chunk-sets"
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
