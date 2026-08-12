from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class OcrFallbackConflictError(RuntimeError):
    """Raised when an OCR fallback record already exists with different content."""


@dataclass(frozen=True)
class OcrFallbackRecord:
    ocr_ref: str
    provenance_ref: str
    snapshot_ref: str
    fallback_proof_ref: str
    status: str
    coverage_state: str
    limitations: list[dict[str, Any]]
    profile: str
    page_numbers: list[int]
    evidence_refs: list[str]
    pages: list[dict[str, Any]]

    def to_json(self) -> dict[str, Any]:
        return {
            "ocrRef": self.ocr_ref,
            "provenanceRef": self.provenance_ref,
            "snapshotRef": self.snapshot_ref,
            "fallbackProofRef": self.fallback_proof_ref,
            "status": self.status,
            "coverageState": self.coverage_state,
            "limitations": self.limitations,
            "profile": self.profile,
            "pageNumbers": self.page_numbers,
            "evidenceRefs": self.evidence_refs,
            "pages": self.pages,
        }

    @classmethod
    def from_json(cls, payload: dict[str, Any]) -> "OcrFallbackRecord":
        return cls(
            ocr_ref=str(payload["ocrRef"]),
            provenance_ref=str(payload["provenanceRef"]),
            snapshot_ref=str(payload["snapshotRef"]),
            fallback_proof_ref=str(payload["fallbackProofRef"]),
            status=str(payload["status"]),
            coverage_state=str(payload["coverageState"]),
            limitations=[
                item for item in payload.get("limitations", []) if isinstance(item, dict)
            ],
            profile=str(payload["profile"]),
            page_numbers=[int(value) for value in payload.get("pageNumbers", [])],
            evidence_refs=[str(value) for value in payload.get("evidenceRefs", [])],
            pages=[item for item in payload.get("pages", []) if isinstance(item, dict)],
        )


class OcrFallbackRepository:
    def __init__(self, *, storage_root: Path) -> None:
        self._storage_root = storage_root

    def save(self, record: OcrFallbackRecord) -> OcrFallbackRecord:
        payload = record.to_json()
        self._assert_compatible_or_absent(self._path_for_ocr_ref(record.ocr_ref), payload)
        self._assert_compatible_or_absent(
            self._path_for_provenance_ref(record.provenance_ref), payload
        )
        self._write_json(self._path_for_ocr_ref(record.ocr_ref), payload)
        self._write_json(self._path_for_provenance_ref(record.provenance_ref), payload)
        return record

    def get_by_provenance_ref(self, provenance_ref: str) -> OcrFallbackRecord | None:
        path = self._path_for_provenance_ref(provenance_ref)
        if not path.is_file():
            return None
        return OcrFallbackRecord.from_json(json.loads(path.read_text(encoding="utf-8")))

    def get_by_ocr_ref(self, ocr_ref: str) -> OcrFallbackRecord | None:
        path = self._path_for_ocr_ref(ocr_ref)
        if not path.is_file():
            return None
        return OcrFallbackRecord.from_json(json.loads(path.read_text(encoding="utf-8")))

    @staticmethod
    def _write_json(path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def _path_for_ocr_ref(self, ocr_ref: str) -> Path:
        return (
            self._storage_root
            / "official-ocr-fallbacks"
            / "registry"
            / "ocr"
            / f"{_safe_ref(ocr_ref)}.json"
        )

    def _path_for_provenance_ref(self, provenance_ref: str) -> Path:
        return (
            self._storage_root
            / "official-ocr-fallbacks"
            / "registry"
            / "provenance"
            / f"{_safe_ref(provenance_ref)}.json"
        )

    @staticmethod
    def _assert_compatible_or_absent(path: Path, payload: dict[str, Any]) -> None:
        if not path.is_file():
            return
        existing = json.loads(path.read_text(encoding="utf-8"))
        if existing != payload:
            raise OcrFallbackConflictError(
                f"OCR fallback record conflict at {path.name}"
            )


def _safe_ref(value: str) -> str:
    return value.replace(":", "__")
