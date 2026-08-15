import json
from pathlib import Path

from lcsp_workers.legal.official_text_extraction_repository import (
    OfficialTextExtractionRepository,
)
from lcsp_workers.legal.ocr_fallback_repository import (
    OcrFallbackRecord,
    OcrFallbackRepository,
)
from lcsp_workers.legal.ocr_quality_repository import (
    OcrQualityRecord,
    OcrQualityRepository,
)
from lcsp_workers.legal.reviewed_corpus_input_builder import (
    BuildReviewedCorpusInputRequest,
    ReviewedCorpusInputBuilder,
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


def _write_quality_record(
    *,
    storage_root: Path,
    extraction_ref: str,
    status: str = "READY",
    decision: str = "PASS",
) -> str:
    quality_ref = "quality-manifest:quality-12345678"
    repository = OcrQualityRepository(storage_root=storage_root)
    repository.save(
        OcrQualityRecord(
            quality_manifest_ref=quality_ref,
            provenance_ref="prov:quality:quality-12345678",
            extraction_ref=extraction_ref,
            expected_identity_ref="catalog-source:vbpl.vn:decree:13-2023-nd-cp",
            quality_profile="VI_LEGAL_V1",
            status=status,
            coverage_state="SUFFICIENT" if status == "READY" else "LIMITED",
            decision=decision,
            checked={
                "pageContinuity": status == "READY",
                "identity": status == "READY",
                "numbering": status == "READY",
                "hierarchy": status == "READY",
            },
            minimum_confidence=0.94 if status == "READY" else 0.0,
            finding_refs=[],
            evidence_refs=[quality_ref],
            limitations=[],
        )
    )
    return quality_ref


def _write_ocr_record(
    *,
    storage_root: Path,
    snapshot_ref: str,
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
    for page_number, text in text_by_page.items():
        span_manifest_ref = f"ocr-span-manifest:ocr-quality-1234:{page_number}"
        evidence_refs.append(f"ocr-page:ocr-quality-1234:{page_number}")
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
                    "meanConfidence": 0.96,
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
                "meanConfidence": 0.96,
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
            limitations=[],
            profile="VI_OFFICIAL_V1",
            page_numbers=sorted(text_by_page),
            evidence_refs=evidence_refs,
            pages=pages,
        )
    )
    return ocr_ref


def _builder(storage_root: Path) -> ReviewedCorpusInputBuilder:
    return ReviewedCorpusInputBuilder(
        storage_root=storage_root,
        extraction_repository=OfficialTextExtractionRepository(storage_root=storage_root),
        ocr_repository=OcrFallbackRepository(storage_root=storage_root),
        quality_repository=OcrQualityRepository(storage_root=storage_root),
    )


def test_builder_creates_repeatable_reviewed_input_from_canonical_extraction(tmp_path: Path):
    storage_root = tmp_path / "storage"
    extraction_ref = _write_canonical_extraction(
        storage_root=storage_root,
        snapshot_ref="snapshot:LAW-TEST:abcd1234ef56",
        document_number="13/2023/NĐ-CP",
        spans=[
            {"pageNumber": 1, "text": "Điều 1. Phạm vi điều chỉnh"},
            {"pageNumber": 1, "text": "1. Nội dung áp dụng"},
            {"pageNumber": 1, "text": "1. Nội dung áp dụng"},
            {"pageNumber": 1, "text": "a) Chi tiết"},
        ],
    )
    quality_ref = _write_quality_record(
        storage_root=storage_root,
        extraction_ref=extraction_ref,
    )

    builder = _builder(storage_root)
    first = builder.build(
        BuildReviewedCorpusInputRequest(
            extraction_ref=extraction_ref,
            quality_manifest_ref=quality_ref,
            correction_profile="DETERMINISTIC_V1",
        )
    )
    second = builder.build(
        BuildReviewedCorpusInputRequest(
            extraction_ref=extraction_ref,
            quality_manifest_ref=quality_ref,
            correction_profile="DETERMINISTIC_V1",
        )
    )

    assert first.status == "READY"
    assert second.status == "READY"
    assert first.reviewed_input_ref == second.reviewed_input_ref
    assert first.content_sha256 == second.content_sha256
    manifest = json.loads(first.manifest_path.read_text(encoding="utf-8"))
    text = first.normalized_text_path.read_text(encoding="utf-8")
    assert manifest["manualApprovalRequired"] is False
    assert "manualApprovalState" not in manifest
    assert "manualApprover" not in manifest
    assert "Điều 1. Phạm vi điều chỉnh" in text
    assert text.count("1. Nội dung áp dụng") == 1


