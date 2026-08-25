from __future__ import annotations

import json
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Any

from tools.legal.sources.extraction.official_text_extraction import _sha256_bytes, _sha256_text
from tools.legal.sources.extraction.official_text_extraction_repository import (
    OfficialTextExtractionRecord,
    OfficialTextExtractionRepository,
)
from tools.legal.sources.ocr_fallback.ocr_fallback_repository import OcrFallbackRecord, OcrFallbackRepository
from tools.legal.sources.ocr_quality.ocr_quality_repository import OcrQualityRecord

OCR_QUALITY_TOOL = {
    "name": "evaluate_ocr_quality",
    "version": "1.0.0",
    "config_hash": "sha256:quality-v1",
}

OCR_QUALITY_PROFILES = {
    "vi_legal_v1": "VI_LEGAL_V1",
}

OCR_QUALITY_STATUSES = {
    "ready": "READY",
    "needs_input": "NEEDS_INPUT",
    "conflict": "CONFLICT",
    "out_of_coverage": "OUT_OF_COVERAGE",
    "failed": "FAILED",
}

OCR_QUALITY_COVERAGE_STATES = {
    "sufficient": "SUFFICIENT",
    "partial": "PARTIAL",
    "limited": "LIMITED",
    "unavailable": "UNAVAILABLE",
}

OCR_QUALITY_LIMITATION_CODES = {
    "extraction_missing": "EXTRACTION_MISSING",
    "identity_ref_missing": "IDENTITY_REF_MISSING",
    "generic_identity_ref": "GENERIC_IDENTITY_REF",
    "missing_identity_candidate": "MISSING_IDENTITY_CANDIDATE",
    "identity_mismatch": "IDENTITY_MISMATCH",
    "page_continuity_gap": "PAGE_CONTINUITY_GAP",
    "page_order_mismatch": "PAGE_ORDER_MISMATCH",
    "low_confidence": "LOW_CONFIDENCE",
    "numbering_missing": "NUMBERING_MISSING",
    "hierarchy_missing": "HIERARCHY_MISSING",
    "manifest_missing": "MANIFEST_MISSING",
    "manifest_hash_mismatch": "MANIFEST_HASH_MISMATCH",
    "text_hash_mismatch": "TEXT_HASH_MISMATCH",
}

OCR_QUALITY_DECISIONS = {
    "pass": "PASS",
}

_MINIMUM_CONFIDENCE = 0.9
_ARTICLE_PATTERNS = (
    "điều ",
    "chương ",
    "mục ",
    "phần ",
)


@dataclass(frozen=True)
class EvaluateOcrQualityRequest:
    extraction_ref: str
    expected_identity_ref: str
    quality_profile: str


@dataclass(frozen=True)
class OcrQualityResult:
    status: str
    quality_manifest_ref: str
    quality_manifest_id: str
    extraction_ref: str
    expected_identity_ref: str
    quality_profile: str
    provenance_ref: str
    coverage_state: str
    evidence_refs: list[str]
    limitations: list[dict[str, Any]]
    decision: str
    checked: dict[str, bool]
    minimum_confidence: float
    finding_refs: list[str]

    def to_tool_response(self, *, correlationId: str) -> dict[str, Any]:
        return {
            "status": self.status,
            "toolName": OCR_QUALITY_TOOL["name"],
            "toolVersion": OCR_QUALITY_TOOL["version"],
            "configHash": OCR_QUALITY_TOOL["config_hash"],
            "correlationId": correlationId,
            "artifactVersions": {
                "extractionId": self.extraction_ref.split(":", 1)[1],
            },
            "provenanceRef": self.provenance_ref,
            "coverageState": self.coverage_state,
            "evidenceRefs": self.evidence_refs,
            "limitations": self.limitations,
            "result": {
                "qualityManifestRef": self.quality_manifest_ref,
                "decision": self.decision,
                "checked": self.checked,
                "minimumConfidence": self.minimum_confidence,
                "findingRefs": self.finding_refs,
            },
        }

    def to_record(self) -> OcrQualityRecord:
        return OcrQualityRecord(
            quality_manifest_ref=self.quality_manifest_ref,
            provenance_ref=self.provenance_ref,
            extraction_ref=self.extraction_ref,
            expected_identity_ref=self.expected_identity_ref,
            quality_profile=self.quality_profile,
            status=self.status,
            coverage_state=self.coverage_state,
            decision=self.decision,
            checked=self.checked,
            minimum_confidence=self.minimum_confidence,
            finding_refs=self.finding_refs,
            evidence_refs=self.evidence_refs,
            limitations=self.limitations,
        )


