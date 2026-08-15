from pathlib import Path
from types import SimpleNamespace

import pytest

from lcsp_workers.legal.chunk_integrity_repository import ChunkIntegrityRecord, ChunkIntegrityRepository
from lcsp_workers.legal.legal_chunk_builder import BuildLegalChunksRequest, LegalChunkBuilder
from lcsp_workers.legal.legal_chunk_repository import LegalChunkRepository
from lcsp_workers.legal.legal_retrieval_index_consumer import (
    LEGAL_RETRIEVAL_INDEX_COMMAND,
    LEGAL_RETRIEVAL_INDEX_QUEUE,
    LegalRetrievalIndexConsumer,
)
from lcsp_workers.legal.legal_retrieval_index_repository import LegalRetrievalIndexRepository
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
    integrity_ref = "integrity-manifest:test"
    ChunkIntegrityRepository(storage_root=storage_root).save(
        ChunkIntegrityRecord(
            validation_manifest_ref=integrity_ref,
            provenance_ref="prov:integrity:test",
            chunk_set_ref=chunk_result.chunk_set_ref,
            relationship_manifest_ref="relationship-manifest:test",
            validation_profile="LEGAL_INTEGRITY_V1",
            status="READY",
            coverage_state="SUFFICIENT",
            decision="PASS",
            checked_rules=["HASHES"],
            finding_refs=[],
            evidence_refs=[integrity_ref],
            limitations=[],
            manifest_path=str(storage_root / "chunk-integrity-manifests" / "test" / "manifest.json"),
            findings_path=str(storage_root / "chunk-integrity-manifests" / "test" / "findings.json"),
        )
    )
    return chunk_result.chunk_set_ref, integrity_ref


def test_consumer_persists_legal_retrieval_index(tmp_path: Path):
    storage_root = tmp_path / "storage"
    chunk_set_ref, integrity_ref = _seed(storage_root)
    config = SimpleNamespace(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-key",
        max_retries=3,
        legal_source_storage_root=str(storage_root),
    )
    consumer = LegalRetrievalIndexConsumer(config)

    from unittest.mock import patch
    
    with patch("lcsp_workers.legal.legal_retrieval_index_consumer.LegalRetrievalIndexBuilder") as MockBuilder:
        # We need the real builder, but with FakeIndexStore
        from lcsp_workers.legal.legal_retrieval_index_builder import LegalRetrievalIndexBuilder
        class FakeIndexStore:
            def __init__(self) -> None:
                self.collections = {}
                self.raise_error = None
            def replace_collection(self, *, collection_name: str, records: list[dict]) -> int:
                if self.raise_error is not None:
                    raise RuntimeError(self.raise_error)
                self.collections[collection_name] = records
                return len(records)
        
        def _mock_build(*args, **kwargs):
            real_builder = LegalRetrievalIndexBuilder(
                storage_root=storage_root,
                chunk_repository=LegalChunkRepository(storage_root=storage_root),
                integrity_repository=ChunkIntegrityRepository(storage_root=storage_root),
                index_store=FakeIndexStore(),
            )
            return real_builder.build(*args, **kwargs)
            
        MockBuilder.return_value.build.side_effect = _mock_build
        
        consumer.handle(
            {
                "chunkSetRef": chunk_set_ref,
                "integrityManifestRef": integrity_ref,
                "indexProfile": "CHROMA_STRUCTURE_V1",
            },
            correlationId="corr-index",
        )

    records = list(
        (storage_root / "legal-indexes" / "registry" / "provenance").glob("*.json")
    )
    assert len(records) == 1
    record = LegalRetrievalIndexRepository(storage_root=storage_root).get_by_provenance_ref(
        records[0].stem.replace("__", ":")
    )
    assert record is not None
    assert record.status == "READY"
    assert record.indexed_chunk_count >= 2


def test_consumer_declares_authoritative_queue_binding():
    assert LegalRetrievalIndexConsumer.queue_name == LEGAL_RETRIEVAL_INDEX_QUEUE
    assert LegalRetrievalIndexConsumer.routing_key == LEGAL_RETRIEVAL_INDEX_COMMAND


def test_consumer_rejects_missing_required_field(tmp_path: Path):
    config = SimpleNamespace(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-key",
        max_retries=3,
        legal_source_storage_root=str(tmp_path / "storage"),
    )
    consumer = LegalRetrievalIndexConsumer(config)

    with pytest.raises(
        NonRetryableWorkerError, match="missing required field: integrityManifestRef"
    ):
        consumer.handle(
            {
                "chunkSetRef": "chunk-set:test",
                "indexProfile": "CHROMA_STRUCTURE_V1",
            },
            correlationId="corr-missing",
        )
