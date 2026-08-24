import importlib.util
import io
import json
import sys
import zipfile
from pathlib import Path

import pytest


module_path = (
    Path(__file__).parents[1]
    / "runtime"
    / "legal"
    / "sources"
    / "extraction"
    / "official_text_extraction.py"
)
spec = importlib.util.spec_from_file_location("official_text_extraction", module_path)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

OfficialTextExtractor = module.OfficialTextExtractor
OfficialTextExtractionRequest = module.OfficialTextExtractionRequest
OfficialSourceSnapshotResolver = module.OfficialSourceSnapshotResolver


def _docx_fixture() -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr(
            "word/document.xml",
            """<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
            <w:p><w:r><w:t>Điều 1. Phạm vi</w:t></w:r></w:p>
            <w:p><w:r><w:t>1. Nội dung</w:t></w:r></w:p>
            <w:p><w:r><w:t>a) Chi tiết</w:t></w:r></w:p>
            </w:body></w:document>""",
        )
    return output.getvalue()


def test_extracts_html_snapshot_into_deterministic_spans(tmp_path: Path):
    html_path = tmp_path / "LAW-TEST.source.html"
    html_path.write_text(
        """
        <html><body>
          <h1>Điều 1. Phạm vi điều chỉnh</h1>
          <p>1. Nội dung theo Điều 2.</p>
          <p>a) Chi tiết.</p>
        </body></html>
        """,
        encoding="utf-8",
    )
    manifest_path = tmp_path / "LAW-TEST.source.json"
    manifest_path.write_text(
        json.dumps(
            {
                "documentId": "LAW-TEST",
                "documentNumber": "13/2023/NĐ-CP",
                "sourceEffectStatus": "Còn hiệu lực",
                "effectiveFrom": "2026-01-01",
                "htmlFile": html_path.name,
            }
        ),
        encoding="utf-8",
    )

    result = OfficialTextExtractor().extract(
        OfficialTextExtractionRequest(
            snapshot_ref="snapshot:LAW-TEST:abcd1234ef56",
            extractor_profile="HTML_OFFICIAL_V1",
            max_pages=10,
            source_manifest_path=manifest_path,
            output_dir=tmp_path / "out",
        )
    )

    assert result.format == "HTML"
    assert result.status == "READY"
    assert result.coverage_state == "SUFFICIENT"
    assert result.page_count == 1
    assert result.span_count == 3
    assert result.identity_candidate["documentNumber"] == "13/2023/NĐ-CP"
    assert result.identity_candidate["sourceEffectStatus"] == "CON_HIEU_LUC"
    manifest = json.loads(result.span_manifest_path.read_text(encoding="utf-8"))
    spans = json.loads(result.spans_path.read_text(encoding="utf-8"))
    assert manifest["spanCount"] == 3
    assert spans[0]["spanRef"].startswith("span:")
    assert spans[0]["text"] == "Điều 1. Phạm vi điều chỉnh"
    response = result.to_tool_response(correlationId="corr-1")
    assert response["toolName"] == "extract_official_text"
    assert response["result"]["canonicalExtractionAvailable"] is True
    serialized = json.dumps(response, ensure_ascii=False)
    assert "Điều 1. Phạm vi điều chỉnh" not in serialized
    assert "1. Nội dung theo Điều 2." not in serialized


def test_extracts_docx_snapshot_into_deterministic_spans(tmp_path: Path):
    docx_path = tmp_path / "LAW-DOCX.source.docx"
    docx_path.write_bytes(_docx_fixture())
    manifest_path = tmp_path / "LAW-DOCX.source.json"
    manifest_path.write_text(
        json.dumps(
            {
                "documentId": "LAW-DOCX",
                "documentNumber": "134/2025/QH15",
                "sourceEffectStatus": "Hết hiệu lực một phần",
                "sourceFile": docx_path.name,
            }
        ),
        encoding="utf-8",
    )

    result = OfficialTextExtractor().extract(
        OfficialTextExtractionRequest(
            snapshot_ref="snapshot:LAW-DOCX:abcd1234ef56",
            extractor_profile="DOCX_OFFICIAL_V1",
            max_pages=10,
            source_manifest_path=manifest_path,
            output_dir=tmp_path / "out",
        )
    )

    assert result.format == "DOCX"
    assert result.status == "READY"
    assert result.span_count == 3
    assert result.identity_candidate["sourceEffectStatus"] == "HET_HIEU_LUC_MOT_PHAN"
    spans = json.loads(result.spans_path.read_text(encoding="utf-8"))
    assert spans[2]["text"] == "a) Chi tiết"
    assert result.evidence_refs[0].endswith(":p1:s01")


