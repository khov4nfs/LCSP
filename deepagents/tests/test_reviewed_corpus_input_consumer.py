from pathlib import Path
from types import SimpleNamespace

import pytest

from tools.legal.legal.reviewed_corpus_input_boundary import (
    REVIEWED_CORPUS_INPUT_COMMAND,
    REVIEWED_CORPUS_INPUT_BOUNDARY_SOURCE,
    ReviewedCorpusInputBoundary,
)
from tools.legal.legal.reviewed_corpus_input_repository import (
    ReviewedCorpusInputRepository,
)
from tools.common.managed.boundary import NonRetryableAgentBoundaryError


def _write_canonical_extraction(*, storage_root, snapshot_ref, document_number, spans):
    import json

    extraction_id = "canonical-12345678"
    extraction_ref = f"extraction:{extraction_id}"
    output_dir = storage_root / "official-text-extractions" / "LAW-TEST_abcd1234ef56"
    output_dir.mkdir(parents=True, exist_ok=True)
    spans_path = output_dir / "LAW-TEST.extraction.spans.json"
    manifest_path = output_dir / "LAW-TEST.extraction.manifest.json"
    spans_json = json.dumps(spans, ensure_ascii=False, indent=2) + "\n"
    from tools.legal.legal.official_text_extraction import _sha256_bytes
    from tools.legal.legal.official_text_extraction_repository import (
        OfficialTextExtractionRepository,
    )

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


def _write_quality_record(*, storage_root, extraction_ref):
    from tools.legal.legal.ocr_quality_repository import (
        OcrQualityRecord,
        OcrQualityRepository,
    )

    quality_ref = "quality-manifest:quality-12345678"
    OcrQualityRepository(storage_root=storage_root).save(
        OcrQualityRecord(
            quality_manifest_ref=quality_ref,
            provenance_ref="prov:quality:quality-12345678",
            extraction_ref=extraction_ref,
            expected_identity_ref="catalog-source:vbpl.vn:decree:13-2023-nd-cp",
            quality_profile="VI_LEGAL_V1",
            status="READY",
            coverage_state="SUFFICIENT",
            decision="PASS",
            checked={
                "pageContinuity": True,
                "identity": True,
                "numbering": True,
                "hierarchy": True,
            },
            minimum_confidence=0.94,
            finding_refs=[],
            evidence_refs=[quality_ref],
            limitations=[],
        )
    )
    return quality_ref


def test_consumer_persists_reviewed_input_manifest(tmp_path: Path):
    storage_root = tmp_path / "storage"
    extraction_ref = _write_canonical_extraction(
        storage_root=storage_root,
        snapshot_ref="snapshot:LAW-TEST:abcd1234ef56",
        document_number="13/2023/NĐ-CP",
        spans=[
            {"pageNumber": 1, "text": "Điều 1. Phạm vi điều chỉnh"},
            {"pageNumber": 1, "text": "1. Nội dung áp dụng"},
        ],
    )
    quality_ref = _write_quality_record(
        storage_root=storage_root,
        extraction_ref=extraction_ref,
    )
    config = SimpleNamespace(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-key",
        max_retries=3,
        legal_source_storage_root=str(storage_root),
    )
    boundary = ReviewedCorpusInputBoundary(config)

    boundary.handle(
        {
            "extractionRef": extraction_ref,
            "qualityManifestRef": quality_ref,
            "correctionProfile": "DETERMINISTIC_V1",
        },
        correlationId="corr-reviewed-input",
    )

    repository = ReviewedCorpusInputRepository(storage_root=storage_root)
    records = list(
        (
            storage_root / "reviewed-corpus-inputs" / "registry" / "provenance"
        ).glob("*.json")
    )
    assert len(records) == 1
    record = repository.get_by_provenance_ref(records[0].stem.replace("__", ":"))
    assert record is not None
    assert record.status == "READY"
    assert record.manual_approval_required is False


def test_consumer_declares_authoritative_queue_binding():
    assert ReviewedCorpusInputBoundary.boundary_source == REVIEWED_CORPUS_INPUT_BOUNDARY_SOURCE
    assert ReviewedCorpusInputBoundary.source_event == REVIEWED_CORPUS_INPUT_COMMAND


def test_consumer_rejects_missing_required_field(tmp_path: Path):
    config = SimpleNamespace(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-key",
        max_retries=3,
        legal_source_storage_root=str(tmp_path / "storage"),
    )
    boundary = ReviewedCorpusInputBoundary(config)

    with pytest.raises(
        NonRetryableAgentBoundaryError, match="missing required field: qualityManifestRef"
    ):
        boundary.handle(
            {
                "extractionRef": "extraction:test",
                "correctionProfile": "DETERMINISTIC_V1",
            },
            correlationId="corr-missing",
        )
