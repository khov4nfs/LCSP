import json
from pathlib import Path

from tools.legal.legal.chunk_integrity_validator import (
    ChunkIntegrityValidator,
    ValidateChunkIntegrityRequest,
)
from tools.legal.legal.legal_chunk_builder import (
    BuildLegalChunksRequest,
    LegalChunkBuilder,
)
from tools.legal.legal.legal_chunk_repository import (
    LegalChunkRepository,
    LegalChunkSetRecord,
)
from tools.legal.legal.official_text_extraction import _sha256_bytes
from tools.legal.legal.relationship_manifest_repository import (
    RelationshipManifestRecord,
    RelationshipManifestRepository,
)
from tools.legal.legal.reviewed_corpus_input_repository import (
    ReviewedCorpusInputRecord,
    ReviewedCorpusInputRepository,
)


def _write_reviewed_input(
    *,
    storage_root: Path,
    reviewed_input_ref: str,
    text: str,
    document_id: str = "LAW-71-2025-QH15",
) -> str:
    output_dir = storage_root / "reviewed-corpus-inputs" / "reviewed-input-123456"
    output_dir.mkdir(parents=True, exist_ok=True)
    normalized_text_path = output_dir / f"{document_id}.reviewed.txt"
    manifest_path = output_dir / f"{document_id}.reviewed-input.json"
    normalized_text_path.write_text(text + "\n", encoding="utf-8")
    from tools.legal.legal.official_text_extraction import _sha256_text

    content_sha256 = _sha256_text(text)
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
            document_id=document_id,
            snapshot_ref="snapshot:LAW-71-2025-QH15:abcd1234ef56",
            source_kind="CANONICAL",
            normalized_text_path=str(normalized_text_path),
            manifest_path=str(manifest_path),
            evidence_refs=[f"{reviewed_input_ref}:{content_sha256}"],
            limitations=[],
        )
    )
    return reviewed_input_ref


def _build_chunk_set(storage_root: Path) -> str:
    reviewed_input_ref = _write_reviewed_input(
        storage_root=storage_root,
        reviewed_input_ref="reviewed-input:reviewed-input-123456",
        text="\n".join(
            [
                "Điều 3. Test",
                "9. Repealed clause",
                "Điều 4. Test",
                "7. Repealed clause",
                "Điều 12. Test",
                "6. Repealed clause",
                "Điều 34. Test",
                "2. Nội dung",
                "đ) Repealed point",
                "Điều 40. Boundary before",
                "Chương IV",
                "TRÍ TUỆ NHÂN TẠO",
                "Điều 41. A",
                "1. Clause with points:",
                "a) First point",
                "Điều 42. B",
                "Điều 43. C",
                "Điều 44. D",
                "Điều 45. E",
                "Điều 46. Boundary after",
            ]
        ),
    )
    result = LegalChunkBuilder(
        storage_root=storage_root,
        reviewed_input_repository=ReviewedCorpusInputRepository(storage_root=storage_root),
    ).build(
        BuildLegalChunksRequest(
            reviewed_input_ref=reviewed_input_ref,
            document_identity_ref="catalog-source:vbpl.vn:law:71-2025-qh15",
            chunk_schema_version="LEGAL_CHUNK_V1",
        )
    )
    assert result.status == "READY"
    LegalChunkRepository(storage_root=storage_root).save(result.to_record())
    return result.chunk_set_ref


def _save_chunk_record(
    storage_root: Path, chunk_record: LegalChunkSetRecord, chunk_payload: list[dict]
) -> None:
    chunks_text = json.dumps(chunk_payload, ensure_ascii=False, indent=2) + "\n"
    Path(chunk_record.chunks_path).write_text(chunks_text, encoding="utf-8")
    manifest = json.loads(Path(chunk_record.manifest_path).read_text(encoding="utf-8"))
    manifest["chunkManifestSha256"] = _sha256_bytes(chunks_text.encode("utf-8"))
    Path(chunk_record.manifest_path).write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    LegalChunkRepository(storage_root=storage_root).save(
        LegalChunkSetRecord(
            chunk_set_ref=chunk_record.chunk_set_ref,
            provenance_ref=chunk_record.provenance_ref,
            reviewed_input_ref=chunk_record.reviewed_input_ref,
            document_identity_ref=chunk_record.document_identity_ref,
            chunk_schema_version=chunk_record.chunk_schema_version,
            status=chunk_record.status,
            coverage_state=chunk_record.coverage_state,
            chunk_count=chunk_record.chunk_count,
            chunk_manifest_sha256=manifest["chunkManifestSha256"],
            document_id=chunk_record.document_id,
            chunks_path=chunk_record.chunks_path,
            manifest_path=chunk_record.manifest_path,
            evidence_refs=chunk_record.evidence_refs,
            limitations=chunk_record.limitations,
        )
    )


