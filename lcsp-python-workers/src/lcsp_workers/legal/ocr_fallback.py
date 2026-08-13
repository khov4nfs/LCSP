from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Any, Callable, Sequence

from .official_text_extraction import OfficialSourceSnapshotResolver
from .official_text_extraction_repository import OfficialTextExtractionRepository
from .ocr_fallback_repository import OcrFallbackRecord

OCR_FALLBACK_TOOL = {
    "name": "run_ocr_fallback",
    "version": "1.0.0",
    "config_hash": "sha256:ocr-vi-v1",
}

OCR_PROFILES = {
    "vi_official_v1": "VI_OFFICIAL_V1",
}

OCR_STATUSES = {
    "ready": "READY",
    "blocked": "BLOCKED",
    "needs_input": "NEEDS_INPUT",
    "failed": "FAILED",
}

OCR_COVERAGE_STATES = {
    "partial": "PARTIAL",
    "unavailable": "UNAVAILABLE",
}

OCR_LIMITATION_CODES = {
    "ocr_required": "OCR_REQUIRED",
    "fallback_proof_missing": "FALLBACK_PROOF_MISSING",
    "canonical_extraction_sufficient": "CANONICAL_EXTRACTION_SUFFICIENT",
    "unsupported_snapshot_type": "UNSUPPORTED_SNAPSHOT_TYPE",
    "missing_page": "MISSING_PAGE",
    "ocr_timeout": "OCR_TIMEOUT",
}

SUPPORTED_OCR_CONTENT_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
}

RunCommand = Callable[..., subprocess.CompletedProcess[str]]


@dataclass(frozen=True)
class OcrFallbackRequest:
    snapshot_ref: str
    fallback_proof_ref: str
    page_numbers: list[int]
    ocr_profile: str
    output_dir: Path


@dataclass(frozen=True)
class OcrFallbackPageResult:
    page: int
    page_image_sha256: str
    span_manifest_ref: str
    mean_confidence: float

    def to_json(self) -> dict[str, Any]:
        return {
            "page": self.page,
            "pageImageSha256": self.page_image_sha256,
            "spanManifestRef": self.span_manifest_ref,
            "meanConfidence": self.mean_confidence,
        }


@dataclass(frozen=True)
class OcrFallbackResult:
    status: str
    ocr_ref: str
    ocr_id: str
    provenance_ref: str
    snapshot_ref: str
    fallback_proof_ref: str
    coverage_state: str
    limitations: list[dict[str, Any]]
    evidence_refs: list[str]
    pages: list[OcrFallbackPageResult]
    profile: str

    def to_tool_response(self, *, correlationId: str) -> dict[str, Any]:
        return {
            "status": self.status,
            "toolName": OCR_FALLBACK_TOOL["name"],
            "toolVersion": OCR_FALLBACK_TOOL["version"],
            "configHash": OCR_FALLBACK_TOOL["config_hash"],
            "correlationId": correlationId,
            "artifactVersions": {
                "snapshotId": self.snapshot_ref.removeprefix("snapshot:"),
                "ocrId": self.ocr_id,
            },
            "provenanceRef": self.provenance_ref,
            "coverageState": self.coverage_state,
            "evidenceRefs": self.evidence_refs,
            "limitations": self.limitations,
            "result": {
                "ocrRef": self.ocr_ref,
                "pages": [page.to_json() for page in self.pages],
                "profile": self.profile,
            },
        }

    def to_record(self) -> OcrFallbackRecord:
        return OcrFallbackRecord(
            ocr_ref=self.ocr_ref,
            provenance_ref=self.provenance_ref,
            snapshot_ref=self.snapshot_ref,
            fallback_proof_ref=self.fallback_proof_ref,
            status=self.status,
            coverage_state=self.coverage_state,
            limitations=self.limitations,
            profile=self.profile,
            page_numbers=[page.page for page in self.pages],
            evidence_refs=self.evidence_refs,
            pages=[page.to_json() for page in self.pages],
        )


