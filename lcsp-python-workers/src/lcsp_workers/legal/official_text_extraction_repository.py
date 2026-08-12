from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .official_text_extraction import OfficialTextExtractionResult


@dataclass(frozen=True)
class OfficialTextExtractionRecord:
    extraction_ref: str
    provenance_ref: str
    snapshot_ref: str
    document_id: str
    status: str
    coverage_state: str
    canonical_extraction_available: bool
    limitations: list[dict[str, Any]]
    format: str
    page_count: int
    span_count: int
    span_manifest_path: str
    spans_path: str
    span_manifest_sha256: str
    identity_candidate: dict[str, str | None]

    def to_json(self) -> dict[str, Any]:
        return {
            "extractionRef": self.extraction_ref,
            "provenanceRef": self.provenance_ref,
            "snapshotRef": self.snapshot_ref,
            "documentId": self.document_id,
            "status": self.status,
            "coverageState": self.coverage_state,
            "canonicalExtractionAvailable": self.canonical_extraction_available,
            "limitations": self.limitations,
            "format": self.format,
            "pageCount": self.page_count,
            "spanCount": self.span_count,
            "spanManifestPath": self.span_manifest_path,
            "spansPath": self.spans_path,
            "spanManifestSha256": self.span_manifest_sha256,
            "identityCandidate": self.identity_candidate,
        }

    @classmethod
    def from_json(cls, payload: dict[str, Any]) -> "OfficialTextExtractionRecord":
        return cls(
            extraction_ref=str(payload["extractionRef"]),
            provenance_ref=str(payload["provenanceRef"]),
            snapshot_ref=str(payload["snapshotRef"]),
            document_id=str(payload["documentId"]),
            status=str(payload["status"]),
            coverage_state=str(payload["coverageState"]),
            canonical_extraction_available=bool(
                payload["canonicalExtractionAvailable"]
            ),
            limitations=[
                item for item in payload.get("limitations", []) if isinstance(item, dict)
            ],
            format=str(payload["format"]),
            page_count=int(payload["pageCount"]),
            span_count=int(payload["spanCount"]),
            span_manifest_path=str(payload["spanManifestPath"]),
            spans_path=str(payload["spansPath"]),
            span_manifest_sha256=str(payload["spanManifestSha256"]),
            identity_candidate=dict(payload.get("identityCandidate", {})),
        )

    @classmethod
    def from_result(
        cls, result: OfficialTextExtractionResult
    ) -> "OfficialTextExtractionRecord":
        return cls(
            extraction_ref=result.extraction_ref,
            provenance_ref=result.provenance_ref,
            snapshot_ref=result.snapshot_ref,
            document_id=result.document_id,
            status=result.status,
            coverage_state=result.coverage_state,
            canonical_extraction_available=result.canonical_extraction_available,
            limitations=result.limitations,
            format=result.format,
            page_count=result.page_count,
            span_count=result.span_count,
            span_manifest_path=str(result.span_manifest_path),
            spans_path=str(result.spans_path),
            span_manifest_sha256=result.span_manifest_sha256,
            identity_candidate=result.identity_candidate,
        )


class OfficialTextExtractionRepository:
    def __init__(self, *, storage_root: Path) -> None:
        self._storage_root = storage_root

    def save(self, result: OfficialTextExtractionResult) -> OfficialTextExtractionRecord:
        record = OfficialTextExtractionRecord.from_result(result)
        self._write_json(self._path_for_extraction_ref(record.extraction_ref), record.to_json())
        self._write_json(self._path_for_provenance_ref(record.provenance_ref), record.to_json())
        return record

    def get_by_extraction_ref(
        self, extraction_ref: str
    ) -> OfficialTextExtractionRecord | None:
        path = self._path_for_extraction_ref(extraction_ref)
        if not path.is_file():
            return None
        return OfficialTextExtractionRecord.from_json(
            json.loads(path.read_text(encoding="utf-8"))
        )

    def get_by_provenance_ref(
        self, provenance_ref: str
    ) -> OfficialTextExtractionRecord | None:
        path = self._path_for_provenance_ref(provenance_ref)
        if not path.is_file():
            return None
        return OfficialTextExtractionRecord.from_json(
            json.loads(path.read_text(encoding="utf-8"))
        )

    def list_by_snapshot_ref(
        self, snapshot_ref: str
    ) -> list[OfficialTextExtractionRecord]:
        registry_dir = (
            self._storage_root
            / "official-text-extractions"
            / "registry"
            / "extractions"
        )
        if not registry_dir.is_dir():
            return []
        matches: list[OfficialTextExtractionRecord] = []
        for path in sorted(registry_dir.glob("*.json")):
            record = OfficialTextExtractionRecord.from_json(
                json.loads(path.read_text(encoding="utf-8"))
            )
            if record.snapshot_ref == snapshot_ref:
                matches.append(record)
        return matches

    def _path_for_extraction_ref(self, extraction_ref: str) -> Path:
        return (
            self._storage_root
            / "official-text-extractions"
            / "registry"
            / "extractions"
            / f"{_safe_ref(extraction_ref)}.json"
        )

    def _path_for_provenance_ref(self, provenance_ref: str) -> Path:
        return (
            self._storage_root
            / "official-text-extractions"
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
