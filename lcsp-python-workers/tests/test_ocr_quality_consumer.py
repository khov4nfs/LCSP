import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from lcsp_workers.legal.ocr_quality_consumer import (
    OCR_QUALITY_COMMAND,
    OCR_QUALITY_QUEUE,
    OcrQualityConsumer,
)
from lcsp_workers.legal.ocr_quality_repository import OcrQualityRepository
from lcsp_workers.platform.queue_consumer import NonRetryableWorkerError


def _write_canonical_extraction(*, storage_root, snapshot_ref, document_number, spans):
    extraction_id = "canonical-12345678"
    extraction_ref = f"extraction:{extraction_id}"
    output_dir = storage_root / "official-text-extractions" / "LAW-TEST_abcd1234ef56"
    output_dir.mkdir(parents=True, exist_ok=True)
    spans_path = output_dir / "LAW-TEST.extraction.spans.json"
    manifest_path = output_dir / "LAW-TEST.extraction.manifest.json"
    spans_json = json.dumps(spans, ensure_ascii=False, indent=2) + "\n"
    from lcsp_workers.legal.official_text_extraction import _sha256_bytes
    from lcsp_workers.legal.official_text_extraction_repository import (
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


def test_consumer_persists_quality_manifest(tmp_path: Path):
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
    config = SimpleNamespace(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-key",
        max_retries=3,
        legal_source_storage_root=str(storage_root),
    )
    consumer = OcrQualityConsumer(config)

    consumer.handle(
        {
            "extractionRef": extraction_ref,
            "expectedIdentityRef": "catalog-source:vbpl.vn:decree:13-2023-nd-cp",
            "qualityProfile": "VI_LEGAL_V1",
        },
        correlationId="corr-quality",
    )

    repository = OcrQualityRepository(storage_root=storage_root)
    records = list(
        (
            storage_root / "official-ocr-quality" / "registry" / "provenance"
        ).glob("*.json")
    )
    assert len(records) == 1
    record = repository.get_by_provenance_ref(records[0].stem.replace("__", ":"))
    assert record is not None
    assert record.status == "READY"


def test_consumer_declares_authoritative_queue_binding():
    assert OcrQualityConsumer.queue_name == OCR_QUALITY_QUEUE
    assert OcrQualityConsumer.routing_key == OCR_QUALITY_COMMAND


def test_consumer_rejects_missing_required_field(tmp_path: Path):
    config = SimpleNamespace(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-key",
        max_retries=3,
        legal_source_storage_root=str(tmp_path / "storage"),
    )
    consumer = OcrQualityConsumer(config)

    with pytest.raises(
        NonRetryableWorkerError, match="missing required field: expectedIdentityRef"
    ):
        consumer.handle(
            {
                "extractionRef": "extraction:test",
                "qualityProfile": "VI_LEGAL_V1",
            },
            correlationId="corr-missing",
        )
