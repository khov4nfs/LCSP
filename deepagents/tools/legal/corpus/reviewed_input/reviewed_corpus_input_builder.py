from __future__ import annotations

import json
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Any

from tools.legal.sources.extraction.official_text_extraction import _sha256_bytes, _sha256_text
from tools.legal.sources.extraction.official_text_extraction_repository import OfficialTextExtractionRepository
from tools.legal.sources.ocr_fallback.ocr_fallback_repository import OcrFallbackRepository
from tools.legal.sources.ocr_quality.ocr_quality_repository import OcrQualityRepository
from tools.legal.corpus.reviewed_input.reviewed_corpus_input_repository import (
    ReviewedCorpusInputRecord,
)

REVIEWED_CORPUS_INPUT_TOOL = {
    "name": "build_reviewed_corpus_input",
    "version": "1.0.0",
    "config_hash": "sha256:normalizer-v1",
}

REVIEWED_CORPUS_INPUT_PROFILES = {
    "deterministic_v1": "DETERMINISTIC_V1",
}

REVIEWED_CORPUS_INPUT_STATUSES = {
    "ready": "READY",
    "needs_input": "NEEDS_INPUT",
    "conflict": "CONFLICT",
    "blocked": "BLOCKED",
    "failed": "FAILED",
}

REVIEWED_CORPUS_INPUT_COVERAGE_STATES = {
    "sufficient": "SUFFICIENT",
    "partial": "PARTIAL",
    "unavailable": "UNAVAILABLE",
}

REVIEWED_CORPUS_INPUT_LIMITATION_CODES = {
    "quality_manifest_missing": "QUALITY_MANIFEST_MISSING",
    "extraction_missing": "EXTRACTION_MISSING",
    "quality_gate_blocked": "QUALITY_GATE_BLOCKED",
    "quality_manifest_mismatch": "QUALITY_MANIFEST_MISMATCH",
    "artifact_missing": "ARTIFACT_MISSING",
    "artifact_hash_mismatch": "ARTIFACT_HASH_MISMATCH",
    "unsupported_correction_profile": "UNSUPPORTED_CORRECTION_PROFILE",
}


@dataclass(frozen=True)
class BuildReviewedCorpusInputRequest:
    extraction_ref: str
    quality_manifest_ref: str
    correction_profile: str


@dataclass(frozen=True)
class ReviewedCorpusInputResult:
    status: str
    reviewed_input_ref: str
    reviewed_input_id: str
    provenance_ref: str
    extraction_ref: str
    quality_manifest_ref: str
    correction_profile: str
    coverage_state: str
    evidence_refs: list[str]
    limitations: list[dict[str, Any]]
    content_sha256: str
    quality_decision: str
    manual_approval_required: bool
    document_id: str
    snapshot_ref: str
    source_kind: str
    normalized_text_path: Path
    manifest_path: Path

    def to_tool_response(self, *, correlationId: str) -> dict[str, Any]:
        return {
            "status": self.status,
            "toolName": REVIEWED_CORPUS_INPUT_TOOL["name"],
            "toolVersion": REVIEWED_CORPUS_INPUT_TOOL["version"],
            "configHash": REVIEWED_CORPUS_INPUT_TOOL["config_hash"],
            "correlationId": correlationId,
            "artifactVersions": {
                "reviewedInputId": self.reviewed_input_id,
            },
            "provenanceRef": self.provenance_ref,
            "coverageState": self.coverage_state,
            "evidenceRefs": self.evidence_refs,
            "limitations": self.limitations,
            "result": {
                "reviewedInputRef": self.reviewed_input_ref,
                "contentSha256": self.content_sha256,
                "correctionProfile": self.correction_profile,
                "qualityDecision": self.quality_decision,
                "manualApprovalRequired": self.manual_approval_required,
            },
        }

    def to_record(self) -> ReviewedCorpusInputRecord:
        return ReviewedCorpusInputRecord(
            reviewed_input_ref=self.reviewed_input_ref,
            provenance_ref=self.provenance_ref,
            extraction_ref=self.extraction_ref,
            quality_manifest_ref=self.quality_manifest_ref,
            correction_profile=self.correction_profile,
            status=self.status,
            coverage_state=self.coverage_state,
            content_sha256=self.content_sha256,
            quality_decision=self.quality_decision,
            manual_approval_required=self.manual_approval_required,
            document_id=self.document_id,
            snapshot_ref=self.snapshot_ref,
            source_kind=self.source_kind,
            normalized_text_path=str(self.normalized_text_path),
            manifest_path=str(self.manifest_path),
            evidence_refs=self.evidence_refs,
            limitations=self.limitations,
        )


