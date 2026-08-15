from pathlib import Path
from types import SimpleNamespace

import json
import pytest

from lcsp_workers.legal.legal_chunk_consumer import (
    LEGAL_CHUNK_COMMAND,
    LEGAL_CHUNK_QUEUE,
    LegalChunkConsumer,
)
from lcsp_workers.legal.legal_chunk_repository import LegalChunkRepository
from lcsp_workers.platform.queue_consumer import NonRetryableWorkerError


def _write_reviewed_input(*, storage_root: Path, reviewed_input_ref: str, text: str):
    from lcsp_workers.legal.official_text_extraction import _sha256_text
    from lcsp_workers.legal.reviewed_corpus_input_repository import (
        ReviewedCorpusInputRecord,
        ReviewedCorpusInputRepository,
    )

    output_dir = storage_root / "reviewed-corpus-inputs" / "reviewed-input-123456"
    output_dir.mkdir(parents=True, exist_ok=True)
    normalized_text_path = output_dir / "LAW-TEST.reviewed.txt"
    manifest_path = output_dir / "LAW-TEST.reviewed-input.json"
    normalized_text_path.write_text(text + "\n", encoding="utf-8")
    content_sha256 = _sha256_text(text)
    manifest_path.write_text(
        json.dumps(
            {
                "reviewedInputRef": reviewed_input_ref,
                "provenanceRef": "prov:reviewed-input:reviewed-input-123456",
                "extractionRef": "extraction:canonical-12345678",
                "qualityManifestRef": "quality-manifest:quality-12345678",
                "correctionProfile": "DETERMINISTIC_V1",
                "contentSha256": content_sha256,
                "qualityDecision": "PASS",
                "manualApprovalRequired": False,
                "documentId": "LAW-TEST",
                "snapshotRef": "snapshot:LAW-TEST:abcd1234ef56",
                "sourceKind": "CANONICAL",
                "normalizedTextFile": normalized_text_path.name,
                "evidenceRefs": [f"{reviewed_input_ref}:{content_sha256}"],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    ReviewedCorpusInputRepository(storage_root=storage_root).save(
        ReviewedCorpusInputRecord(
            reviewed_input_ref=reviewed_input_ref,
            provenance_ref="prov:reviewed-input:reviewed-input-123456",
            extraction_ref="extraction:canonical-12345678",
            quality_manifest_ref="quality-manifest:quality-12345678",
            correction_profile="DETERMINISTIC_V1",
            status="READY",
            coverage_state="SUFFICIENT",
            content_sha256=content_sha256,
            quality_decision="PASS",
            manual_approval_required=False,
            document_id="LAW-TEST",
            snapshot_ref="snapshot:LAW-TEST:abcd1234ef56",
            source_kind="CANONICAL",
            normalized_text_path=str(normalized_text_path),
            manifest_path=str(manifest_path),
            evidence_refs=[f"{reviewed_input_ref}:{content_sha256}"],
            limitations=[],
        )
    )


def test_consumer_persists_chunk_set(tmp_path: Path):
    storage_root = tmp_path / "storage"
    reviewed_input_ref = "reviewed-input:reviewed-input-123456"
    _write_reviewed_input(
        storage_root=storage_root,
        reviewed_input_ref=reviewed_input_ref,
        text="\n".join(
            [
                "Điều 1. Phạm vi điều chỉnh",
                "1. Nội dung áp dụng",
            ]
        ),
    )
    config = SimpleNamespace(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-key",
        max_retries=3,
        legal_source_storage_root=str(storage_root),
    )
    consumer = LegalChunkConsumer(config)

    consumer.handle(
        {
            "reviewedInputRef": reviewed_input_ref,
            "documentIdentityRef": "catalog-source:vbpl.vn:decree:13-2023-nd-cp",
            "chunkSchemaVersion": "LEGAL_CHUNK_V1",
        },
        correlationId="corr-chunks",
    )

    repository = LegalChunkRepository(storage_root=storage_root)
    records = list(
        (
            storage_root / "legal-chunk-sets" / "registry" / "provenance"
        ).glob("*.json")
    )
    assert len(records) == 1
    record = repository.get_by_provenance_ref(records[0].stem.replace("__", ":"))
    assert record is not None
    assert record.status == "READY"
    assert record.chunk_count >= 2


def test_consumer_declares_authoritative_queue_binding():
    assert LegalChunkConsumer.queue_name == LEGAL_CHUNK_QUEUE
    assert LegalChunkConsumer.routing_key == LEGAL_CHUNK_COMMAND


def test_consumer_rejects_missing_required_field(tmp_path: Path):
    config = SimpleNamespace(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-key",
        max_retries=3,
        legal_source_storage_root=str(tmp_path / "storage"),
    )
    consumer = LegalChunkConsumer(config)

    with pytest.raises(
        NonRetryableWorkerError, match="missing required field: documentIdentityRef"
    ):
        consumer.handle(
            {
                "reviewedInputRef": "reviewed-input:test",
                "chunkSchemaVersion": "LEGAL_CHUNK_V1",
            },
            correlationId="corr-missing",
        )
