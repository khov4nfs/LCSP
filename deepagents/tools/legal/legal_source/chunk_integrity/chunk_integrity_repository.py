from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ChunkIntegrityRecord:
    validation_manifest_ref: str
    provenance_ref: str
    chunk_set_ref: str
    relationship_manifest_ref: str
    validation_profile: str
    status: str
    coverage_state: str
    decision: str
    checked_rules: list[str]
    finding_refs: list[str]
    evidence_refs: list[str]
    limitations: list[dict[str, Any]]
    manifest_path: str
    findings_path: str

    def to_json(self) -> dict[str, Any]:
        return {
            "validationManifestRef": self.validation_manifest_ref,
            "provenanceRef": self.provenance_ref,
            "chunkSetRef": self.chunk_set_ref,
            "relationshipManifestRef": self.relationship_manifest_ref,
            "validationProfile": self.validation_profile,
            "status": self.status,
            "coverageState": self.coverage_state,
            "decision": self.decision,
            "checkedRules": self.checked_rules,
            "findingRefs": self.finding_refs,
            "evidenceRefs": self.evidence_refs,
            "limitations": self.limitations,
            "manifestPath": self.manifest_path,
            "findingsPath": self.findings_path,
        }

    @classmethod
    def from_json(cls, payload: dict[str, Any]) -> "ChunkIntegrityRecord":
        return cls(
            validation_manifest_ref=str(payload["validationManifestRef"]),
            provenance_ref=str(payload["provenanceRef"]),
            chunk_set_ref=str(payload["chunkSetRef"]),
            relationship_manifest_ref=str(payload["relationshipManifestRef"]),
            validation_profile=str(payload["validationProfile"]),
            status=str(payload["status"]),
            coverage_state=str(payload["coverageState"]),
            decision=str(payload["decision"]),
            checked_rules=[str(value) for value in payload.get("checkedRules", [])],
            finding_refs=[str(value) for value in payload.get("findingRefs", [])],
            evidence_refs=[str(value) for value in payload.get("evidenceRefs", [])],
            limitations=[
                item for item in payload.get("limitations", []) if isinstance(item, dict)
            ],
            manifest_path=str(payload["manifestPath"]),
            findings_path=str(payload["findingsPath"]),
        )


class ChunkIntegrityRepository:
    def __init__(self, *, storage_root: Path) -> None:
        self._storage_root = storage_root

    def save(self, record: ChunkIntegrityRecord) -> ChunkIntegrityRecord:
        payload = record.to_json()
        self._write_json(
            self._path_for_validation_manifest_ref(record.validation_manifest_ref),
            payload,
        )
        self._write_json(self._path_for_provenance_ref(record.provenance_ref), payload)
        return record

    def get_by_validation_manifest_ref(
        self, validation_manifest_ref: str
    ) -> ChunkIntegrityRecord | None:
        path = self._path_for_validation_manifest_ref(validation_manifest_ref)
        if not path.is_file():
            return None
        return ChunkIntegrityRecord.from_json(
            json.loads(path.read_text(encoding="utf-8"))
        )

    def get_by_provenance_ref(self, provenance_ref: str) -> ChunkIntegrityRecord | None:
        path = self._path_for_provenance_ref(provenance_ref)
        if not path.is_file():
            return None
        return ChunkIntegrityRecord.from_json(
            json.loads(path.read_text(encoding="utf-8"))
        )

    def _path_for_validation_manifest_ref(self, validation_manifest_ref: str) -> Path:
        return (
            self._storage_root
            / "chunk-integrity-manifests"
            / "registry"
            / "integrity-manifests"
            / f"{_safe_ref(validation_manifest_ref)}.json"
        )

    def _path_for_provenance_ref(self, provenance_ref: str) -> Path:
        return (
            self._storage_root
            / "chunk-integrity-manifests"
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
