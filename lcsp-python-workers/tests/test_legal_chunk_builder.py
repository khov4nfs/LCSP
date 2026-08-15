import json
from pathlib import Path

from lcsp_workers.legal.legal_chunk_builder import (
    BuildLegalChunksRequest,
    LegalChunkBuilder,
)
from lcsp_workers.legal.reviewed_corpus_input_repository import (
    ReviewedCorpusInputRecord,
    ReviewedCorpusInputRepository,
)


def _write_reviewed_input(
    *,
    storage_root: Path,
    reviewed_input_ref: str,
    text: str,
    document_id: str = "LAW-TEST",
    snapshot_ref: str = "snapshot:LAW-TEST:abcd1234ef56",
    source_kind: str = "CANONICAL",
) -> str:
    output_dir = storage_root / "reviewed-corpus-inputs" / "reviewed-input-123456"
    output_dir.mkdir(parents=True, exist_ok=True)
    normalized_text_path = output_dir / f"{document_id}.reviewed.txt"
    manifest_path = output_dir / f"{document_id}.reviewed-input.json"
    normalized_text_path.write_text(text + "\n", encoding="utf-8")
    from lcsp_workers.legal.official_text_extraction import _sha256_text

    content_sha256 = _sha256_text(text)
    manifest = {
        "reviewedInputRef": reviewed_input_ref,
        "provenanceRef": "prov:reviewed-input:reviewed-input-123456",
        "extractionRef": "extraction:canonical-12345678",
        "qualityManifestRef": "quality-manifest:quality-12345678",
        "correctionProfile": "DETERMINISTIC_V1",
        "contentSha256": content_sha256,
        "qualityDecision": "PASS",
        "manualApprovalRequired": False,
        "documentId": document_id,
        "snapshotRef": snapshot_ref,
        "sourceKind": source_kind,
        "normalizedTextFile": normalized_text_path.name,
        "evidenceRefs": [f"{reviewed_input_ref}:{content_sha256}"],
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
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
            document_id=document_id,
            snapshot_ref=snapshot_ref,
            source_kind=source_kind,
            normalized_text_path=str(normalized_text_path),
            manifest_path=str(manifest_path),
            evidence_refs=[f"{reviewed_input_ref}:{content_sha256}"],
            limitations=[],
        )
    )
    return reviewed_input_ref


def _builder(storage_root: Path) -> LegalChunkBuilder:
    return LegalChunkBuilder(
        storage_root=storage_root,
        reviewed_input_repository=ReviewedCorpusInputRepository(storage_root=storage_root),
    )


def test_builder_creates_stable_article_clause_point_chunks(tmp_path: Path):
    storage_root = tmp_path / "storage"
    reviewed_input_ref = _write_reviewed_input(
        storage_root=storage_root,
        reviewed_input_ref="reviewed-input:reviewed-input-123456",
        text="\n".join(
            [
                "Chương I",
                "QUY ĐỊNH CHUNG",
                "Điều 1. Phạm vi điều chỉnh",
                "1. Nội dung áp dụng",
                "a) Chi tiết",
                "b) Bổ sung",
                "Điều 2. Phạm vi khác",
            ]
        ),
    )

    first = _builder(storage_root).build(
        BuildLegalChunksRequest(
            reviewed_input_ref=reviewed_input_ref,
            document_identity_ref="catalog-source:vbpl.vn:decree:13-2023-nd-cp",
            chunk_schema_version="LEGAL_CHUNK_V1",
        )
    )
    second = _builder(storage_root).build(
        BuildLegalChunksRequest(
            reviewed_input_ref=reviewed_input_ref,
            document_identity_ref="catalog-source:vbpl.vn:decree:13-2023-nd-cp",
            chunk_schema_version="LEGAL_CHUNK_V1",
        )
    )

    assert first.status == "READY"
    assert second.status == "READY"
    assert first.chunk_set_ref == second.chunk_set_ref
    assert first.chunk_manifest_sha256 == second.chunk_manifest_sha256
    payload = json.loads(first.chunks_path.read_text(encoding="utf-8"))
    locators = {item["locator"] for item in payload}
    assert {"art-1", "art-1::cl-1", "art-1::cl-1::pt-a", "art-1::cl-1::pt-b", "art-2"} <= locators
    clause = next(item for item in payload if item["locator"] == "art-1::cl-1")
    point_a = next(item for item in payload if item["locator"] == "art-1::cl-1::pt-a")
    assert clause["hierarchy"]["parentChunkId"] == "13-2023-ND-CP:ART-1".replace("-", "-").upper().replace("ART", "ART") or clause["hierarchy"]["parentChunkId"].endswith(":art-1")
    assert point_a["hierarchy"]["parentChunkId"] == clause["id"]
    assert "a) Chi tiết" in clause["content"]
    assert "b) Bổ sung" in clause["content"]
    response = first.to_tool_response(correlationId="corr-chunks")
    serialized = json.dumps(response, ensure_ascii=False)
    assert "Nội dung áp dụng" not in serialized


