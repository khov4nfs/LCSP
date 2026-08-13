import json
import subprocess
from pathlib import Path

import pytest

from lcsp_workers.legal.official_text_extraction import OfficialSourceSnapshotResolver
from lcsp_workers.legal.official_text_extraction_repository import (
    OfficialTextExtractionRepository,
)
from lcsp_workers.legal.ocr_fallback import OcrFallbackRequest, OcrFallbackTool
from lcsp_workers.legal.ocr_fallback_repository import (
    OcrFallbackConflictError,
    OcrFallbackRecord,
    OcrFallbackRepository,
)


class SnapshotClient:
    def __init__(
        self,
        *,
        snapshot_ref: str,
        document_id: str,
        content_sha256: str,
        content_type: str,
        snapshot_object_key: str,
    ) -> None:
        self._payload = {
            "snapshotRef": snapshot_ref,
            "documentId": document_id,
            "contentSha256": content_sha256,
            "contentType": content_type,
            "snapshotObjectKey": snapshot_object_key,
        }

    def get_official_source_snapshot(
        self, *, snapshot_ref: str | None = None, snapshot_id: str | None = None
    ) -> dict:
        return dict(self._payload)


def _write_extraction_record(
    *,
    storage_root: Path,
    provenance_ref: str,
    snapshot_ref: str,
    canonical_extraction_available: bool,
) -> None:
    extraction_repository = OfficialTextExtractionRepository(storage_root=storage_root)
    extraction_repository._write_json(  # type: ignore[attr-defined]
        storage_root
        / "official-text-extractions"
        / "registry"
        / "provenance"
        / f"{provenance_ref.replace(':', '__')}.json",
        {
            "extractionRef": "extraction:test",
            "provenanceRef": provenance_ref,
            "snapshotRef": snapshot_ref,
            "documentId": "LAW-OCR",
            "status": "BLOCKED" if not canonical_extraction_available else "READY",
            "coverageState": "UNAVAILABLE" if not canonical_extraction_available else "SUFFICIENT",
            "canonicalExtractionAvailable": canonical_extraction_available,
            "limitations": [
                {
                    "code": "EXTRACTION_UNAVAILABLE",
                    "affectedScopeRef": snapshot_ref,
                    "reason": "canonical extraction unavailable",
                    "retryable": False,
                }
            ]
            if not canonical_extraction_available
            else [],
            "format": "PDF",
            "pageCount": 0,
            "spanCount": 0,
            "spanManifestPath": "none",
            "spansPath": "none",
            "spanManifestSha256": "sha256:" + "0" * 64,
            "identityCandidate": {
                "documentNumber": "10/2026/NĐ-CP",
                "sourceEffectStatus": "CON_HIEU_LUC",
            },
        },
    )


def test_run_ocr_fallback_blocks_when_proof_missing(tmp_path: Path):
    storage_root = tmp_path / "storage"
    snapshot_path = storage_root / "legal-source-snapshots" / "law.pdf"
    snapshot_path.parent.mkdir(parents=True, exist_ok=True)
    snapshot_path.write_bytes(b"%PDF-1.4")
    manifest_path = snapshot_path.with_name("law.source.json")
    manifest_path.write_text(json.dumps({"documentId": "LAW-OCR"}), encoding="utf-8")

    from lcsp_workers.legal.official_text_extraction import _sha256_bytes

    tool = OcrFallbackTool(
        snapshot_resolver=OfficialSourceSnapshotResolver(
            api_client=SnapshotClient(
                snapshot_ref="snapshot:LAW-OCR:abcd1234ef56",
                document_id="LAW-OCR",
                content_sha256=_sha256_bytes(snapshot_path.read_bytes()),
                content_type="application/pdf",
                snapshot_object_key="legal-source-snapshots/law.pdf",
            ),
            storage_root=storage_root,
        ),
        extraction_repository=OfficialTextExtractionRepository(storage_root=storage_root),
        run_command=lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 0, "", ""),
    )

    result = tool.run(
        OcrFallbackRequest(
            snapshot_ref="snapshot:LAW-OCR:abcd1234ef56",
            fallback_proof_ref="prov:extract:missing",
            page_numbers=[1],
            ocr_profile="VI_OFFICIAL_V1",
            output_dir=tmp_path / "out",
        )
    )

    assert result.status == "BLOCKED"
    assert result.limitations[0]["code"] == "FALLBACK_PROOF_MISSING"


