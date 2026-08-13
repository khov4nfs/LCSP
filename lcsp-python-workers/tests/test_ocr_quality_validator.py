import json
from pathlib import Path

from lcsp_workers.legal.official_text_extraction_repository import (
    OfficialTextExtractionRepository,
)
from lcsp_workers.legal.ocr_fallback_repository import (
    OcrFallbackRecord,
    OcrFallbackRepository,
)
from lcsp_workers.legal.ocr_quality_validator import (
    EvaluateOcrQualityRequest,
    OcrQualityValidator,
)


def _write_canonical_extraction(
    *,
    storage_root: Path,
    snapshot_ref: str,
    document_number: str,
    spans: list[dict],
) -> str:
    extraction_id = "canonical-12345678"
    extraction_ref = f"extraction:{extraction_id}"
    output_dir = storage_root / "official-text-extractions" / "LAW-TEST_abcd1234ef56"
    output_dir.mkdir(parents=True, exist_ok=True)
    spans_path = output_dir / "LAW-TEST.extraction.spans.json"
    manifest_path = output_dir / "LAW-TEST.extraction.manifest.json"
    spans_json = json.dumps(spans, ensure_ascii=False, indent=2) + "\n"
    from lcsp_workers.legal.official_text_extraction import _sha256_bytes

    span_manifest_sha256 = _sha256_bytes(spans_json.encode("utf-8"))
    spans_path.write_text(spans_json, encoding="utf-8")
    manifest_path.write_text(
        json.dumps(
            {
                "extractionRef": extraction_ref,
                "snapshotRef": snapshot_ref,
                "documentId": "LAW-TEST",
                "extractorProfile": "HTML_OFFICIAL_V1",
                "format": "HTML",
                "pageCount": 1,
                "spanCount": len(spans),
                "spanManifestSha256": span_manifest_sha256,
                "spansFile": spans_path.name,
                "identityCandidate": {
                    "documentNumber": document_number,
                    "sourceEffectStatus": "CON_HIEU_LUC",
                },
                "canonicalExtractionAvailable": True,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    payload = {
        "extractionRef": extraction_ref,
        "provenanceRef": "prov:extract:canonical-12345678",
        "snapshotRef": snapshot_ref,
        "documentId": "LAW-TEST",
        "status": "READY",
        "coverageState": "SUFFICIENT",
        "canonicalExtractionAvailable": True,
        "limitations": [],
        "format": "HTML",
        "pageCount": 1,
        "spanCount": len(spans),
        "spanManifestPath": str(manifest_path),
        "spansPath": str(spans_path),
        "spanManifestSha256": span_manifest_sha256,
        "identityCandidate": {
            "documentNumber": document_number,
            "sourceEffectStatus": "CON_HIEU_LUC",
        },
    }
    repository = OfficialTextExtractionRepository(storage_root=storage_root)
    repository._write_json(  # type: ignore[attr-defined]
        storage_root
        / "official-text-extractions"
        / "registry"
        / "extractions"
        / f"{extraction_ref.replace(':', '__')}.json",
        payload,
    )
    repository._write_json(  # type: ignore[attr-defined]
        storage_root
        / "official-text-extractions"
        / "registry"
        / "provenance"
        / "prov__extract__canonical-12345678.json",
        payload,
    )
    return extraction_ref


def _write_ocr_record(
    *,
    storage_root: Path,
    snapshot_ref: str,
    mean_confidence: float,
    page_numbers: list[int],
    text_by_page: dict[int, str],
) -> str:
    ocr_ref = "ocr:ocr-quality-1234"
    provenance_ref = "prov:ocr:ocr-quality-1234"
    repository = OcrFallbackRepository(storage_root=storage_root)
    output_dir = (
        storage_root
        / "official-ocr-fallbacks"
        / snapshot_ref.removeprefix("snapshot:").replace(":", "_")
        / "ocr-quality-1234"
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    from lcsp_workers.legal.official_text_extraction import _sha256_text

    pages = []
    evidence_refs = []
    for page_number in page_numbers:
        span_manifest_ref = f"ocr-span-manifest:ocr-quality-1234:{page_number}"
        evidence_refs.append(f"ocr-page:ocr-quality-1234:{page_number}")
        text = text_by_page[page_number]
        (output_dir / f"page-{page_number}.ocr.txt").write_text(
            text + "\n", encoding="utf-8"
        )
        (output_dir / f"page-{page_number}.ocr.json").write_text(
            json.dumps(
                {
                    "spanManifestRef": span_manifest_ref,
                    "page": page_number,
                    "pageImageSha256": "sha256:" + "1" * 64,
                    "textSha256": _sha256_text(text),
                    "meanConfidence": mean_confidence,
                    "textFile": f"page-{page_number}.ocr.txt",
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        pages.append(
            {
                "page": page_number,
                "pageImageSha256": "sha256:" + "1" * 64,
                "spanManifestRef": span_manifest_ref,
                "meanConfidence": mean_confidence,
            }
        )
    repository.save(
        OcrFallbackRecord(
            ocr_ref=ocr_ref,
            provenance_ref=provenance_ref,
            snapshot_ref=snapshot_ref,
            fallback_proof_ref="prov:extract:canonical-12345678",
            status="READY",
            coverage_state="PARTIAL",
            limitations=[
                {
                    "code": "OCR_REQUIRED",
                    "affectedScopeRef": snapshot_ref,
                    "reason": "CANONICAL_EXTRACTION_UNAVAILABLE",
                    "retryable": False,
                }
            ],
            profile="VI_OFFICIAL_V1",
            page_numbers=page_numbers,
            evidence_refs=evidence_refs,
            pages=pages,
        )
    )
    return ocr_ref


def _validator(storage_root: Path) -> OcrQualityValidator:
    return OcrQualityValidator(
        storage_root=storage_root,
        extraction_repository=OfficialTextExtractionRepository(storage_root=storage_root),
        ocr_repository=OcrFallbackRepository(storage_root=storage_root),
    )


def test_quality_validator_accepts_canonical_extraction_without_leaking_text(tmp_path: Path):
    storage_root = tmp_path / "storage"
    extraction_ref = _write_canonical_extraction(
        storage_root=storage_root,
        snapshot_ref="snapshot:LAW-TEST:abcd1234ef56",
        document_number="13/2023/NĐ-CP",
        spans=[
            {"pageNumber": 1, "text": "Điều 1. Phạm vi điều chỉnh"},
            {"pageNumber": 1, "text": "1. Nội dung áp dụng"},
            {"pageNumber": 1, "text": "a) Chi tiết"},
        ],
    )

    result = _validator(storage_root).evaluate(
        EvaluateOcrQualityRequest(
            extraction_ref=extraction_ref,
            expected_identity_ref="catalog-source:vbpl.vn:decree:13-2023-nd-cp",
            quality_profile="VI_LEGAL_V1",
        )
    )

    payload = result.to_tool_response(correlationId="corr-quality")
    assert result.status == "READY"
    assert result.coverage_state == "SUFFICIENT"
    assert payload["result"]["decision"] == "PASS"
    serialized = json.dumps(payload, ensure_ascii=False)
    assert "Điều 1. Phạm vi điều chỉnh" not in serialized
    assert "1. Nội dung áp dụng" not in serialized


def test_quality_validator_returns_conflict_when_identity_mismatches(tmp_path: Path):
    storage_root = tmp_path / "storage"
    extraction_ref = _write_canonical_extraction(
        storage_root=storage_root,
        snapshot_ref="snapshot:LAW-TEST:abcd1234ef56",
        document_number="77/2026/NĐ-CP",
        spans=[{"pageNumber": 1, "text": "Điều 1. Phạm vi điều chỉnh"}],
    )

    result = _validator(storage_root).evaluate(
        EvaluateOcrQualityRequest(
            extraction_ref=extraction_ref,
            expected_identity_ref="catalog-source:vbpl.vn:decree:13-2023-nd-cp",
            quality_profile="VI_LEGAL_V1",
        )
    )

    assert result.status == "CONFLICT"
    assert result.limitations[0]["code"] == "IDENTITY_MISMATCH"


def test_quality_validator_returns_out_of_coverage_for_low_confidence_ocr(tmp_path: Path):
    storage_root = tmp_path / "storage"
    _write_canonical_extraction(
        storage_root=storage_root,
        snapshot_ref="snapshot:LAW-TEST:abcd1234ef56",
        document_number="13/2023/NĐ-CP",
        spans=[],
    )
    ocr_ref = _write_ocr_record(
        storage_root=storage_root,
        snapshot_ref="snapshot:LAW-TEST:abcd1234ef56",
        mean_confidence=0.82,
        page_numbers=[1],
        text_by_page={1: "Điều 1. Phạm vi điều chỉnh\n1. Nội dung áp dụng"},
    )

    result = _validator(storage_root).evaluate(
        EvaluateOcrQualityRequest(
            extraction_ref=ocr_ref,
            expected_identity_ref="catalog-source:vbpl.vn:decree:13-2023-nd-cp",
            quality_profile="VI_LEGAL_V1",
        )
    )

    assert result.status == "OUT_OF_COVERAGE"
    assert result.limitations[0]["code"] == "LOW_CONFIDENCE"


def test_quality_validator_returns_out_of_coverage_for_page_gap(tmp_path: Path):
    storage_root = tmp_path / "storage"
    _write_canonical_extraction(
        storage_root=storage_root,
        snapshot_ref="snapshot:LAW-TEST:abcd1234ef56",
        document_number="13/2023/NĐ-CP",
        spans=[],
    )
    ocr_ref = _write_ocr_record(
        storage_root=storage_root,
        snapshot_ref="snapshot:LAW-TEST:abcd1234ef56",
        mean_confidence=0.95,
        page_numbers=[1, 3],
        text_by_page={
            1: "Điều 1. Phạm vi điều chỉnh",
            3: "1. Nội dung áp dụng",
        },
    )

    result = _validator(storage_root).evaluate(
        EvaluateOcrQualityRequest(
            extraction_ref=ocr_ref,
            expected_identity_ref="catalog-source:vbpl.vn:decree:13-2023-nd-cp",
            quality_profile="VI_LEGAL_V1",
        )
    )

    assert result.status == "OUT_OF_COVERAGE"
    assert result.limitations[0]["code"] == "PAGE_CONTINUITY_GAP"


def test_quality_validator_returns_needs_input_for_missing_record(tmp_path: Path):
    storage_root = tmp_path / "storage"
    result = _validator(storage_root).evaluate(
        EvaluateOcrQualityRequest(
            extraction_ref="ocr:missing-ref",
            expected_identity_ref="catalog-source:vbpl.vn:decree:13-2023-nd-cp",
            quality_profile="VI_LEGAL_V1",
        )
    )

    assert result.status == "NEEDS_INPUT"
    assert result.limitations[0]["code"] == "EXTRACTION_MISSING"