def test_builder_returns_needs_input_for_missing_reviewed_input(tmp_path: Path):
    storage_root = tmp_path / "storage"
    result = _builder(storage_root).build(
        BuildLegalChunksRequest(
            reviewed_input_ref="reviewed-input:missing",
            document_identity_ref="catalog-source:vbpl.vn:decree:13-2023-nd-cp",
            chunk_schema_version="LEGAL_CHUNK_V1",
        )
    )

    assert result.status == "NEEDS_INPUT"
    assert result.limitations[0]["code"] == "REVIEWED_INPUT_MISSING"


def test_builder_returns_conflict_for_hash_mismatch(tmp_path: Path):
    storage_root = tmp_path / "storage"
    reviewed_input_ref = _write_reviewed_input(
        storage_root=storage_root,
        reviewed_input_ref="reviewed-input:reviewed-input-123456",
        text="Điều 1. Phạm vi điều chỉnh",
    )
    text_path = (
        storage_root
        / "reviewed-corpus-inputs"
        / "reviewed-input-123456"
        / "LAW-TEST.reviewed.txt"
    )
    text_path.write_text("tampered\n", encoding="utf-8")

    result = _builder(storage_root).build(
        BuildLegalChunksRequest(
            reviewed_input_ref=reviewed_input_ref,
            document_identity_ref="catalog-source:vbpl.vn:decree:13-2023-nd-cp",
            chunk_schema_version="LEGAL_CHUNK_V1",
        )
    )

    assert result.status == "CONFLICT"
    assert result.limitations[0]["code"] == "REVIEWED_INPUT_HASH_MISMATCH"


def test_builder_returns_conflict_for_duplicate_locator(tmp_path: Path):
    storage_root = tmp_path / "storage"
    reviewed_input_ref = _write_reviewed_input(
        storage_root=storage_root,
        reviewed_input_ref="reviewed-input:reviewed-input-123456",
        text="\n".join(
            [
                "Điều 1. First",
                "1. A",
                "Điều 1. Duplicate",
                "1. B",
            ]
        ),
    )

    result = _builder(storage_root).build(
        BuildLegalChunksRequest(
            reviewed_input_ref=reviewed_input_ref,
            document_identity_ref="catalog-source:vbpl.vn:decree:13-2023-nd-cp",
            chunk_schema_version="LEGAL_CHUNK_V1",
        )
    )

    assert result.status == "CONFLICT"
    assert result.limitations[0]["code"] == "DUPLICATE_LOCATOR"


def test_builder_returns_needs_input_for_malformed_hierarchy(tmp_path: Path):
    storage_root = tmp_path / "storage"
    reviewed_input_ref = _write_reviewed_input(
        storage_root=storage_root,
        reviewed_input_ref="reviewed-input:reviewed-input-123456",
        text="Nội dung trôi trước khi có Điều",
    )

    result = _builder(storage_root).build(
        BuildLegalChunksRequest(
            reviewed_input_ref=reviewed_input_ref,
            document_identity_ref="catalog-source:vbpl.vn:decree:13-2023-nd-cp",
            chunk_schema_version="LEGAL_CHUNK_V1",
        )
    )

    assert result.status == "NEEDS_INPUT"
    assert result.limitations[0]["code"] == "MALFORMED_HIERARCHY"