def _write_relationship_manifest(
    *,
    storage_root: Path,
    chunk_set_ref: str,
    source_effect_status: str = "HET_HIEU_LUC_MOT_PHAN",
) -> str:
    repo = LegalChunkRepository(storage_root=storage_root)
    chunk_record = repo.get_by_chunk_set_ref(chunk_set_ref)
    assert chunk_record is not None
    chunks = json.loads(Path(chunk_record.chunks_path).read_text(encoding="utf-8"))
    locator_map = {item["locator"]: item["id"] for item in chunks}
    manifest_ref = "relationship-manifest:article-33-law-134"
    output_dir = storage_root / "relationship-manifests" / "article-33"
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "sourceEffectStatus": source_effect_status,
                "materializedRelationships": [],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    RelationshipManifestRepository(storage_root=storage_root).save(
        RelationshipManifestRecord(
            relationship_manifest_ref=manifest_ref,
            provenance_ref="prov:relationship:article-33-law-134",
            chunk_set_ref=chunk_set_ref,
            target_document_id="LAW-71-2025-QH15",
            source_effect_status=source_effect_status,
            materialized_relationships=[
                {
                    "type": "LOCATOR_REPEAL",
                    "amendingDocumentId": "LAW-134-2025-QH15",
                    "amendingLocator": "art-33",
                    "targetDocumentId": "LAW-71-2025-QH15",
                    "declaredLocators": [
                        "art-3::cl-9",
                        "art-4::cl-7",
                        "art-12::cl-6",
                        "art-34::cl-2::pt-đ",
                        "art-41..art-45",
                    ],
                    "materializedChunkIds": [
                        locator_map["art-3::cl-9"],
                        locator_map["art-4::cl-7"],
                        locator_map["art-12::cl-6"],
                        locator_map["art-34::cl-2::pt-đ"],
                        locator_map["art-41"],
                        locator_map["art-41::cl-1"],
                        locator_map["art-41::cl-1::pt-a"],
                        locator_map["art-42"],
                        locator_map["art-43"],
                        locator_map["art-44"],
                        locator_map["art-45"],
                    ],
                    "boundaryAssertions": {
                        "art-40": "ACTIVE_OUTSIDE_REPEAL_RANGE",
                        "art-46": "ACTIVE_OUTSIDE_REPEAL_RANGE",
                    },
                }
            ],
            evidence_refs=[manifest_ref],
            limitations=[],
            manifest_path=str(manifest_path),
        )
    )
    return manifest_ref


def _validator(storage_root: Path) -> ChunkIntegrityValidator:
    return ChunkIntegrityValidator(
        storage_root=storage_root,
        chunk_repository=LegalChunkRepository(storage_root=storage_root),
        relationship_repository=RelationshipManifestRepository(storage_root=storage_root),
    )


def test_validator_returns_ready_for_valid_chunk_set_and_relationship_manifest(
    tmp_path: Path,
):
    storage_root = tmp_path / "storage"
    chunk_set_ref = _build_chunk_set(storage_root)
    relationship_manifest_ref = _write_relationship_manifest(
        storage_root=storage_root,
        chunk_set_ref=chunk_set_ref,
    )

    result = _validator(storage_root).validate(
        ValidateChunkIntegrityRequest(
            chunk_set_ref=chunk_set_ref,
            relationship_manifest_ref=relationship_manifest_ref,
            validation_profile="LEGAL_INTEGRITY_V1",
        )
    )

    assert result.status == "READY"
    assert result.decision == "PASS"
    assert result.finding_refs == []
    payload = json.loads(result.manifest_path.read_text(encoding="utf-8"))
    assert payload["checkedRules"] == [
        "HASHES",
        "HIERARCHY",
        "LOCATORS",
        "XREFS",
        "EFFECT_STATUS",
        "REPEAL_MAPPING",
    ]