class OcrQualityValidator:
    def __init__(
        self,
        *,
        storage_root: Path,
        extraction_repository: OfficialTextExtractionRepository,
        ocr_repository: OcrFallbackRepository,
    ) -> None:
        self._storage_root = storage_root
        self._extraction_repository = extraction_repository
        self._ocr_repository = ocr_repository

    def evaluate(self, request: EvaluateOcrQualityRequest) -> OcrQualityResult:
        profile = self._normalize_profile(request.quality_profile)
        quality_manifest_id = _quality_manifest_id(
            extraction_ref=request.extraction_ref,
            expected_identity_ref=request.expected_identity_ref,
            quality_profile=profile,
        )
        quality_manifest_ref = f"quality-manifest:{quality_manifest_id}"
        provenance_ref = f"prov:quality:{quality_manifest_id}"

        if not request.expected_identity_ref.strip():
            return self._needs_input(
                quality_manifest_id=quality_manifest_id,
                quality_manifest_ref=quality_manifest_ref,
                provenance_ref=provenance_ref,
                extraction_ref=request.extraction_ref,
                expected_identity_ref=request.expected_identity_ref,
                quality_profile=profile,
                code=OCR_QUALITY_LIMITATION_CODES["identity_ref_missing"],
                reason="expected identity ref is required",
                minimum_confidence=0.0,
            )

        identity_slug = _expected_identity_slug(request.expected_identity_ref)
        if identity_slug is None:
            return self._needs_input(
                quality_manifest_id=quality_manifest_id,
                quality_manifest_ref=quality_manifest_ref,
                provenance_ref=provenance_ref,
                extraction_ref=request.extraction_ref,
                expected_identity_ref=request.expected_identity_ref,
                quality_profile=profile,
                code=OCR_QUALITY_LIMITATION_CODES["generic_identity_ref"],
                reason="expected identity ref must be document-scoped",
                minimum_confidence=0.0,
            )

        if request.extraction_ref.startswith("extraction:"):
            return self._evaluate_canonical(
                request=request,
                profile=profile,
                identity_slug=identity_slug,
                quality_manifest_id=quality_manifest_id,
                quality_manifest_ref=quality_manifest_ref,
                provenance_ref=provenance_ref,
            )
        if request.extraction_ref.startswith("ocr:"):
            return self._evaluate_ocr(
                request=request,
                profile=profile,
                identity_slug=identity_slug,
                quality_manifest_id=quality_manifest_id,
                quality_manifest_ref=quality_manifest_ref,
                provenance_ref=provenance_ref,
            )
        raise ValueError("unsupported extraction ref")

    def _evaluate_canonical(
        self,
        *,
        request: EvaluateOcrQualityRequest,
        profile: str,
        identity_slug: str,
        quality_manifest_id: str,
        quality_manifest_ref: str,
        provenance_ref: str,
    ) -> OcrQualityResult:
        record = self._extraction_repository.get_by_extraction_ref(request.extraction_ref)
        if record is None:
            return self._needs_input(
                quality_manifest_id=quality_manifest_id,
                quality_manifest_ref=quality_manifest_ref,
                provenance_ref=provenance_ref,
                extraction_ref=request.extraction_ref,
                expected_identity_ref=request.expected_identity_ref,
                quality_profile=profile,
                code=OCR_QUALITY_LIMITATION_CODES["extraction_missing"],
                reason="canonical extraction record was not found",
                minimum_confidence=0.0,
            )
        if not record.canonical_extraction_available:
            return self._needs_input(
                quality_manifest_id=quality_manifest_id,
                quality_manifest_ref=quality_manifest_ref,
                provenance_ref=provenance_ref,
                extraction_ref=request.extraction_ref,
                expected_identity_ref=request.expected_identity_ref,
                quality_profile=profile,
                code=OCR_QUALITY_LIMITATION_CODES["manifest_missing"],
                reason="canonical extraction is unavailable; OCR fallback is required",
                minimum_confidence=0.0,
            )
        spans_path = Path(record.spans_path)
        manifest_path = Path(record.span_manifest_path)
        if not spans_path.is_file() or not manifest_path.is_file():
            return self._needs_input(
                quality_manifest_id=quality_manifest_id,
                quality_manifest_ref=quality_manifest_ref,
                provenance_ref=provenance_ref,
                extraction_ref=request.extraction_ref,
                expected_identity_ref=request.expected_identity_ref,
                quality_profile=profile,
                code=OCR_QUALITY_LIMITATION_CODES["manifest_missing"],
                reason="canonical extraction artifacts are missing from storage",
                minimum_confidence=0.0,
            )
        spans_raw = spans_path.read_text(encoding="utf-8")
        if _sha256_bytes(spans_raw.encode("utf-8")) != record.span_manifest_sha256:
            return self._out_of_coverage(
                quality_manifest_id=quality_manifest_id,
                quality_manifest_ref=quality_manifest_ref,
                provenance_ref=provenance_ref,
                extraction_ref=request.extraction_ref,
                expected_identity_ref=request.expected_identity_ref,
                quality_profile=profile,
                code=OCR_QUALITY_LIMITATION_CODES["manifest_hash_mismatch"],
                reason="canonical extraction spans hash does not match persisted metadata",
                minimum_confidence=1.0,
                evidence_refs=[request.extraction_ref],
            )
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if str(manifest.get("spanManifestSha256")) != record.span_manifest_sha256:
            return self._out_of_coverage(
                quality_manifest_id=quality_manifest_id,
                quality_manifest_ref=quality_manifest_ref,
                provenance_ref=provenance_ref,
                extraction_ref=request.extraction_ref,
                expected_identity_ref=request.expected_identity_ref,
                quality_profile=profile,
                code=OCR_QUALITY_LIMITATION_CODES["manifest_hash_mismatch"],
                reason="canonical extraction manifest hash does not match persisted metadata",
                minimum_confidence=1.0,
                evidence_refs=[request.extraction_ref],
            )
        spans = json.loads(spans_raw)
        text_blocks = [
            str(item.get("text", "")).strip()
            for item in spans
            if isinstance(item, dict) and str(item.get("text", "")).strip()
        ]
        page_numbers = [
            int(item.get("pageNumber", 1))
            for item in spans
            if isinstance(item, dict) and isinstance(item.get("pageNumber", 1), int)
        ]
        return self._build_quality_result(
            quality_manifest_id=quality_manifest_id,
            quality_manifest_ref=quality_manifest_ref,
            provenance_ref=provenance_ref,
            extraction_ref=request.extraction_ref,
            expected_identity_ref=request.expected_identity_ref,
            quality_profile=profile,
            identity_candidate=record.identity_candidate,
            identity_slug=identity_slug,
            text_blocks=text_blocks,
            page_numbers=page_numbers,
            confidence_values=[1.0],
            evidence_refs=[request.extraction_ref, record.provenance_ref],
        )

    def _evaluate_ocr(
        self,
        *,
        request: EvaluateOcrQualityRequest,
        profile: str,
        identity_slug: str,
        quality_manifest_id: str,
        quality_manifest_ref: str,
        provenance_ref: str,
    ) -> OcrQualityResult:
        record = self._ocr_repository.get_by_ocr_ref(request.extraction_ref)
        if record is None:
            return self._needs_input(
                quality_manifest_id=quality_manifest_id,
                quality_manifest_ref=quality_manifest_ref,
                provenance_ref=provenance_ref,
                extraction_ref=request.extraction_ref,
                expected_identity_ref=request.expected_identity_ref,
                quality_profile=profile,
                code=OCR_QUALITY_LIMITATION_CODES["extraction_missing"],
                reason="OCR extraction record was not found",
                minimum_confidence=0.0,
            )
        extraction_record = self._matching_extraction_proof(record)
        if extraction_record is None:
            return self._needs_input(
                quality_manifest_id=quality_manifest_id,
                quality_manifest_ref=quality_manifest_ref,
                provenance_ref=provenance_ref,
                extraction_ref=request.extraction_ref,
                expected_identity_ref=request.expected_identity_ref,
                quality_profile=profile,
                code=OCR_QUALITY_LIMITATION_CODES["manifest_missing"],
                reason="OCR fallback proof record was not found",
                minimum_confidence=0.0,
            )
        page_payloads = self._load_ocr_page_payloads(record)
        if isinstance(page_payloads, OcrQualityResult):
            return page_payloads
        text_blocks: list[str] = []
        confidence_values: list[float] = []
        page_numbers: list[int] = []
        evidence_refs = [request.extraction_ref, record.provenance_ref]
        for payload in page_payloads:
            text_blocks.extend(payload["lines"])
            confidence_values.append(float(payload["meanConfidence"]))
            page_numbers.append(int(payload["page"]))
            evidence_refs.append(str(payload["spanManifestRef"]))
        return self._build_quality_result(
            quality_manifest_id=quality_manifest_id,
            quality_manifest_ref=quality_manifest_ref,
            provenance_ref=provenance_ref,
            extraction_ref=request.extraction_ref,
            expected_identity_ref=request.expected_identity_ref,
            quality_profile=profile,
            identity_candidate=extraction_record.identity_candidate,
            identity_slug=identity_slug,
            text_blocks=text_blocks,
            page_numbers=page_numbers,
            confidence_values=confidence_values,
            evidence_refs=evidence_refs,
        )

    def _load_ocr_page_payloads(
        self,
        record: OcrFallbackRecord,
    ) -> list[dict[str, Any]] | OcrQualityResult:
        output_dir = (
            self._storage_root
            / "official-ocr-fallbacks"
            / record.snapshot_ref.removeprefix("snapshot:").replace(":", "_")
            / record.ocr_ref.removeprefix("ocr:")
        )
        payloads: list[dict[str, Any]] = []
        for page in record.pages:
            page_number = int(page["page"])
            manifest_path = output_dir / f"page-{page_number}.ocr.json"
            text_path = output_dir / f"page-{page_number}.ocr.txt"
            if not manifest_path.is_file() or not text_path.is_file():
                return self._needs_input(
                    quality_manifest_id=f"{record.ocr_ref.removeprefix('ocr:')}",
                    quality_manifest_ref=f"quality-manifest:{record.ocr_ref.removeprefix('ocr:')}",
                    provenance_ref=f"prov:quality:{record.ocr_ref.removeprefix('ocr:')}",
                    extraction_ref=record.ocr_ref,
                    expected_identity_ref="catalog-source:missing",
                    quality_profile=OCR_QUALITY_PROFILES["vi_legal_v1"],
                    code=OCR_QUALITY_LIMITATION_CODES["manifest_missing"],
                    reason="OCR page manifest is missing from storage",
                    minimum_confidence=0.0,
                )
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            text = text_path.read_text(encoding="utf-8").strip()
            if str(manifest.get("textSha256")) != _sha256_text(text):
                return self._out_of_coverage(
                    quality_manifest_id=f"{record.ocr_ref.removeprefix('ocr:')}",
                    quality_manifest_ref=f"quality-manifest:{record.ocr_ref.removeprefix('ocr:')}",
                    provenance_ref=f"prov:quality:{record.ocr_ref.removeprefix('ocr:')}",
                    extraction_ref=record.ocr_ref,
                    expected_identity_ref="catalog-source:missing",
                    quality_profile=OCR_QUALITY_PROFILES["vi_legal_v1"],
                    code=OCR_QUALITY_LIMITATION_CODES["text_hash_mismatch"],
                    reason=f"OCR text hash mismatch on page {page_number}",
                    minimum_confidence=float(manifest.get("meanConfidence", 0.0)),
                    evidence_refs=[record.ocr_ref, str(manifest.get("spanManifestRef"))],
                )
            payloads.append(
                {
                    "page": page_number,
                    "meanConfidence": float(manifest.get("meanConfidence", 0.0)),
                    "spanManifestRef": str(manifest.get("spanManifestRef")),
                    "lines": [line.strip() for line in text.splitlines() if line.strip()],
                }
            )
        return payloads

    def _build_quality_result(
        self,
        *,
        quality_manifest_id: str,
        quality_manifest_ref: str,
        provenance_ref: str,
        extraction_ref: str,
        expected_identity_ref: str,
        quality_profile: str,
        identity_candidate: dict[str, str | None],
        identity_slug: str,
        text_blocks: list[str],
        page_numbers: list[int],
        confidence_values: list[float],
        evidence_refs: list[str],
    ) -> OcrQualityResult:
        minimum_confidence = round(min(confidence_values or [0.0]), 4)
        findings: list[tuple[str, str]] = []
        checked = {
            "pageContinuity": True,
            "identity": True,
            "numbering": True,
            "hierarchy": True,
        }
        document_number = _clean(identity_candidate.get("documentNumber"))
        if not document_number:
            checked["identity"] = False
            findings.append(
                (
                    OCR_QUALITY_LIMITATION_CODES["missing_identity_candidate"],
                    "extracted identity does not include document number",
                )
            )
        elif _slug(document_number) != identity_slug:
            checked["identity"] = False
            findings.append(
                (
                    OCR_QUALITY_LIMITATION_CODES["identity_mismatch"],
                    "expected identity ref does not match extracted document number",
                )
            )
        if page_numbers:
            sorted_pages = sorted(page_numbers)
            distinct_pages = sorted(set(page_numbers))
            if page_numbers != sorted_pages:
                checked["pageContinuity"] = False
                findings.append(
                    (
                        OCR_QUALITY_LIMITATION_CODES["page_order_mismatch"],
                        "pages are not stored in ascending order",
                    )
                )
            if len(distinct_pages) > 1:
                expected_pages = list(
                    range(distinct_pages[0], distinct_pages[-1] + 1)
                )
                if distinct_pages != expected_pages:
                    checked["pageContinuity"] = False
                    findings.append(
                        (
                            OCR_QUALITY_LIMITATION_CODES["page_continuity_gap"],
                            "pages are missing within the OCR page set",
                        )
                    )
        if minimum_confidence < _MINIMUM_CONFIDENCE:
            checked["pageContinuity"] = False
            findings.append(
                (
                    OCR_QUALITY_LIMITATION_CODES["low_confidence"],
                    f"OCR confidence {minimum_confidence:.4f} is below {_MINIMUM_CONFIDENCE:.2f}",
                )
            )
        normalized_blocks = [block for block in text_blocks if block]
        if not _has_hierarchy_marker(normalized_blocks):
            checked["hierarchy"] = False
            findings.append(
                (
                    OCR_QUALITY_LIMITATION_CODES["hierarchy_missing"],
                    "no recognized Vietnamese legal hierarchy markers were detected",
                )
            )
        if not _has_numbering_marker(normalized_blocks):
            checked["numbering"] = False
            findings.append(
                (
                    OCR_QUALITY_LIMITATION_CODES["numbering_missing"],
                    "no deterministic article/clause/point numbering markers were detected",
                )
            )

        finding_refs = [
            f"quality-finding:{quality_manifest_id}:{index:02d}"
            for index, _ in enumerate(findings, start=1)
        ]
        limitations = [
            {
                "code": code,
                "affectedScopeRef": extraction_ref,
                "reason": reason,
                "retryable": False,
            }
            for code, reason in findings
        ]

        if findings:
            if any(
                code
                in {
                    OCR_QUALITY_LIMITATION_CODES["identity_mismatch"],
                    OCR_QUALITY_LIMITATION_CODES["missing_identity_candidate"],
                }
                for code, _ in findings
            ):
                status = OCR_QUALITY_STATUSES["conflict"]
            else:
                status = OCR_QUALITY_STATUSES["out_of_coverage"]
            coverage_state = OCR_QUALITY_COVERAGE_STATES["limited"]
        else:
            status = OCR_QUALITY_STATUSES["ready"]
            coverage_state = OCR_QUALITY_COVERAGE_STATES["sufficient"]

        return OcrQualityResult(
            status=status,
            quality_manifest_ref=quality_manifest_ref,
            quality_manifest_id=quality_manifest_id,
            extraction_ref=extraction_ref,
            expected_identity_ref=expected_identity_ref,
            quality_profile=quality_profile,
            provenance_ref=provenance_ref,
            coverage_state=coverage_state,
            evidence_refs=evidence_refs[:20],
            limitations=limitations,
            decision=OCR_QUALITY_DECISIONS["pass"],
            checked=checked,
            minimum_confidence=minimum_confidence,
            finding_refs=finding_refs,
        )

    def _matching_extraction_proof(
        self, record: OcrFallbackRecord
    ) -> OfficialTextExtractionRecord | None:
        return self._extraction_repository.get_by_provenance_ref(record.fallback_proof_ref)

    def _normalize_profile(self, value: str) -> str:
        normalized = value.strip().upper()
        if normalized in OCR_QUALITY_PROFILES.values():
            return normalized
        raise ValueError("unsupported OCR quality profile")

    def _needs_input(
        self,
        *,
        quality_manifest_id: str,
        quality_manifest_ref: str,
        provenance_ref: str,
        extraction_ref: str,
        expected_identity_ref: str,
        quality_profile: str,
        code: str,
        reason: str,
        minimum_confidence: float,
    ) -> OcrQualityResult:
        return OcrQualityResult(
            status=OCR_QUALITY_STATUSES["needs_input"],
            quality_manifest_ref=quality_manifest_ref,
            quality_manifest_id=quality_manifest_id,
            extraction_ref=extraction_ref,
            expected_identity_ref=expected_identity_ref,
            quality_profile=quality_profile,
            provenance_ref=provenance_ref,
            coverage_state=OCR_QUALITY_COVERAGE_STATES["partial"],
            evidence_refs=[extraction_ref],
            limitations=[
                {
                    "code": code,
                    "affectedScopeRef": extraction_ref,
                    "reason": reason,
                    "retryable": False,
                }
            ],
            decision=OCR_QUALITY_DECISIONS["pass"],
            checked={
                "pageContinuity": False,
                "identity": False,
                "numbering": False,
                "hierarchy": False,
            },
            minimum_confidence=minimum_confidence,
            finding_refs=[],
        )

    def _out_of_coverage(
        self,
        *,
        quality_manifest_id: str,
        quality_manifest_ref: str,
        provenance_ref: str,
        extraction_ref: str,
        expected_identity_ref: str,
        quality_profile: str,
        code: str,
        reason: str,
        minimum_confidence: float,
        evidence_refs: list[str],
    ) -> OcrQualityResult:
        return OcrQualityResult(
            status=OCR_QUALITY_STATUSES["out_of_coverage"],
            quality_manifest_ref=quality_manifest_ref,
            quality_manifest_id=quality_manifest_id,
            extraction_ref=extraction_ref,
            expected_identity_ref=expected_identity_ref,
            quality_profile=quality_profile,
            provenance_ref=provenance_ref,
            coverage_state=OCR_QUALITY_COVERAGE_STATES["limited"],
            evidence_refs=evidence_refs[:20],
            limitations=[
                {
                    "code": code,
                    "affectedScopeRef": extraction_ref,
                    "reason": reason,
                    "retryable": False,
                }
            ],
            decision=OCR_QUALITY_DECISIONS["pass"],
            checked={
                "pageContinuity": False,
                "identity": True,
                "numbering": False,
                "hierarchy": False,
            },
            minimum_confidence=minimum_confidence,
            finding_refs=[f"quality-finding:{quality_manifest_id}:01"],
        )


