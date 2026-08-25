from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class RelationshipManifestRecord:
    relationship_manifest_ref: str
    provenance_ref: str
    chunk_set_ref: str | None
    target_document_id: str
    source_effect_status: str
    materialized_relationships: list[dict[str, Any]]
    evidence_refs: list[str]
    limitations: list[dict[str, Any]]
    manifest_path: str

    def to_json(self) -> dict[str, Any]:
        return {
            "relationshipManifestRef": self.relationship_manifest_ref,
            "provenanceRef": self.provenance_ref,
            "chunkSetRef": self.chunk_set_ref,
            "targetDocumentId": self.target_document_id,
            "sourceEffectStatus": self.source_effect_status,
            "materializedRelationships": self.materialized_relationships,
            "evidenceRefs": self.evidence_refs,
            "limitations": self.limitations,
            "manifestPath": self.manifest_path,
        }

    @classmethod
    def from_json(cls, payload: dict[str, Any]) -> "RelationshipManifestRecord":
        return cls(
            relationship_manifest_ref=str(payload["relationshipManifestRef"]),
            provenance_ref=str(payload["provenanceRef"]),
            chunk_set_ref=(
                str(payload["chunkSetRef"])
                if isinstance(payload.get("chunkSetRef"), str)
                and payload["chunkSetRef"]
                else None
            ),
            target_document_id=str(payload["targetDocumentId"]),
            source_effect_status=str(payload["sourceEffectStatus"]),
            materialized_relationships=[
                item
                for item in payload.get("materializedRelationships", [])
                if isinstance(item, dict)
            ],
            evidence_refs=[str(value) for value in payload.get("evidenceRefs", [])],
            limitations=[
                item for item in payload.get("limitations", []) if isinstance(item, dict)
            ],
            manifest_path=str(payload["manifestPath"]),
        )


class RelationshipManifestRepository:
    def __init__(self, *, storage_root: Path) -> None:
        self._storage_root = storage_root

    def save(self, record: RelationshipManifestRecord) -> RelationshipManifestRecord:
        payload = record.to_json()
        self._write_json(
            self._path_for_relationship_manifest_ref(record.relationship_manifest_ref),
            payload,
        )
        self._write_json(self._path_for_provenance_ref(record.provenance_ref), payload)
        return record

    def get_by_relationship_manifest_ref(
        self, relationship_manifest_ref: str
    ) -> RelationshipManifestRecord | None:
        path = self._path_for_relationship_manifest_ref(relationship_manifest_ref)
        if not path.is_file():
            return None
        return RelationshipManifestRecord.from_json(
            json.loads(path.read_text(encoding="utf-8"))
        )

    def get_by_provenance_ref(
        self, provenance_ref: str
    ) -> RelationshipManifestRecord | None:
        path = self._path_for_provenance_ref(provenance_ref)
        if not path.is_file():
            return None
        return RelationshipManifestRecord.from_json(
            json.loads(path.read_text(encoding="utf-8"))
        )

    def _path_for_relationship_manifest_ref(self, relationship_manifest_ref: str) -> Path:
        return (
            self._storage_root
            / "relationship-manifests"
            / "registry"
            / "relationship-manifests"
            / f"{_safe_ref(relationship_manifest_ref)}.json"
        )

    def _path_for_provenance_ref(self, provenance_ref: str) -> Path:
        return (
            self._storage_root
            / "relationship-manifests"
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
