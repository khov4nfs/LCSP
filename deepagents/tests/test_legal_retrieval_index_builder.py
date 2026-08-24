import json
from pathlib import Path

from tools.legal.legal.chunk_integrity_repository import ChunkIntegrityRecord, ChunkIntegrityRepository
from tools.legal.legal.legal_chunk_builder import BuildLegalChunksRequest, LegalChunkBuilder
from tools.legal.legal.legal_chunk_repository import LegalChunkRepository
from tools.legal.legal.legal_retrieval_index_builder import (
    BuildLegalRetrievalIndexRequest,
    LegalRetrievalIndexBuilder,
    _effect_metadata,
)
from tools.legal.legal.reviewed_corpus_input_repository import (
    ReviewedCorpusInputRecord,
    ReviewedCorpusInputRepository,
)


class FakeIndexStore:
    def __init__(self) -> None:
        self.collections: dict[str, list[dict]] = {}
        self.raise_error: str | None = None

    def replace_collection(self, *, collection_name: str, records: list[dict]) -> int:
        if self.raise_error is not None:
            raise RuntimeError(self.raise_error)
        self.collections[collection_name] = records
        return len(records)


def _write_reviewed_input(storage_root: Path) -> str:
    output_dir = storage_root / "reviewed-corpus-inputs" / "reviewed-input-123456"
    output_dir.mkdir(parents=True, exist_ok=True)
    normalized_text_path = output_dir / "LAW-TEST.reviewed.txt"
    manifest_path = output_dir / "LAW-TEST.reviewed-input.json"
    text = "\n".join(
        [
            "Điều 1. Test",
            "1. Nội dung",
            "a) Point A",
            "Điều 2. More",
        ]
    )
    normalized_text_path.write_text(text + "\n", encoding="utf-8")
    from tools.legal.legal.official_text_extraction import _sha256_text

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
    return "reviewed-input:reviewed-input-123456"


def _build_chunk_set(storage_root: Path) -> str:
    reviewed_input_ref = _write_reviewed_input(storage_root)
    result = LegalChunkBuilder(
        storage_root=storage_root,
        reviewed_input_repository=ReviewedCorpusInputRepository(storage_root=storage_root),
    ).build(
        BuildLegalChunksRequest(
            reviewed_input_ref=reviewed_input_ref,
            document_identity_ref="catalog-source:vbpl.vn:law:law-test",
            chunk_schema_version="LEGAL_CHUNK_V1",
        )
    )
    assert result.status == "READY"
    LegalChunkRepository(storage_root=storage_root).save(result.to_record())
    return result.chunk_set_ref


def _save_integrity_manifest(storage_root: Path, chunk_set_ref: str, *, status: str = "READY", decision: str = "PASS") -> str:
    integrity_ref = "integrity-manifest:test"
    output_dir = storage_root / "chunk-integrity-manifests" / "test"
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "manifest.json"
    findings_path = output_dir / "findings.json"
    manifest_path.write_text("{}\n", encoding="utf-8")
    findings_path.write_text("[]\n", encoding="utf-8")
    ChunkIntegrityRepository(storage_root=storage_root).save(
        ChunkIntegrityRecord(
            validation_manifest_ref=integrity_ref,
            provenance_ref="prov:integrity:test",
            chunk_set_ref=chunk_set_ref,
            relationship_manifest_ref="relationship-manifest:test",
            validation_profile="LEGAL_INTEGRITY_V1",
            status=status,
            coverage_state="SUFFICIENT" if status == "READY" else "UNAVAILABLE",
            decision=decision,
            checked_rules=["HASHES"],
            finding_refs=[],
            evidence_refs=[integrity_ref],
            limitations=[],
            manifest_path=str(manifest_path),
            findings_path=str(findings_path),
        )
    )
    return integrity_ref


def _builder(storage_root: Path, store: FakeIndexStore) -> LegalRetrievalIndexBuilder:
    return LegalRetrievalIndexBuilder(
        storage_root=storage_root,
        chunk_repository=LegalChunkRepository(storage_root=storage_root),
        integrity_repository=ChunkIntegrityRepository(storage_root=storage_root),
        index_store=store,
    )


def test_builder_creates_deterministic_index_manifest_and_records(tmp_path: Path):
    storage_root = tmp_path / "storage"
    store = FakeIndexStore()
    chunk_set_ref = _build_chunk_set(storage_root)
    integrity_ref = _save_integrity_manifest(storage_root, chunk_set_ref)

    result = _builder(storage_root, store).build(
        BuildLegalRetrievalIndexRequest(
            chunk_set_ref=chunk_set_ref,
            integrity_manifest_ref=integrity_ref,
            index_profile="CHROMA_STRUCTURE_V1",
        )
    )

    assert result.status == "READY"
    assert result.indexed_chunk_count >= 3
    assert result.collection_name == f"legal_chunks_{chunk_set_ref.split(':', 1)[1]}"
    payload = json.loads(result.records_path.read_text(encoding="utf-8"))
    assert payload[0]["metadata"]["hierarchical_path"].startswith("art-")
    assert result.collection_name in store.collections