def _quality_manifest_id(
    *, extraction_ref: str, expected_identity_ref: str, quality_profile: str
) -> str:
    return sha256(
        f"{extraction_ref}|{expected_identity_ref}|{quality_profile}".encode("utf-8")
    ).hexdigest()[:24]


def _clean(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _expected_identity_slug(expected_identity_ref: str) -> str | None:
    tail = expected_identity_ref.rsplit(":", 1)[-1].strip().lower()
    if not tail or tail == "catalog":
        return None
    return tail


def _slug(value: str) -> str:
    import unicodedata
    import re

    normalized = value.replace("Đ", "D").replace("đ", "d")
    normalized = unicodedata.normalize("NFD", normalized)
    without_diacritics = "".join(
        char for char in normalized if unicodedata.category(char) != "Mn"
    )
    slug = re.sub(r"[^A-Za-z0-9]+", "-", without_diacritics).strip("-").lower()
    return slug[:96]


def _has_hierarchy_marker(text_blocks: list[str]) -> bool:
    for block in text_blocks:
        lower = block.lower()
        if any(marker in lower for marker in _ARTICLE_PATTERNS):
            return True
    return False


def _has_numbering_marker(text_blocks: list[str]) -> bool:
    import re

    patterns = [
        r"^\s*Điều\s+\d+[A-Za-z0-9/-]*",
        r"^\s*\d+\.",
        r"^\s*[a-zđ]\)",
        r"^\s*Chương\s+[IVXLC0-9]+",
    ]
    for block in text_blocks:
        for pattern in patterns:
            if re.search(pattern, block, flags=re.IGNORECASE):
                return True
    return False