def test_run_ocr_fallback_blocks_when_canonical_extraction_is_available(tmp_path: Path):
    storage_root = tmp_path / "storage"
    snapshot_path = storage_root / "legal-source-snapshots" / "law.pdf"
    snapshot_path.parent.mkdir(parents=True, exist_ok=True)
    snapshot_path.write_bytes(b"%PDF-1.4")
    manifest_path = snapshot_path.with_name("law.source.json")
    manifest_path.write_text(json.dumps({"documentId": "LAW-OCR"}), encoding="utf-8")

    _write_extraction_record(
        storage_root=storage_root,
        provenance_ref="prov:extract:ready",
        snapshot_ref="snapshot:LAW-OCR:abcd1234ef56",
        canonical_extraction_available=True,
    )

    from lcsp_workers.legal.official_text_extraction import _sha256_bytes

    tool = OcrFallbackTool(
        snapshot_resolver=OfficialSourceSnapshotResolver(
            api_client=SnapshotClient(
                snapshot_ref="snapshot:LAW-OCR:abcd1234ef56",
                document_id="LAW-OCR",
                content_sha256=_sha256_bytes(snapshot_path.read_bytes()),
                content_type="application/pdf",
                snapshot_object_key="legal-source-snapshots/law.pdf",
            ),
            storage_root=storage_root,
        ),
        extraction_repository=OfficialTextExtractionRepository(storage_root=storage_root),
        run_command=lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 0, "", ""),
    )

    result = tool.run(
        OcrFallbackRequest(
            snapshot_ref="snapshot:LAW-OCR:abcd1234ef56",
            fallback_proof_ref="prov:extract:ready",
            page_numbers=[1],
            ocr_profile="VI_OFFICIAL_V1",
            output_dir=tmp_path / "out",
        )
    )

    assert result.status == "BLOCKED"
    assert result.limitations[0]["code"] == "CANONICAL_EXTRACTION_SUFFICIENT"


def test_run_ocr_fallback_supports_single_image_and_persists_record(tmp_path: Path, monkeypatch):
    storage_root = tmp_path / "storage"
    artifact_dir = storage_root / "legal-source-snapshots"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    image_path = artifact_dir / "LAW-OCR.source.png"
    image_path.write_bytes(b"png-binary")
    manifest_path = artifact_dir / "LAW-OCR.source.json"
    manifest_path.write_text(json.dumps({"documentId": "LAW-OCR"}), encoding="utf-8")

    _write_extraction_record(
        storage_root=storage_root,
        provenance_ref="prov:extract:blocked",
        snapshot_ref="snapshot:LAW-OCR:abcd1234ef56",
        canonical_extraction_available=False,
    )

    from lcsp_workers.legal.official_text_extraction import _sha256_bytes

    monkeypatch.setattr("shutil.which", lambda _: "/usr/bin/tool")

    def run_command(command, **_kwargs):
        if command[:2] == ["tesseract", str(image_path)] and "vie+eng" in command:
            if command[-1] == "vie+eng":
                return subprocess.CompletedProcess(command, 0, "Điều 1. Nội dung luật", "")
            return subprocess.CompletedProcess(
                command,
                0,
                "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t97\tĐiều\n",
                "",
            )
        raise AssertionError(command)

    tool = OcrFallbackTool(
        snapshot_resolver=OfficialSourceSnapshotResolver(
            api_client=SnapshotClient(
                snapshot_ref="snapshot:LAW-OCR:abcd1234ef56",
                document_id="LAW-OCR",
                content_sha256=_sha256_bytes(image_path.read_bytes()),
                content_type="image/png",
                snapshot_object_key="legal-source-snapshots/LAW-OCR.source.png",
            ),
            storage_root=storage_root,
        ),
        extraction_repository=OfficialTextExtractionRepository(storage_root=storage_root),
        run_command=run_command,
    )

    result = tool.run(
        OcrFallbackRequest(
            snapshot_ref="snapshot:LAW-OCR:abcd1234ef56",
            fallback_proof_ref="prov:extract:blocked",
            page_numbers=[1],
            ocr_profile="VI_OFFICIAL_V1",
            output_dir=tmp_path / "out",
        )
    )
    repository = OcrFallbackRepository(storage_root=storage_root)
    repository.save(result.to_record())
    loaded = repository.get_by_provenance_ref(result.provenance_ref)
    payload = result.to_tool_response(correlationId="corr-ocr")

    assert result.status == "READY"
    assert loaded is not None
    assert loaded.snapshot_ref == "snapshot:LAW-OCR:abcd1234ef56"
    assert payload["result"]["pages"][0]["page"] == 1
    serialized = json.dumps(payload, ensure_ascii=False)
    assert "Điều 1. Nội dung luật" not in serialized
    assert payload["limitations"][0]["code"] == "OCR_REQUIRED"