class OcrFallbackTool:
    def __init__(
        self,
        *,
        snapshot_resolver: OfficialSourceSnapshotResolver,
        extraction_repository: OfficialTextExtractionRepository,
        run_command: RunCommand = subprocess.run,
    ) -> None:
        self._snapshot_resolver = snapshot_resolver
        self._extraction_repository = extraction_repository
        self._run_command = run_command
        self._timeout_seconds = 90

    def run(self, request: OcrFallbackRequest) -> OcrFallbackResult:
        profile = self._normalize_profile(request.ocr_profile)
        ocr_id = _ocr_id(
            snapshot_ref=request.snapshot_ref,
            fallback_proof_ref=request.fallback_proof_ref,
            page_numbers=request.page_numbers,
            profile=profile,
        )
        ocr_ref = f"ocr:{ocr_id}"
        provenance_ref = f"prov:ocr:{ocr_id}"

        proof = self._extraction_repository.get_by_provenance_ref(
            request.fallback_proof_ref
        )
        if proof is None:
            return self._blocked_result(
                ocr_id=ocr_id,
                ocr_ref=ocr_ref,
                provenance_ref=provenance_ref,
                snapshot_ref=request.snapshot_ref,
                fallback_proof_ref=request.fallback_proof_ref,
                profile=profile,
                code=OCR_LIMITATION_CODES["fallback_proof_missing"],
                reason="fallback proof record was not found",
            )
        if proof.snapshot_ref != request.snapshot_ref:
            return self._blocked_result(
                ocr_id=ocr_id,
                ocr_ref=ocr_ref,
                provenance_ref=provenance_ref,
                snapshot_ref=request.snapshot_ref,
                fallback_proof_ref=request.fallback_proof_ref,
                profile=profile,
                code=OCR_LIMITATION_CODES["fallback_proof_missing"],
                reason="fallback proof does not belong to the requested snapshot",
            )
        if proof.canonical_extraction_available:
            return self._blocked_result(
                ocr_id=ocr_id,
                ocr_ref=ocr_ref,
                provenance_ref=provenance_ref,
                snapshot_ref=request.snapshot_ref,
                fallback_proof_ref=request.fallback_proof_ref,
                profile=profile,
                code=OCR_LIMITATION_CODES["canonical_extraction_sufficient"],
                reason="canonical extraction is already available for this snapshot",
            )

        resolved_snapshot = self._snapshot_resolver.resolve(snapshot_ref=request.snapshot_ref)
        if resolved_snapshot.content_type not in SUPPORTED_OCR_CONTENT_TYPES:
            return self._blocked_result(
                ocr_id=ocr_id,
                ocr_ref=ocr_ref,
                provenance_ref=provenance_ref,
                snapshot_ref=request.snapshot_ref,
                fallback_proof_ref=request.fallback_proof_ref,
                profile=profile,
                code=OCR_LIMITATION_CODES["unsupported_snapshot_type"],
                reason="snapshot content type is not supported for OCR fallback",
            )

        try:
            pages = self._ocr_pages(
                artifact_path=resolved_snapshot.artifact_path,
                content_type=resolved_snapshot.content_type,
                page_numbers=request.page_numbers,
                profile=profile,
                output_dir=request.output_dir,
                ocr_id=ocr_id,
                snapshot_ref=request.snapshot_ref,
                fallback_proof_ref=request.fallback_proof_ref,
            )
        except subprocess.TimeoutExpired:
            return self._failed_result(
                ocr_id=ocr_id,
                snapshot_ref=request.snapshot_ref,
                fallback_proof_ref=request.fallback_proof_ref,
                profile=profile,
                code=OCR_LIMITATION_CODES["ocr_timeout"],
                reason="OCR fallback timed out before completion",
            )
        if isinstance(pages, OcrFallbackResult):
            return pages
        return OcrFallbackResult(
            status=OCR_STATUSES["ready"],
            ocr_ref=ocr_ref,
            ocr_id=ocr_id,
            provenance_ref=provenance_ref,
            snapshot_ref=request.snapshot_ref,
            fallback_proof_ref=request.fallback_proof_ref,
            coverage_state=OCR_COVERAGE_STATES["partial"],
            limitations=[
                {
                    "code": OCR_LIMITATION_CODES["ocr_required"],
                    "affectedScopeRef": request.snapshot_ref,
                    "reason": "CANONICAL_EXTRACTION_UNAVAILABLE",
                    "retryable": False,
                }
            ],
            evidence_refs=[f"ocr-page:{ocr_id}:{page.page}" for page in pages],
            pages=pages,
            profile=profile,
        )

    def _ocr_pages(
        self,
        *,
        artifact_path: Path,
        content_type: str,
        page_numbers: list[int],
        profile: str,
        output_dir: Path,
        ocr_id: str,
        snapshot_ref: str,
        fallback_proof_ref: str,
    ) -> list[OcrFallbackPageResult] | OcrFallbackResult:
        self._require_command("tesseract")
        if content_type == "application/pdf":
            self._require_command("pdftoppm")
            return self._ocr_pdf_pages(
                artifact_path=artifact_path,
                page_numbers=page_numbers,
                profile=profile,
                output_dir=output_dir,
                ocr_id=ocr_id,
                snapshot_ref=snapshot_ref,
                fallback_proof_ref=fallback_proof_ref,
            )
        if page_numbers != [1]:
            return self._needs_input_result(
                ocr_id=ocr_id,
                snapshot_ref=snapshot_ref,
                fallback_proof_ref=fallback_proof_ref,
                profile=profile,
                page_numbers=page_numbers,
            )
        output_dir.mkdir(parents=True, exist_ok=True)
        page_image_sha = _sha256_bytes(artifact_path.read_bytes())
        text = self._ocr_text(artifact_path, profile)
        mean_confidence = self._ocr_confidence(artifact_path, profile)
        span_manifest_ref = self._write_page_artifacts(
            output_dir=output_dir,
            ocr_id=ocr_id,
            page_number=1,
            page_image_sha=page_image_sha,
            text=text,
            mean_confidence=mean_confidence,
        )
        return [
            OcrFallbackPageResult(
                page=1,
                page_image_sha256=page_image_sha,
                span_manifest_ref=span_manifest_ref,
                mean_confidence=mean_confidence,
            )
        ]

    def _ocr_pdf_pages(
        self,
        *,
        artifact_path: Path,
        page_numbers: list[int],
        profile: str,
        output_dir: Path,
        ocr_id: str,
        snapshot_ref: str,
        fallback_proof_ref: str,
    ) -> list[OcrFallbackPageResult] | OcrFallbackResult:
        results: list[OcrFallbackPageResult] = []
        output_dir.mkdir(parents=True, exist_ok=True)
        for page_number in page_numbers:
            with tempfile.TemporaryDirectory(prefix="lcsp-ocr-page-") as temp_dir:
                prefix = Path(temp_dir) / f"page-{page_number}"
                self._run(
                    [
                        "pdftoppm",
                        "-png",
                        "-f",
                        str(page_number),
                        "-l",
                        str(page_number),
                        str(artifact_path),
                        str(prefix),
                    ]
                )
                image_candidates = sorted(Path(temp_dir).glob(f"page-{page_number}*.png"))
                if not image_candidates:
                    return self._needs_input_result(
                        ocr_id=ocr_id,
                        snapshot_ref=snapshot_ref,
                        fallback_proof_ref=fallback_proof_ref,
                        profile=profile,
                        page_numbers=[page_number],
                    )
                image_path = image_candidates[0]
                page_image_sha = _sha256_bytes(image_path.read_bytes())
                text = self._ocr_text(image_path, profile)
                mean_confidence = self._ocr_confidence(image_path, profile)
                span_manifest_ref = self._write_page_artifacts(
                    output_dir=output_dir,
                    ocr_id=ocr_id,
                    page_number=page_number,
                    page_image_sha=page_image_sha,
                    text=text,
                    mean_confidence=mean_confidence,
                )
                results.append(
                    OcrFallbackPageResult(
                        page=page_number,
                        page_image_sha256=page_image_sha,
                        span_manifest_ref=span_manifest_ref,
                        mean_confidence=mean_confidence,
                    )
                )
        return results

    def _ocr_text(self, image_path: Path, profile: str) -> str:
        language = self._profile_language(profile)
        result = self._run(["tesseract", str(image_path), "stdout", "-l", language])
        return result.stdout.strip()

    def _ocr_confidence(self, image_path: Path, profile: str) -> float:
        language = self._profile_language(profile)
        result = self._run(
            ["tesseract", str(image_path), "stdout", "-l", language, "tsv"]
        )
        confidence_values: list[float] = []
        for line in result.stdout.splitlines()[1:]:
            columns = line.split("\t")
            if len(columns) < 11:
                continue
            try:
                value = float(columns[10])
            except ValueError:
                continue
            if value >= 0:
                confidence_values.append(value / 100.0)
        if not confidence_values:
            return 0.0
        return round(sum(confidence_values) / len(confidence_values), 4)

    def _write_page_artifacts(
        self,
        *,
        output_dir: Path,
        ocr_id: str,
        page_number: int,
        page_image_sha: str,
        text: str,
        mean_confidence: float,
    ) -> str:
        page_dir = output_dir / ocr_id
        page_dir.mkdir(parents=True, exist_ok=True)
        text_path = page_dir / f"page-{page_number}.ocr.txt"
        manifest_path = page_dir / f"page-{page_number}.ocr.json"
        text_path.write_text(text + "\n", encoding="utf-8")
        span_manifest_ref = f"ocr-span-manifest:{ocr_id}:{page_number}"
        manifest_path.write_text(
            json.dumps(
                {
                    "spanManifestRef": span_manifest_ref,
                    "page": page_number,
                    "pageImageSha256": page_image_sha,
                    "textSha256": _sha256_text(text),
                    "meanConfidence": mean_confidence,
                    "textFile": text_path.name,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        return span_manifest_ref

    def _blocked_result(
        self,
        *,
        ocr_id: str,
        ocr_ref: str,
        provenance_ref: str,
        snapshot_ref: str,
        fallback_proof_ref: str,
        profile: str,
        code: str,
        reason: str,
    ) -> OcrFallbackResult:
        return OcrFallbackResult(
            status=OCR_STATUSES["blocked"],
            ocr_ref=ocr_ref,
            ocr_id=ocr_id,
            provenance_ref=provenance_ref,
            snapshot_ref=snapshot_ref,
            fallback_proof_ref=fallback_proof_ref,
            coverage_state=OCR_COVERAGE_STATES["unavailable"],
            limitations=[
                {
                    "code": code,
                    "affectedScopeRef": snapshot_ref or None,
                    "reason": reason,
                    "retryable": False,
                }
            ],
            evidence_refs=[],
            pages=[],
            profile=profile,
        )

    def _needs_input_result(
        self,
        *,
        ocr_id: str,
        snapshot_ref: str,
        fallback_proof_ref: str,
        profile: str,
        page_numbers: list[int],
    ) -> OcrFallbackResult:
        return OcrFallbackResult(
            status=OCR_STATUSES["needs_input"],
            ocr_ref=f"ocr:{ocr_id}",
            ocr_id=ocr_id,
            provenance_ref=f"prov:ocr:{ocr_id}",
            snapshot_ref=snapshot_ref,
            fallback_proof_ref=fallback_proof_ref,
            coverage_state=OCR_COVERAGE_STATES["unavailable"],
            limitations=[
                {
                    "code": OCR_LIMITATION_CODES["missing_page"],
                    "affectedScopeRef": snapshot_ref or None,
                    "reason": "requested OCR page is unavailable: "
                    + ", ".join(str(value) for value in page_numbers),
                    "retryable": False,
                }
            ],
            evidence_refs=[],
            pages=[],
            profile=profile,
        )

    def _failed_result(
        self,
        *,
        ocr_id: str,
        snapshot_ref: str,
        fallback_proof_ref: str,
        profile: str,
        code: str,
        reason: str,
    ) -> OcrFallbackResult:
        return OcrFallbackResult(
            status=OCR_STATUSES["failed"],
            ocr_ref=f"ocr:{ocr_id}",
            ocr_id=ocr_id,
            provenance_ref=f"prov:ocr:{ocr_id}",
            snapshot_ref=snapshot_ref,
            fallback_proof_ref=fallback_proof_ref,
            coverage_state=OCR_COVERAGE_STATES["unavailable"],
            limitations=[
                {
                    "code": code,
                    "affectedScopeRef": snapshot_ref,
                    "reason": reason,
                    "retryable": False,
                }
            ],
            evidence_refs=[],
            pages=[],
            profile=profile,
        )

    def _normalize_profile(self, value: str) -> str:
        normalized = value.strip().upper()
        if normalized in OCR_PROFILES.values():
            return normalized
        raise ValueError("unsupported OCR profile")

    def _profile_language(self, profile: str) -> str:
        if profile == OCR_PROFILES["vi_official_v1"]:
            return "vie+eng"
        raise ValueError("unsupported OCR profile")

    def _require_command(self, command: str) -> None:
        if shutil.which(command) is None:
            raise RuntimeError(f"{command} is required for OCR fallback")

    def _run(self, command: Sequence[str]) -> subprocess.CompletedProcess[str]:
        return self._run_command(
            command,
            check=True,
            text=True,
            capture_output=True,
            timeout=self._timeout_seconds,
        )


def _ocr_id(
    *,
    snapshot_ref: str,
    fallback_proof_ref: str,
    page_numbers: list[int],
    profile: str,
) -> str:
    digest = _sha256_text(
        f"{snapshot_ref}:{fallback_proof_ref}:{profile}:{','.join(str(v) for v in page_numbers)}"
    )[7:26]
    return f"{snapshot_ref.removeprefix('snapshot:').replace(':', '-')}-{digest}"


def _sha256_text(value: str) -> str:
    return _sha256_bytes(value.encode("utf-8"))


def _sha256_bytes(value: bytes) -> str:
    return f"sha256:{sha256(value).hexdigest()}"
