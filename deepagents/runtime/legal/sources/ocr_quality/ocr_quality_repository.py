from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class OcrQualityRecord:
    quality_manifest_ref: str
    provenance_ref: str
    extraction_ref: str
    expected_identity_ref: str
    quality_profile: str
    status: str
    coverage_state: str
    decision: str
    checked: dict[str, bool]
    minimum_confidence: float
    finding_refs: list[str]
    evidence_refs: list[str]
    limitations: list[dict[str, Any]]

    def to_json(self) -> dict[str, Any]:
        return {
            "qualityManifestRef": self.quality_manifest_ref,
            "provenanceRef": self.provenance_ref,
            "extractionRef": self.extraction_ref,
            "expectedIdentityRef": self.expected_identity_ref,
            "qualityProfile": self.quality_profile,
            "status": self.status,
            "coverageState": self.coverage_state,
            "decision": self.decision,
            "checked": self.checked,
            "minimumConfidence": self.minimum_confidence,
            "findingRefs": self.finding_refs,
            "evidenceRefs": self.evidence_refs,
            "limitations": self.limitations,
        }

    @classmethod
    def from_json(cls, payload: dict[str, Any]) -> "OcrQualityRecord":
        return cls(
            quality_manifest_ref=str(payload["qualityManifestRef"]),
            provenance_ref=str(payload["provenanceRef"]),
            extraction_ref=str(payload["extractionRef"]),
            expected_identity_ref=str(payload["expectedIdentityRef"]),
            quality_profile=str(payload["qualityProfile"]),
            status=str(payload["status"]),
            coverage_state=str(payload["coverageState"]),
            decision=str(payload["decision"]),
            checked={
                "pageContinuity": bool(payload.get("checked", {}).get("pageContinuity")),
                "identity": bool(payload.get("checked", {}).get("identity")),
                "numbering": bool(payload.get("checked", {}).get("numbering")),
                "hierarchy": bool(payload.get("checked", {}).get("hierarchy")),
            },
            minimum_confidence=float(payload["minimumConfidence"]),
            finding_refs=[str(value) for value in payload.get("findingRefs", [])],
            evidence_refs=[str(value) for value in payload.get("evidenceRefs", [])],
            limitations=[
                item for item in payload.get("limitations", []) if isinstance(item, dict)
            ],
        )


class OcrQualityRepository:
    def __init__(self, *, storage_root: Path) -> None:
        self._storage_root = storage_root

    def save(self, record: OcrQualityRecord) -> OcrQualityRecord:
        payload = record.to_json()
        self._write_json(self._path_for_manifest_ref(record.quality_manifest_ref), payload)
        self._write_json(self._path_for_provenance_ref(record.provenance_ref), payload)
        return record

    def get_by_quality_manifest_ref(
        self, quality_manifest_ref: str
    ) -> OcrQualityRecord | None:
        path = self._path_for_manifest_ref(quality_manifest_ref)
        if not path.is_file():
            return None
        return OcrQualityRecord.from_json(json.loads(path.read_text(encoding="utf-8")))

    def get_by_provenance_ref(self, provenance_ref: str) -> OcrQualityRecord | None:
        path = self._path_for_provenance_ref(provenance_ref)
        if not path.is_file():
            return None
        return OcrQualityRecord.from_json(json.loads(path.read_text(encoding="utf-8")))

    def _path_for_manifest_ref(self, quality_manifest_ref: str) -> Path:
        return (
            self._storage_root
            / "official-ocr-quality"
            / "registry"
            / "manifests"
            / f"{_safe_ref(quality_manifest_ref)}.json"
        )

    def _path_for_provenance_ref(self, provenance_ref: str) -> Path:
        return (
            self._storage_root
            / "official-ocr-quality"
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