def test_run_ocr_fallback_returns_needs_input_for_missing_image_page(tmp_path: Path, monkeypatch):
    storage_root = tmp_path / "storage"
    artifact_dir = storage_root / "legal-source-snapshots"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    image_path = artifact_dir / "LAW-OCR.source.png"
    image_path.write_bytes(b"png-binary")
    manifest_path = artifact_dir / "LAW-OCR.source.json"
    manifest_path.write_text(json.dumps({"documentId": "LAW-OCR"}), encoding="utf-8")

    _write_extraction_record(
        storage_root=storage_root,
        provenance_ref="prov:extract:blocked",
        snapshot_ref="snapshot:LAW-OCR:abcd1234ef56",
        canonical_extraction_available=False,
    )

    from lcsp_workers.legal.official_text_extraction import _sha256_bytes

    monkeypatch.setattr("shutil.which", lambda _: "/usr/bin/tool")

    tool = OcrFallbackTool(
        snapshot_resolver=OfficialSourceSnapshotResolver(
            api_client=SnapshotClient(
                snapshot_ref="snapshot:LAW-OCR:abcd1234ef56",
                document_id="LAW-OCR",
                content_sha256=_sha256_bytes(image_path.read_bytes()),
                content_type="image/png",
                snapshot_object_key="legal-source-snapshots/LAW-OCR.source.png",
            ),
            storage_root=storage_root,
        ),
        extraction_repository=OfficialTextExtractionRepository(storage_root=storage_root),
        run_command=lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 0, "", ""),
    )

    result = tool.run(
        OcrFallbackRequest(
            snapshot_ref="snapshot:LAW-OCR:abcd1234ef56",
            fallback_proof_ref="prov:extract:blocked",
            page_numbers=[2],
            ocr_profile="VI_OFFICIAL_V1",
            output_dir=tmp_path / "out",
        )
    )

    assert result.status == "NEEDS_INPUT"
    assert result.limitations[0]["code"] == "MISSING_PAGE"
    assert result.snapshot_ref == "snapshot:LAW-OCR:abcd1234ef56"
    assert result.fallback_proof_ref == "prov:extract:blocked"


def test_run_ocr_fallback_supports_selected_pdf_pages_in_order(tmp_path: Path, monkeypatch):
    storage_root = tmp_path / "storage"
    artifact_dir = storage_root / "legal-source-snapshots"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = artifact_dir / "LAW-OCR.source.pdf"
    pdf_path.write_bytes(b"%PDF-1.4")
    (artifact_dir / "LAW-OCR.source.json").write_text(
        json.dumps({"documentId": "LAW-OCR"}),
        encoding="utf-8",
    )

    _write_extraction_record(
        storage_root=storage_root,
        provenance_ref="prov:extract:blocked-pdf",
        snapshot_ref="snapshot:LAW-OCR:pdfabcd1234",
        canonical_extraction_available=False,
    )

    from lcsp_workers.legal.official_text_extraction import _sha256_bytes

    monkeypatch.setattr("shutil.which", lambda _: "/usr/bin/tool")

    def run_command(command, **_kwargs):
        if command[0] == "pdftoppm":
            page_number = int(command[3])
            prefix = Path(command[-1])
            image_path = prefix.parent / f"{prefix.name}-1.png"
            image_path.write_bytes(f"page-{page_number}".encode("utf-8"))
            return subprocess.CompletedProcess(command, 0, "", "")
        if command[0] == "tesseract" and "vie+eng" in command:
            image_name = Path(command[1]).name
            if command[-1] == "vie+eng":
                return subprocess.CompletedProcess(
                    command, 0, f"Nội dung {image_name}", ""
                )
            return subprocess.CompletedProcess(
                command,
                0,
                "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t95\tNội dung\n",
                "",
            )
        raise AssertionError(command)

    tool = OcrFallbackTool(
        snapshot_resolver=OfficialSourceSnapshotResolver(
            api_client=SnapshotClient(
                snapshot_ref="snapshot:LAW-OCR:pdfabcd1234",
                document_id="LAW-OCR",
                content_sha256=_sha256_bytes(pdf_path.read_bytes()),
                content_type="application/pdf",
                snapshot_object_key="legal-source-snapshots/LAW-OCR.source.pdf",
            ),
            storage_root=storage_root,
        ),
        extraction_repository=OfficialTextExtractionRepository(storage_root=storage_root),
        run_command=run_command,
    )

    result = tool.run(
        OcrFallbackRequest(
            snapshot_ref="snapshot:LAW-OCR:pdfabcd1234",
            fallback_proof_ref="prov:extract:blocked-pdf",
            page_numbers=[2, 1],
            ocr_profile="VI_OFFICIAL_V1",
            output_dir=tmp_path / "out",
        )
    )

    assert result.status == "READY"
    assert [page.page for page in result.pages] == [2, 1]
    assert result.pages[0].span_manifest_ref.endswith(":2")
    assert result.pages[1].span_manifest_ref.endswith(":1")