def test_resolves_snapshot_ref_from_registry_and_storage(tmp_path: Path):
    storage_root = tmp_path / "storage"
    artifact_dir = (
        storage_root
        / "legal-source-snapshots"
        / "catalog_vbpl_vn"
        / "LAW-TEST"
        / "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    )
    artifact_dir.mkdir(parents=True, exist_ok=True)
    html_path = artifact_dir / "LAW-TEST.source.html"
    html_path.write_text(
        "<html><body><h1>Điều 1. Phạm vi điều chỉnh</h1><p>1. Nội dung.</p></body></html>",
        encoding="utf-8",
    )
    manifest_path = artifact_dir / "LAW-TEST.source.json"
    manifest_path.write_text(
        json.dumps(
            {
                "documentId": "LAW-TEST",
                "documentNumber": "13/2023/NĐ-CP",
                "sourceEffectStatus": "Còn hiệu lực",
                "htmlFile": html_path.name,
            }
        ),
        encoding="utf-8",
    )
    artifact_sha = module._sha256_bytes(html_path.read_bytes())

    class RecordingSnapshotClient:
        def get_official_source_snapshot(
            self, *, snapshot_ref: str | None = None, snapshot_id: str | None = None
        ) -> dict:
            assert snapshot_ref == "snapshot:LAW-TEST:abcd1234ef56"
            return {
                "snapshotRef": "snapshot:LAW-TEST:abcd1234ef56",
                "documentId": "LAW-TEST",
                "contentSha256": artifact_sha,
                "contentType": "text/html",
                "snapshotObjectKey": "legal-source-snapshots/catalog_vbpl_vn/LAW-TEST/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/LAW-TEST.source.html",
            }

    resolver = OfficialSourceSnapshotResolver(
        api_client=RecordingSnapshotClient(),
        storage_root=storage_root,
    )
    resolved = resolver.resolve(snapshot_ref="snapshot:LAW-TEST:abcd1234ef56")

    assert resolved.artifact_path == html_path.resolve()
    assert resolved.source_manifest_path == manifest_path.resolve()

    result = OfficialTextExtractor().extract_from_resolved_snapshot(
        resolved_snapshot=resolved,
        extractor_profile="HTML_OFFICIAL_V1",
        max_pages=10,
        output_dir=tmp_path / "out",
    )

    assert result.snapshot_ref == "snapshot:LAW-TEST:abcd1234ef56"
    assert result.span_count == 2


def test_missing_identity_returns_needs_input_with_limitation(tmp_path: Path):
    html_path = tmp_path / "LAW-MISSING.source.html"
    html_path.write_text(
        "<html><body><h1>Điều 1. Phạm vi điều chỉnh</h1></body></html>",
        encoding="utf-8",
    )
    manifest_path = tmp_path / "LAW-MISSING.source.json"
    manifest_path.write_text(
        json.dumps(
            {
                "documentId": "LAW-MISSING",
                "htmlFile": html_path.name,
            }
        ),
        encoding="utf-8",
    )

    result = OfficialTextExtractor().extract(
        OfficialTextExtractionRequest(
            snapshot_ref="snapshot:LAW-MISSING:abcd1234ef56",
            extractor_profile="HTML_OFFICIAL_V1",
            max_pages=10,
            source_manifest_path=manifest_path,
            output_dir=tmp_path / "out",
        )
    )

    response = result.to_tool_response(correlationId="corr-missing")
    assert result.status == "NEEDS_INPUT"
    assert result.coverage_state == "PARTIAL"
    assert response["status"] == "NEEDS_INPUT"
    assert response["coverageState"] == "PARTIAL"
    assert response["limitations"][0]["code"] == "IDENTITY_MISSING"
    assert "documentNumber" in response["limitations"][0]["reason"]
    assert "sourceEffectStatus" in response["limitations"][0]["reason"]


def test_empty_canonical_extraction_returns_blocked_limitation(tmp_path: Path):
    html_path = tmp_path / "LAW-EMPTY.source.html"
    html_path.write_text("<html><body></body></html>", encoding="utf-8")
    manifest_path = tmp_path / "LAW-EMPTY.source.json"
    manifest_path.write_text(
        json.dumps(
            {
                "documentId": "LAW-EMPTY",
                "documentNumber": "12/2026/NĐ-CP",
                "sourceEffectStatus": "Còn hiệu lực",
                "htmlFile": html_path.name,
            }
        ),
        encoding="utf-8",
    )

    result = OfficialTextExtractor().extract(
        OfficialTextExtractionRequest(
            snapshot_ref="snapshot:LAW-EMPTY:abcd1234ef56",
            extractor_profile="HTML_OFFICIAL_V1",
            max_pages=10,
            source_manifest_path=manifest_path,
            output_dir=tmp_path / "out",
        )
    )

    response = result.to_tool_response(correlationId="corr-empty")
    manifest = json.loads(result.span_manifest_path.read_text(encoding="utf-8"))
    spans = json.loads(result.spans_path.read_text(encoding="utf-8"))
    assert result.status == "BLOCKED"
    assert result.coverage_state == "UNAVAILABLE"
    assert result.canonical_extraction_available is False
    assert result.span_count == 0
    assert response["limitations"][0]["code"] == "EXTRACTION_UNAVAILABLE"
    assert response["result"]["canonicalExtractionAvailable"] is False
    assert spans == []
    assert manifest["spanCount"] == 0
    assert manifest["canonicalExtractionAvailable"] is False


def test_resolved_snapshot_content_type_must_match_profile(tmp_path: Path):
    storage_root = tmp_path / "storage"
    artifact_dir = (
        storage_root
        / "legal-source-snapshots"
        / "catalog_cong_bao"
        / "LAW-TYPE"
        / "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    )
    artifact_dir.mkdir(parents=True, exist_ok=True)
    docx_path = artifact_dir / "LAW-TYPE.source.docx"
    docx_path.write_bytes(_docx_fixture())
    manifest_path = artifact_dir / "LAW-TYPE.source.json"
    manifest_path.write_text(
        json.dumps(
            {
                "documentId": "LAW-TYPE",
                "documentNumber": "99/2026/NĐ-CP",
                "sourceEffectStatus": "Còn hiệu lực",
                "sourceFile": docx_path.name,
            }
        ),
        encoding="utf-8",
    )
    artifact_sha = module._sha256_bytes(docx_path.read_bytes())

    class RecordingSnapshotClient:
        def get_official_source_snapshot(
            self, *, snapshot_ref: str | None = None, snapshot_id: str | None = None
        ) -> dict:
            return {
                "snapshotRef": "snapshot:LAW-TYPE:abcd1234ef56",
                "documentId": "LAW-TYPE",
                "contentSha256": artifact_sha,
                "contentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "snapshotObjectKey": "legal-source-snapshots/catalog_cong_bao/LAW-TYPE/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/LAW-TYPE.source.docx",
            }

    resolver = OfficialSourceSnapshotResolver(
        api_client=RecordingSnapshotClient(),
        storage_root=storage_root,
    )
    resolved = resolver.resolve(snapshot_ref="snapshot:LAW-TYPE:abcd1234ef56")

    with pytest.raises(
        ValueError, match="resolved snapshot content type does not match extractor profile"
    ):
        OfficialTextExtractor().extract_from_resolved_snapshot(
            resolved_snapshot=resolved,
            extractor_profile="HTML_OFFICIAL_V1",
            max_pages=10,
            output_dir=tmp_path / "out",
        )