def test_effect_observations_are_serialized_into_index_metadata():
    metadata = _effect_metadata(
        [
            {
                "effectKind": "AMENDED",
                "type": {"typeCode": "10", "typeRef": "old-ref"},
                "newType": {"typeCode": "13", "typeRef": "new-ref"},
                "reviewRequired": True,
            },
            {
                "effectKind": "AMENDED",
                "type": {"typeCode": "10", "typeRef": "old-ref"},
                "reviewRequired": True,
            },
        ]
    )

    assert json.loads(metadata["effect_kinds"]) == ["AMENDED"]
    assert json.loads(metadata["effect_type_codes"]) == ["10"]
    assert json.loads(metadata["effect_type_refs"]) == ["old-ref"]
    assert json.loads(metadata["effect_new_type_codes"]) == ["13"]
    assert json.loads(metadata["effect_new_type_refs"]) == ["new-ref"]
    assert metadata["effect_observation_count"] == 2
    assert metadata["effect_review_required"] == "true"


def test_builder_blocks_when_integrity_gate_did_not_pass(tmp_path: Path):
    storage_root = tmp_path / "storage"
    store = FakeIndexStore()
    chunk_set_ref = _build_chunk_set(storage_root)
    integrity_ref = _save_integrity_manifest(
        storage_root, chunk_set_ref, status="BLOCKED", decision="BLOCKED"
    )

    result = _builder(storage_root, store).build(
        BuildLegalRetrievalIndexRequest(
            chunk_set_ref=chunk_set_ref,
            integrity_manifest_ref=integrity_ref,
            index_profile="CHROMA_STRUCTURE_V1",
        )
    )

    assert result.status == "BLOCKED"
    assert result.limitations[0]["code"] == "INTEGRITY_GATE_BLOCKED"


def test_builder_returns_failed_when_index_store_write_fails(tmp_path: Path):
    storage_root = tmp_path / "storage"
    store = FakeIndexStore()
    store.raise_error = "chroma unavailable"
    chunk_set_ref = _build_chunk_set(storage_root)
    integrity_ref = _save_integrity_manifest(storage_root, chunk_set_ref)

    result = _builder(storage_root, store).build(
        BuildLegalRetrievalIndexRequest(
            chunk_set_ref=chunk_set_ref,
            integrity_manifest_ref=integrity_ref,
            index_profile="CHROMA_STRUCTURE_V1",
        )
    )

    assert result.status == "FAILED"
    assert result.limitations[0]["code"] == "CHROMA_WRITE_FAILED"


def test_builder_returns_needs_input_for_missing_integrity_manifest(tmp_path: Path):
    storage_root = tmp_path / "storage"
    store = FakeIndexStore()
    chunk_set_ref = _build_chunk_set(storage_root)

    result = _builder(storage_root, store).build(
        BuildLegalRetrievalIndexRequest(
            chunk_set_ref=chunk_set_ref,
            integrity_manifest_ref="integrity-manifest:missing",
            index_profile="CHROMA_STRUCTURE_V1",
        )
    )

    assert result.status == "NEEDS_INPUT"
    assert result.limitations[0]["code"] == "INTEGRITY_MANIFEST_MISSING"


def test_builder_is_idempotent_once_registry_record_exists(tmp_path: Path):
    storage_root = tmp_path / "storage"
    store = FakeIndexStore()
    chunk_set_ref = _build_chunk_set(storage_root)
    integrity_ref = _save_integrity_manifest(storage_root, chunk_set_ref)
    repository_path = storage_root

    first = _builder(storage_root, store).build(
        BuildLegalRetrievalIndexRequest(
            chunk_set_ref=chunk_set_ref,
            integrity_manifest_ref=integrity_ref,
            index_profile="CHROMA_STRUCTURE_V1",
        )
    )
    from tools.legal.legal.legal_retrieval_index_repository import LegalRetrievalIndexRepository

    LegalRetrievalIndexRepository(storage_root=repository_path).save(first.to_record())
    before = dict(store.collections)

    second = _builder(storage_root, store).build(
        BuildLegalRetrievalIndexRequest(
            chunk_set_ref=chunk_set_ref,
            integrity_manifest_ref=integrity_ref,
            index_profile="CHROMA_STRUCTURE_V1",
        )
    )

    assert second.index_ref == first.index_ref
    assert second.index_checksum == first.index_checksum
    assert store.collections == before