def test_run_ocr_fallback_returns_failed_when_ocr_times_out(tmp_path: Path, monkeypatch):
    storage_root = tmp_path / "storage"
    artifact_dir = storage_root / "legal-source-snapshots"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    image_path = artifact_dir / "LAW-OCR.source.png"
    image_path.write_bytes(b"png-binary")
    (artifact_dir / "LAW-OCR.source.json").write_text(
        json.dumps({"documentId": "LAW-OCR"}),
        encoding="utf-8",
    )

    _write_extraction_record(
        storage_root=storage_root,
        provenance_ref="prov:extract:timeout",
        snapshot_ref="snapshot:LAW-OCR:timeout1234",
        canonical_extraction_available=False,
    )

    from lcsp_workers.legal.official_text_extraction import _sha256_bytes

    monkeypatch.setattr("shutil.which", lambda _: "/usr/bin/tool")

    def run_command(command, **_kwargs):
        raise subprocess.TimeoutExpired(command, timeout=90)

    tool = OcrFallbackTool(
        snapshot_resolver=OfficialSourceSnapshotResolver(
            api_client=SnapshotClient(
                snapshot_ref="snapshot:LAW-OCR:timeout1234",
                document_id="LAW-OCR",
                content_sha256=_sha256_bytes(image_path.read_bytes()),
                content_type="image/png",
                snapshot_object_key="legal-source-snapshots/LAW-OCR.source.png",
            ),
            storage_root=storage_root,
        ),
        extraction_repository=OfficialTextExtractionRepository(storage_root=storage_root),
        run_command=run_command,
    )

    result = tool.run(
        OcrFallbackRequest(
            snapshot_ref="snapshot:LAW-OCR:timeout1234",
            fallback_proof_ref="prov:extract:timeout",
            page_numbers=[1],
            ocr_profile="VI_OFFICIAL_V1",
            output_dir=tmp_path / "out",
        )
    )

    assert result.status == "FAILED"
    assert result.limitations[0]["code"] == "OCR_TIMEOUT"
    assert result.snapshot_ref == "snapshot:LAW-OCR:timeout1234"

def test_ocr_fallback_repository_allows_idempotent_replay_and_rejects_conflict(
    tmp_path: Path,
):
    repository = OcrFallbackRepository(storage_root=tmp_path / "storage")
    record = OcrFallbackRecord(
        ocr_ref="ocr:LAW-OCR-abc",
        provenance_ref="prov:ocr:LAW-OCR-abc",
        snapshot_ref="snapshot:LAW-OCR:abcd1234",
        fallback_proof_ref="prov:extract:LAW-OCR-proof",
        status="READY",
        coverage_state="PARTIAL",
        limitations=[
            {
                "code": "OCR_REQUIRED",
                "affectedScopeRef": "snapshot:LAW-OCR:abcd1234",
                "reason": "CANONICAL_EXTRACTION_UNAVAILABLE",
                "retryable": False,
            }
        ],
        profile="VI_OFFICIAL_V1",
        page_numbers=[1],
        evidence_refs=["ocr-page:LAW-OCR-abc:1"],
        pages=[
            {
                "page": 1,
                "pageImageSha256": "sha256:" + "1" * 64,
                "spanManifestRef": "ocr-span-manifest:LAW-OCR-abc:1",
                "meanConfidence": 0.97,
            }
        ],
    )

    saved_once = repository.save(record)
    saved_twice = repository.save(record)
    loaded = repository.get_by_ocr_ref(record.ocr_ref)

    assert saved_once == record
    assert saved_twice == record
    assert loaded is not None
    assert loaded.provenance_ref == record.provenance_ref

    conflicting_record = OcrFallbackRecord(
        ocr_ref=record.ocr_ref,
        provenance_ref=record.provenance_ref,
        snapshot_ref=record.snapshot_ref,
        fallback_proof_ref=record.fallback_proof_ref,
        status=record.status,
        coverage_state=record.coverage_state,
        limitations=record.limitations,
        profile=record.profile,
        page_numbers=record.page_numbers,
        evidence_refs=record.evidence_refs,
        pages=[
            {
                "page": 1,
                "pageImageSha256": "sha256:" + "2" * 64,
                "spanManifestRef": "ocr-span-manifest:LAW-OCR-abc:1",
                "meanConfidence": 0.97,
            }
        ],
    )

    with pytest.raises(OcrFallbackConflictError, match="OCR fallback record conflict"):
        repository.save(conflicting_record)