class ReviewedCorpusInputBuilder:
    def __init__(
        self,
        *,
        storage_root: Path,
        extraction_repository: OfficialTextExtractionRepository,
        ocr_repository: OcrFallbackRepository,
        quality_repository: OcrQualityRepository,
    ) -> None:
        self._storage_root = storage_root
        self._extraction_repository = extraction_repository
        self._ocr_repository = ocr_repository
        self._quality_repository = quality_repository

    def build(
        self, request: BuildReviewedCorpusInputRequest
    ) -> ReviewedCorpusInputResult:
        reviewed_input_id = _reviewed_input_id(
            extraction_ref=request.extraction_ref,
            quality_manifest_ref=request.quality_manifest_ref,
            correction_profile=request.correction_profile,
        )
        reviewed_input_ref = f"reviewed-input:{reviewed_input_id}"
        provenance_ref = f"prov:reviewed-input:{reviewed_input_id}"
        try:
            profile = self._normalize_profile(request.correction_profile)
        except ValueError:
            return self._blocked(
                reviewed_input_id=reviewed_input_id,
                reviewed_input_ref=reviewed_input_ref,
                provenance_ref=provenance_ref,
                request=request,
                code=REVIEWED_CORPUS_INPUT_LIMITATION_CODES[
                    "unsupported_correction_profile"
                ],
                reason="unsupported deterministic correction profile",
                evidence_refs=[],
            )

        quality = self._quality_repository.get_by_quality_manifest_ref(
            request.quality_manifest_ref
        )
        if quality is None:
            return self._needs_input(
                reviewed_input_id=reviewed_input_id,
                reviewed_input_ref=reviewed_input_ref,
                provenance_ref=provenance_ref,
                request=request,
                code=REVIEWED_CORPUS_INPUT_LIMITATION_CODES["quality_manifest_missing"],
                reason="quality manifest record was not found",
            )
        if quality.extraction_ref != request.extraction_ref:
            return self._conflict(
                reviewed_input_id=reviewed_input_id,
                reviewed_input_ref=reviewed_input_ref,
                provenance_ref=provenance_ref,
                request=request,
                code=REVIEWED_CORPUS_INPUT_LIMITATION_CODES["quality_manifest_mismatch"],
                reason="quality manifest does not belong to the requested extraction ref",
                evidence_refs=[request.quality_manifest_ref],
            )
        if quality.status != "READY" or quality.decision != "PASS":
            return self._blocked(
                reviewed_input_id=reviewed_input_id,
                reviewed_input_ref=reviewed_input_ref,
                provenance_ref=provenance_ref,
                request=request,
                code=REVIEWED_CORPUS_INPUT_LIMITATION_CODES["quality_gate_blocked"],
                reason="quality gate did not pass for the requested extraction",
                evidence_refs=[request.quality_manifest_ref],
            )

        if request.extraction_ref.startswith("extraction:"):
            resolved = self._resolve_canonical(request.extraction_ref)
        elif request.extraction_ref.startswith("ocr:"):
            resolved = self._resolve_ocr(request.extraction_ref)
        else:
            raise ValueError("unsupported extraction ref")

        if isinstance(resolved, ReviewedCorpusInputResult):
            return resolved

        normalized_text = _normalize_lines(resolved["lines"])
        normalized_text_with_trailing_newline = (
            normalized_text + "\n" if normalized_text else ""
        )
        content_sha256 = _sha256_text(normalized_text)
        output_dir = (
            self._storage_root / "reviewed-corpus-inputs" / reviewed_input_id
        )
        output_dir.mkdir(parents=True, exist_ok=True)
        normalized_text_path = output_dir / f"{resolved['documentId']}.reviewed.txt"
        manifest_path = output_dir / f"{resolved['documentId']}.reviewed-input.json"
        normalized_text_path.write_text(
            normalized_text_with_trailing_newline,
            encoding="utf-8",
        )
        manifest = {
            "reviewedInputRef": reviewed_input_ref,
            "provenanceRef": provenance_ref,
            "extractionRef": request.extraction_ref,
            "qualityManifestRef": request.quality_manifest_ref,
            "correctionProfile": profile,
            "contentSha256": content_sha256,
            "qualityDecision": quality.decision,
            "manualApprovalRequired": False,
            "documentId": resolved["documentId"],
            "snapshotRef": resolved["snapshotRef"],
            "sourceKind": resolved["sourceKind"],
            "normalizedTextFile": normalized_text_path.name,
            "evidenceRefs": resolved["evidenceRefs"],
        }
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return ReviewedCorpusInputResult(
            status=REVIEWED_CORPUS_INPUT_STATUSES["ready"],
            reviewed_input_ref=reviewed_input_ref,
            reviewed_input_id=reviewed_input_id,
            provenance_ref=provenance_ref,
            extraction_ref=request.extraction_ref,
            quality_manifest_ref=request.quality_manifest_ref,
            correction_profile=profile,
            coverage_state=REVIEWED_CORPUS_INPUT_COVERAGE_STATES["sufficient"],
            evidence_refs=[
                f"{reviewed_input_ref}:{content_sha256}",
                request.quality_manifest_ref,
            ],
            limitations=[],
            content_sha256=content_sha256,
            quality_decision=quality.decision,
            manual_approval_required=False,
            document_id=resolved["documentId"],
            snapshot_ref=resolved["snapshotRef"],
            source_kind=resolved["sourceKind"],
            normalized_text_path=normalized_text_path,
            manifest_path=manifest_path,
        )

    def _resolve_canonical(
        self, extraction_ref: str
    ) -> dict[str, Any] | ReviewedCorpusInputResult:
        record = self._extraction_repository.get_by_extraction_ref(extraction_ref)
        if record is None:
            return self._needs_input_for_extraction(extraction_ref, "canonical extraction record was not found")
        spans_path = Path(record.spans_path)
        manifest_path = Path(record.span_manifest_path)
        if not spans_path.is_file() or not manifest_path.is_file():
            return self._needs_input_for_extraction(
                extraction_ref,
                "canonical extraction artifacts are missing from storage",
            )
        spans_raw = spans_path.read_text(encoding="utf-8")
        if _sha256_bytes(spans_raw.encode("utf-8")) != record.span_manifest_sha256:
            return self._conflict_for_extraction(
                extraction_ref,
                REVIEWED_CORPUS_INPUT_LIMITATION_CODES["artifact_hash_mismatch"],
                "canonical extraction spans hash does not match persisted metadata",
            )
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if str(manifest.get("spanManifestSha256")) != record.span_manifest_sha256:
            return self._conflict_for_extraction(
                extraction_ref,
                REVIEWED_CORPUS_INPUT_LIMITATION_CODES["artifact_hash_mismatch"],
                "canonical extraction manifest hash does not match persisted metadata",
            )
        spans = json.loads(spans_raw)
        lines = [
            str(item.get("text", "")).strip()
            for item in spans
            if isinstance(item, dict) and str(item.get("text", "")).strip()
        ]
        return {
            "documentId": record.document_id,
            "snapshotRef": record.snapshot_ref,
            "sourceKind": "CANONICAL",
            "lines": lines,
            "evidenceRefs": [record.extraction_ref, record.provenance_ref],
        }

    def _resolve_ocr(
        self, extraction_ref: str
    ) -> dict[str, Any] | ReviewedCorpusInputResult:
        record = self._ocr_repository.get_by_ocr_ref(extraction_ref)
        if record is None:
            return self._needs_input_for_extraction(extraction_ref, "OCR extraction record was not found")
        extraction_record = self._extraction_repository.get_by_provenance_ref(
            record.fallback_proof_ref
        )
        if extraction_record is None:
            return self._needs_input_for_extraction(
                extraction_ref,
                "OCR fallback proof record was not found",
            )
        base_dir = (
            self._storage_root
            / "official-ocr-fallbacks"
            / record.snapshot_ref.removeprefix("snapshot:").replace(":", "_")
            / record.ocr_ref.removeprefix("ocr:")
        )
        lines: list[str] = []
        evidence_refs = [record.ocr_ref, record.provenance_ref]
        for page in record.pages:
            page_number = int(page["page"])
            manifest_path = base_dir / f"page-{page_number}.ocr.json"
            text_path = base_dir / f"page-{page_number}.ocr.txt"
            if not manifest_path.is_file() or not text_path.is_file():
                return self._needs_input_for_extraction(
                    extraction_ref,
                    f"OCR page artifact is missing for page {page_number}",
                )
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            text = text_path.read_text(encoding="utf-8").strip()
            if str(manifest.get("textSha256")) != _sha256_text(text):
                return self._conflict_for_extraction(
                    extraction_ref,
                    REVIEWED_CORPUS_INPUT_LIMITATION_CODES["artifact_hash_mismatch"],
                    f"OCR text hash mismatch on page {page_number}",
                )
            lines.extend([line.strip() for line in text.splitlines() if line.strip()])
            evidence_refs.append(str(manifest.get("spanManifestRef")))
        return {
            "documentId": extraction_record.document_id,
            "snapshotRef": record.snapshot_ref,
            "sourceKind": "OCR",
            "lines": lines,
            "evidenceRefs": evidence_refs,
        }

    def _normalize_profile(self, value: str) -> str:
        normalized = value.strip().upper()
        if normalized in REVIEWED_CORPUS_INPUT_PROFILES.values():
            return normalized
        raise ValueError("unsupported correction profile")

    def _needs_input_for_extraction(
        self, extraction_ref: str, reason: str
    ) -> ReviewedCorpusInputResult:
        request = BuildReviewedCorpusInputRequest(
            extraction_ref=extraction_ref,
            quality_manifest_ref="quality-manifest:missing",
            correction_profile=REVIEWED_CORPUS_INPUT_PROFILES["deterministic_v1"],
        )
        reviewed_input_id = _reviewed_input_id(
            extraction_ref=extraction_ref,
            quality_manifest_ref=request.quality_manifest_ref,
            correction_profile=request.correction_profile,
        )
        return self._needs_input(
            reviewed_input_id=reviewed_input_id,
            reviewed_input_ref=f"reviewed-input:{reviewed_input_id}",
            provenance_ref=f"prov:reviewed-input:{reviewed_input_id}",
            request=request,
            code=REVIEWED_CORPUS_INPUT_LIMITATION_CODES["extraction_missing"],
            reason=reason,
        )

    def _conflict_for_extraction(
        self, extraction_ref: str, code: str, reason: str
    ) -> ReviewedCorpusInputResult:
        request = BuildReviewedCorpusInputRequest(
            extraction_ref=extraction_ref,
            quality_manifest_ref="quality-manifest:missing",
            correction_profile=REVIEWED_CORPUS_INPUT_PROFILES["deterministic_v1"],
        )
        reviewed_input_id = _reviewed_input_id(
            extraction_ref=extraction_ref,
            quality_manifest_ref=request.quality_manifest_ref,
            correction_profile=request.correction_profile,
        )
        return self._conflict(
            reviewed_input_id=reviewed_input_id,
            reviewed_input_ref=f"reviewed-input:{reviewed_input_id}",
            provenance_ref=f"prov:reviewed-input:{reviewed_input_id}",
            request=request,
            code=code,
            reason=reason,
            evidence_refs=[extraction_ref],
        )

    def _needs_input(
        self,
        *,
        reviewed_input_id: str,
        reviewed_input_ref: str,
        provenance_ref: str,
        request: BuildReviewedCorpusInputRequest,
        code: str,
        reason: str,
    ) -> ReviewedCorpusInputResult:
        return ReviewedCorpusInputResult(
            status=REVIEWED_CORPUS_INPUT_STATUSES["needs_input"],
            reviewed_input_ref=reviewed_input_ref,
            reviewed_input_id=reviewed_input_id,
            provenance_ref=provenance_ref,
            extraction_ref=request.extraction_ref,
            quality_manifest_ref=request.quality_manifest_ref,
            correction_profile=request.correction_profile,
            coverage_state=REVIEWED_CORPUS_INPUT_COVERAGE_STATES["partial"],
            evidence_refs=[request.extraction_ref],
            limitations=[
                {
                    "code": code,
                    "affectedScopeRef": request.extraction_ref,
                    "reason": reason,
                    "retryable": False,
                }
            ],
            content_sha256=_sha256_text(""),
            quality_decision="PASS",
            manual_approval_required=False,
            document_id="UNKNOWN",
            snapshot_ref="UNKNOWN",
            source_kind="UNKNOWN",
            normalized_text_path=Path("missing"),
            manifest_path=Path("missing"),
        )

    def _blocked(
        self,
        *,
        reviewed_input_id: str,
        reviewed_input_ref: str,
        provenance_ref: str,
        request: BuildReviewedCorpusInputRequest,
        code: str,
        reason: str,
        evidence_refs: list[str],
    ) -> ReviewedCorpusInputResult:
        return ReviewedCorpusInputResult(
            status=REVIEWED_CORPUS_INPUT_STATUSES["blocked"],
            reviewed_input_ref=reviewed_input_ref,
            reviewed_input_id=reviewed_input_id,
            provenance_ref=provenance_ref,
            extraction_ref=request.extraction_ref,
            quality_manifest_ref=request.quality_manifest_ref,
            correction_profile=request.correction_profile,
            coverage_state=REVIEWED_CORPUS_INPUT_COVERAGE_STATES["unavailable"],
            evidence_refs=evidence_refs,
            limitations=[
                {
                    "code": code,
                    "affectedScopeRef": request.quality_manifest_ref,
                    "reason": reason,
                    "retryable": False,
                }
            ],
            content_sha256=_sha256_text(""),
            quality_decision="PASS",
            manual_approval_required=False,
            document_id="UNKNOWN",
            snapshot_ref="UNKNOWN",
            source_kind="UNKNOWN",
            normalized_text_path=Path("missing"),
            manifest_path=Path("missing"),
        )

    def _conflict(
        self,
        *,
        reviewed_input_id: str,
        reviewed_input_ref: str,
        provenance_ref: str,
        request: BuildReviewedCorpusInputRequest,
        code: str,
        reason: str,
        evidence_refs: list[str],
    ) -> ReviewedCorpusInputResult:
        return ReviewedCorpusInputResult(
            status=REVIEWED_CORPUS_INPUT_STATUSES["conflict"],
            reviewed_input_ref=reviewed_input_ref,
            reviewed_input_id=reviewed_input_id,
            provenance_ref=provenance_ref,
            extraction_ref=request.extraction_ref,
            quality_manifest_ref=request.quality_manifest_ref,
            correction_profile=request.correction_profile,
            coverage_state=REVIEWED_CORPUS_INPUT_COVERAGE_STATES["unavailable"],
            evidence_refs=evidence_refs,
            limitations=[
                {
                    "code": code,
                    "affectedScopeRef": request.extraction_ref,
                    "reason": reason,
                    "retryable": False,
                }
            ],
            content_sha256=_sha256_text(""),
            quality_decision="PASS",
            manual_approval_required=False,
            document_id="UNKNOWN",
            snapshot_ref="UNKNOWN",
            source_kind="UNKNOWN",
            normalized_text_path=Path("missing"),
            manifest_path=Path("missing"),
        )


def _normalize_lines(lines: list[str]) -> str:
    normalized_lines: list[str] = []
    previous: str | None = None
    for line in lines:
        value = " ".join(str(line).split())
        if not value:
            continue
        if value == previous:
            continue
        normalized_lines.append(value)
        previous = value
    return "\n".join(normalized_lines)


def _reviewed_input_id(
    *, extraction_ref: str, quality_manifest_ref: str, correction_profile: str
) -> str:
    return sha256(
        f"{extraction_ref}|{quality_manifest_ref}|{correction_profile}".encode("utf-8")
    ).hexdigest()[:24]