def test_builder_blocks_when_quality_gate_did_not_pass(tmp_path: Path):
    storage_root = tmp_path / "storage"
    extraction_ref = _write_canonical_extraction(
        storage_root=storage_root,
        snapshot_ref="snapshot:LAW-TEST:abcd1234ef56",
        document_number="13/2023/NĐ-CP",
        spans=[{"pageNumber": 1, "text": "Điều 1. Phạm vi điều chỉnh"}],
    )
    quality_ref = _write_quality_record(
        storage_root=storage_root,
        extraction_ref=extraction_ref,
        status="OUT_OF_COVERAGE",
    )

    result = _builder(storage_root).build(
        BuildReviewedCorpusInputRequest(
            extraction_ref=extraction_ref,
            quality_manifest_ref=quality_ref,
            correction_profile="DETERMINISTIC_V1",
        )
    )

    assert result.status == "BLOCKED"
    assert result.limitations[0]["code"] == "QUALITY_GATE_BLOCKED"


def test_builder_returns_conflict_for_quality_extraction_mismatch(tmp_path: Path):
    storage_root = tmp_path / "storage"
    extraction_ref = _write_canonical_extraction(
        storage_root=storage_root,
        snapshot_ref="snapshot:LAW-TEST:abcd1234ef56",
        document_number="13/2023/NĐ-CP",
        spans=[{"pageNumber": 1, "text": "Điều 1. Phạm vi điều chỉnh"}],
    )
    quality_ref = _write_quality_record(
        storage_root=storage_root,
        extraction_ref="extraction:someone-else",
    )

    result = _builder(storage_root).build(
        BuildReviewedCorpusInputRequest(
            extraction_ref=extraction_ref,
            quality_manifest_ref=quality_ref,
            correction_profile="DETERMINISTIC_V1",
        )
    )

    assert result.status == "CONFLICT"
    assert result.limitations[0]["code"] == "QUALITY_MANIFEST_MISMATCH"


def test_builder_blocks_unsupported_correction_profile(tmp_path: Path):
    storage_root = tmp_path / "storage"
    extraction_ref = _write_canonical_extraction(
        storage_root=storage_root,
        snapshot_ref="snapshot:LAW-TEST:abcd1234ef56",
        document_number="13/2023/NĐ-CP",
        spans=[{"pageNumber": 1, "text": "Điều 1. Phạm vi điều chỉnh"}],
    )
    quality_ref = _write_quality_record(
        storage_root=storage_root,
        extraction_ref=extraction_ref,
    )

    result = _builder(storage_root).build(
        BuildReviewedCorpusInputRequest(
            extraction_ref=extraction_ref,
            quality_manifest_ref=quality_ref,
            correction_profile="FREEFORM_V2",
        )
    )

    assert result.status == "BLOCKED"
    assert result.limitations[0]["code"] == "UNSUPPORTED_CORRECTION_PROFILE"


def test_builder_creates_reviewed_input_from_ocr_pages(tmp_path: Path):
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
        text_by_page={
            1: "Điều 1. Phạm vi điều chỉnh",
            2: "1. Nội dung áp dụng",
        },
    )
    quality_ref = _write_quality_record(
        storage_root=storage_root,
        extraction_ref=ocr_ref,
    )

    result = _builder(storage_root).build(
        BuildReviewedCorpusInputRequest(
            extraction_ref=ocr_ref,
            quality_manifest_ref=quality_ref,
            correction_profile="DETERMINISTIC_V1",
        )
    )

    assert result.status == "READY"
    assert result.source_kind == "OCR"
    assert result.normalized_text_path.read_text(encoding="utf-8").startswith(
        "Điều 1. Phạm vi điều chỉnh"
    )