def test_validator_returns_conflict_for_chunk_hash_mismatch(tmp_path: Path):
    storage_root = tmp_path / "storage"
    chunk_set_ref = _build_chunk_set(storage_root)
    relationship_manifest_ref = _write_relationship_manifest(
        storage_root=storage_root,
        chunk_set_ref=chunk_set_ref,
    )
    chunk_record = LegalChunkRepository(storage_root=storage_root).get_by_chunk_set_ref(
        chunk_set_ref
    )
    assert chunk_record is not None
    chunks = json.loads(Path(chunk_record.chunks_path).read_text(encoding="utf-8"))
    chunks[0]["content"] = "tampered"
    Path(chunk_record.chunks_path).write_text(
        json.dumps(chunks, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    result = _validator(storage_root).validate(
        ValidateChunkIntegrityRequest(
            chunk_set_ref=chunk_set_ref,
            relationship_manifest_ref=relationship_manifest_ref,
            validation_profile="LEGAL_INTEGRITY_V1",
        )
    )

    assert result.status == "CONFLICT"
    assert result.limitations[0]["code"] == "CHUNK_MANIFEST_HASH_MISMATCH"


def test_validator_returns_conflict_for_missing_xref_target(tmp_path: Path):
    storage_root = tmp_path / "storage"
    chunk_set_ref = _build_chunk_set(storage_root)
    relationship_manifest_ref = _write_relationship_manifest(
        storage_root=storage_root,
        chunk_set_ref=chunk_set_ref,
    )
    chunk_record = LegalChunkRepository(storage_root=storage_root).get_by_chunk_set_ref(
        chunk_set_ref
    )
    assert chunk_record is not None
    chunks = json.loads(Path(chunk_record.chunks_path).read_text(encoding="utf-8"))
    chunks[0]["outgoingRefIds"] = ["71-2025-QH15:art-999"]
    _save_chunk_record(storage_root, chunk_record, chunks)

    result = _validator(storage_root).validate(
        ValidateChunkIntegrityRequest(
            chunk_set_ref=chunk_set_ref,
            relationship_manifest_ref=relationship_manifest_ref,
            validation_profile="LEGAL_INTEGRITY_V1",
        )
    )

    assert result.status == "CONFLICT"
    findings = json.loads(result.findings_path.read_text(encoding="utf-8"))
    assert findings[0]["code"] == "XREF_TARGET_MISSING"


def test_validator_returns_needs_input_for_missing_relationship_manifest(tmp_path: Path):
    storage_root = tmp_path / "storage"
    chunk_set_ref = _build_chunk_set(storage_root)

    result = _validator(storage_root).validate(
        ValidateChunkIntegrityRequest(
            chunk_set_ref=chunk_set_ref,
            relationship_manifest_ref="relationship-manifest:missing",
            validation_profile="LEGAL_INTEGRITY_V1",
        )
    )

    assert result.status == "NEEDS_INPUT"
    assert result.limitations[0]["code"] == "RELATIONSHIP_MANIFEST_MISSING"


def test_validator_returns_blocked_for_effect_status_conflict(tmp_path: Path):
    storage_root = tmp_path / "storage"
    chunk_set_ref = _build_chunk_set(storage_root)
    RelationshipManifestRepository(storage_root=storage_root).save(
        RelationshipManifestRecord(
            relationship_manifest_ref="relationship-manifest:no-repeal",
            provenance_ref="prov:relationship:no-repeal",
            chunk_set_ref=chunk_set_ref,
            target_document_id="LAW-71-2025-QH15",
            source_effect_status="HET_HIEU_LUC_MOT_PHAN",
            materialized_relationships=[],
            evidence_refs=["relationship-manifest:no-repeal"],
            limitations=[],
            manifest_path=str(storage_root / "relationship-manifests" / "empty.json"),
        )
    )

    result = _validator(storage_root).validate(
        ValidateChunkIntegrityRequest(
            chunk_set_ref=chunk_set_ref,
            relationship_manifest_ref="relationship-manifest:no-repeal",
            validation_profile="LEGAL_INTEGRITY_V1",
        )
    )

    assert result.status == "BLOCKED"
    assert result.decision == "BLOCKED"
    assert result.limitations[0]["code"] == "LEGAL_EFFECT_STATUS_CONFLICT"
