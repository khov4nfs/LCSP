from pathlib import Path
from types import SimpleNamespace

import pytest

from lcsp_workers.legal.chunk_integrity_consumer import (
    CHUNK_INTEGRITY_COMMAND,
    CHUNK_INTEGRITY_QUEUE,
    ChunkIntegrityConsumer,
)
from lcsp_workers.legal.chunk_integrity_repository import ChunkIntegrityRepository
from lcsp_workers.legal.legal_chunk_builder import (
    BuildLegalChunksRequest,
    LegalChunkBuilder,
)
from lcsp_workers.legal.legal_chunk_repository import LegalChunkRepository
from lcsp_workers.legal.relationship_manifest_repository import (
    RelationshipManifestRecord,
    RelationshipManifestRepository,
)
from lcsp_workers.legal.reviewed_corpus_input_repository import (
    ReviewedCorpusInputRecord,
    ReviewedCorpusInputRepository,
)
from lcsp_workers.platform.queue_consumer import NonRetryableWorkerError


def _seed(storage_root: Path) -> tuple[str, str]:
    output_dir = storage_root / "reviewed-corpus-inputs" / "reviewed-input-123456"
    output_dir.mkdir(parents=True, exist_ok=True)
    normalized_text_path = output_dir / "LAW-TEST.reviewed.txt"
    manifest_path = output_dir / "LAW-TEST.reviewed-input.json"
    text = "\n".join(["Điều 1. Test", "1. Nội dung", "Điều 2. More"])
    normalized_text_path.write_text(text + "\n", encoding="utf-8")
    from lcsp_workers.legal.official_text_extraction import _sha256_text

    content_sha256 = _sha256_text(text)
    ReviewedCorpusInputRepository(storage_root=storage_root).save(
        ReviewedCorpusInputRecord(
            reviewed_input_ref="reviewed-input:reviewed-input-123456",
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
            evidence_refs=["reviewed-input:reviewed-input-123456"],
            limitations=[],
        )
    )
    chunk_result = LegalChunkBuilder(
        storage_root=storage_root,
        reviewed_input_repository=ReviewedCorpusInputRepository(storage_root=storage_root),
    ).build(
        BuildLegalChunksRequest(
            reviewed_input_ref="reviewed-input:reviewed-input-123456",
            document_identity_ref="catalog-source:vbpl.vn:law:law-test",
            chunk_schema_version="LEGAL_CHUNK_V1",
        )
    )
    LegalChunkRepository(storage_root=storage_root).save(chunk_result.to_record())
    RelationshipManifestRepository(storage_root=storage_root).save(
        RelationshipManifestRecord(
            relationship_manifest_ref="relationship-manifest:test",
            provenance_ref="prov:relationship:test",
            chunk_set_ref=chunk_result.chunk_set_ref,
            target_document_id="LAW-TEST",
            source_effect_status="CON_HIEU_LUC",
            materialized_relationships=[],
            evidence_refs=["relationship-manifest:test"],
            limitations=[],
            manifest_path=str(storage_root / "relationship-manifests" / "test.json"),
        )
    )
    return chunk_result.chunk_set_ref, "relationship-manifest:test"


def test_consumer_persists_integrity_manifest(tmp_path: Path):
    storage_root = tmp_path / "storage"
    chunk_set_ref, relationship_manifest_ref = _seed(storage_root)
    config = SimpleNamespace(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-key",
        max_retries=3,
        legal_source_storage_root=str(storage_root),
    )
    consumer = ChunkIntegrityConsumer(config)

    consumer.handle(
        {
            "chunkSetRef": chunk_set_ref,
            "relationshipManifestRef": relationship_manifest_ref,
            "validationProfile": "LEGAL_INTEGRITY_V1",
        },
        correlationId="corr-integrity",
    )

    records = list(
        (storage_root / "chunk-integrity-manifests" / "registry" / "provenance").glob(
            "*.json"
        )
    )
    assert len(records) == 1
    record = ChunkIntegrityRepository(storage_root=storage_root).get_by_provenance_ref(
        records[0].stem.replace("__", ":")
    )
    assert record is not None
    assert record.status == "READY"
    assert record.decision == "PASS"


def test_consumer_declares_authoritative_queue_binding():
    assert ChunkIntegrityConsumer.queue_name == CHUNK_INTEGRITY_QUEUE
    assert ChunkIntegrityConsumer.routing_key == CHUNK_INTEGRITY_COMMAND


def test_consumer_rejects_missing_required_field(tmp_path: Path):
    config = SimpleNamespace(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-key",
        max_retries=3,
        legal_source_storage_root=str(tmp_path / "storage"),
    )
    consumer = ChunkIntegrityConsumer(config)

    with pytest.raises(
        NonRetryableWorkerError, match="missing required field: relationshipManifestRef"
    ):
        consumer.handle(
            {
                "chunkSetRef": "chunk-set:test",
                "validationProfile": "LEGAL_INTEGRITY_V1",
            },
            correlationId="corr-missing",
        )
