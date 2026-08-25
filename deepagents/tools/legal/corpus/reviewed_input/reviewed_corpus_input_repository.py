from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ReviewedCorpusInputRecord:
    reviewed_input_ref: str
    provenance_ref: str
    extraction_ref: str
    quality_manifest_ref: str
    correction_profile: str
    status: str
    coverage_state: str
    content_sha256: str
    quality_decision: str
    manual_approval_required: bool
    document_id: str
    snapshot_ref: str
    source_kind: str
    normalized_text_path: str
    manifest_path: str
    evidence_refs: list[str]
    limitations: list[dict[str, Any]]

    def to_json(self) -> dict[str, Any]:
        return {
            "reviewedInputRef": self.reviewed_input_ref,
            "provenanceRef": self.provenance_ref,
            "extractionRef": self.extraction_ref,
            "qualityManifestRef": self.quality_manifest_ref,
            "correctionProfile": self.correction_profile,
            "status": self.status,
            "coverageState": self.coverage_state,
            "contentSha256": self.content_sha256,
            "qualityDecision": self.quality_decision,
            "manualApprovalRequired": self.manual_approval_required,
            "documentId": self.document_id,
            "snapshotRef": self.snapshot_ref,
            "sourceKind": self.source_kind,
            "normalizedTextPath": self.normalized_text_path,
            "manifestPath": self.manifest_path,
            "evidenceRefs": self.evidence_refs,
            "limitations": self.limitations,
        }

    @classmethod
    def from_json(cls, payload: dict[str, Any]) -> "ReviewedCorpusInputRecord":
        return cls(
            reviewed_input_ref=str(payload["reviewedInputRef"]),
            provenance_ref=str(payload["provenanceRef"]),
            extraction_ref=str(payload["extractionRef"]),
            quality_manifest_ref=str(payload["qualityManifestRef"]),
            correction_profile=str(payload["correctionProfile"]),
            status=str(payload["status"]),
            coverage_state=str(payload["coverageState"]),
            content_sha256=str(payload["contentSha256"]),
            quality_decision=str(payload["qualityDecision"]),
            manual_approval_required=bool(payload["manualApprovalRequired"]),
            document_id=str(payload["documentId"]),
            snapshot_ref=str(payload["snapshotRef"]),
            source_kind=str(payload["sourceKind"]),
            normalized_text_path=str(payload["normalizedTextPath"]),
            manifest_path=str(payload["manifestPath"]),
            evidence_refs=[str(value) for value in payload.get("evidenceRefs", [])],
            limitations=[
                item for item in payload.get("limitations", []) if isinstance(item, dict)
            ],
        )


class ReviewedCorpusInputRepository:
    def __init__(self, *, storage_root: Path) -> None:
        self._storage_root = storage_root

    def save(self, record: ReviewedCorpusInputRecord) -> ReviewedCorpusInputRecord:
        payload = record.to_json()
        self._write_json(
            self._path_for_reviewed_input_ref(record.reviewed_input_ref), payload
        )
        self._write_json(self._path_for_provenance_ref(record.provenance_ref), payload)
        return record

    def get_by_reviewed_input_ref(
        self, reviewed_input_ref: str
    ) -> ReviewedCorpusInputRecord | None:
        path = self._path_for_reviewed_input_ref(reviewed_input_ref)
        if not path.is_file():
            return None
        return ReviewedCorpusInputRecord.from_json(
            json.loads(path.read_text(encoding="utf-8"))
        )

    def get_by_provenance_ref(
        self, provenance_ref: str
    ) -> ReviewedCorpusInputRecord | None:
        path = self._path_for_provenance_ref(provenance_ref)
        if not path.is_file():
            return None
        return ReviewedCorpusInputRecord.from_json(
            json.loads(path.read_text(encoding="utf-8"))
        )

    def _path_for_reviewed_input_ref(self, reviewed_input_ref: str) -> Path:
        return (
            self._storage_root
            / "reviewed-corpus-inputs"
            / "registry"
            / "reviewed-inputs"
            / f"{_safe_ref(reviewed_input_ref)}.json"
        )

    def _path_for_provenance_ref(self, provenance_ref: str) -> Path:
        return (
            self._storage_root
            / "reviewed-corpus-inputs"
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
