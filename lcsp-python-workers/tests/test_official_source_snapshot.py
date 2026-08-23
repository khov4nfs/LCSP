from pathlib import Path

import pytest

from lcsp_workers.legal.official_source_snapshot import (
    OfficialSourceSnapshotFetcher,
    OfficialSourceSnapshotRequest,
)


class VbplResponse:
    headers = {"Content-Type": "application/json; charset=utf-8"}

    def raise_for_status(self):
        return None

    def iter_content(self, chunk_size):
        yield (
            b'{"data":{"docNum":"71/2025/QH15","title":"Lu\\u1eadt m\\u1eabu","effFrom":"2026-01-01",'
            b'"effStatus":{"name":"C\\u00f2n hi\\u1ec7u l\\u1ef1c"},'
            b'"documentContent":{"content":"<h1>\\u0110i\\u1ec1u 1</h1><p>N\\u1ed9i dung lu\\u1eadt</p>"}}}'
        )


class VbplSession:
    def get(self, url, **kwargs):
        assert url.endswith("/123")
        assert kwargs["allow_redirects"] is False
        return VbplResponse()


class CongBaoResponse:
    def __init__(self, content: bytes, content_type: str):
        self._content = content
        self.headers = {"Content-Type": content_type}

    def raise_for_status(self):
        return None

    def iter_content(self, chunk_size):
        yield self._content


def docx_fixture() -> bytes:
    import io
    import zipfile

    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr(
            "word/document.xml",
            """<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
            <w:p><w:r><w:t>Điều 1. Phạm vi</w:t></w:r></w:p>
            <w:p><w:r><w:t>1. Nội dung</w:t></w:r></w:p>
            </w:body></w:document>""",
        )
    return output.getvalue()


class CongBaoSession:
    def get(self, url, **kwargs):
        assert kwargs["allow_redirects"] is False
        if "congbao.chinhphu.vn" in url:
            return CongBaoResponse(
                '<title>Luật số 134/2025/QH15</title><a href="https://g7.cdnchinhphu.vn/document.docx">download</a>'.encode(),
                "text/html",
            )
        return CongBaoResponse(docx_fixture(), "application/octet-stream")


class RecordingApiClient:
    def __init__(self):
        self.payloads: list[dict] = []

    def register_official_source_snapshot(self, payload: dict) -> dict:
        self.payloads.append(payload)
        return {"snapshotRef": payload["snapshotRef"]}


def test_fetcher_routes_vbpl_and_returns_snapshot_metadata(tmp_path: Path):
    fetcher = OfficialSourceSnapshotFetcher(vbpl_session=VbplSession())

    result = fetcher.fetch(
        OfficialSourceSnapshotRequest(
            document_id="LAW-71-2025-QH15",
            catalog_source_ref="catalog-source:vbpl.vn:law:71-2025-qh15",
            source_url="https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=179989",
            output_dir=tmp_path,
            gateway_document_id="123",
            max_bytes=1024 * 1024,
            expected_document_number="71/2025/QH15",
        )
    )

    assert result.content_type == "text/html"
    assert result.snapshot_path.name.endswith(".source.html")
    assert result.content_sha256.startswith("sha256:")
    assert result.snapshot_object_key.startswith(
        "legal-source-snapshots/catalog_vbpl_vn/LAW-71-2025-QH15/"
    )
    assert result.snapshot_path == tmp_path / result.snapshot_object_key
    assert result.snapshot_path.is_file()
    assert result.snapshot_ref.startswith("snapshot:LAW-71-2025-QH15:")
    assert result.provenance_ref.startswith("prov:fetch:LAW-71-2025-QH15:")
    assert result.source_url == "https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=179989"
    assert result.final_url == "https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=179989"
    assert result.document_number == "71/2025/QH15"
    assert result.source_effect_status == "Còn hiệu lực"
    assert result.normalization_source == "VBPL_GATEWAY_JSON"
    tool_response = result.to_tool_response(
        correlationId="corr-1",
        admin_catalog_version="catalog_v2026_08",
        catalog_source_ref="catalog-source:vbpl.vn:law:71-2025-qh15",
        expected_document_number="71/2025/QH15",
    )
    assert tool_response["toolName"] == "fetch_official_source_snapshot"
    assert tool_response["result"]["snapshotRef"] == result.snapshot_ref
    assert tool_response["result"]["snapshotObjectKey"] == result.snapshot_object_key
    assert tool_response["result"]["documentIdentityVerified"] is True


def test_fetcher_routes_congbao_and_returns_docx_snapshot(tmp_path: Path):
    fetcher = OfficialSourceSnapshotFetcher(congbao_session=CongBaoSession())

    result = fetcher.fetch(
        OfficialSourceSnapshotRequest(
            document_id="LAW-134-2025-QH15",
            catalog_source_ref="catalog-source:vanban.chinhphu.vn:law:134-2025-qh15",
            source_url="https://congbao.chinhphu.vn/van-ban/luat-so-134-2025-qh15-468694.htm",
            output_dir=tmp_path,
            source_effect_status="Còn hiệu lực",
            max_bytes=2 * 1024 * 1024,
        )
    )

    assert result.content_type == (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    assert result.snapshot_path.suffix == ".docx"
    assert result.source_url.startswith("https://congbao.chinhphu.vn/")
    assert result.final_url == "https://g7.cdnchinhphu.vn/document.docx"
    assert result.normalization_source == "OFFICIAL_DOCX"
    assert result.snapshot_object_key.startswith(
        "legal-source-snapshots/catalog_vanban_chinhphu_vn/LAW-134-2025-QH15/"
    )
    assert result.snapshot_path == tmp_path / result.snapshot_object_key
    assert result.snapshot_path.is_file()


def test_result_registers_snapshot_with_api_client(tmp_path: Path):
    fetcher = OfficialSourceSnapshotFetcher(vbpl_session=VbplSession())
    api_client = RecordingApiClient()

    result = fetcher.fetch(
        OfficialSourceSnapshotRequest(
            document_id="LAW-71-2025-QH15",
            catalog_source_ref="catalog-source:vbpl.vn:law:71-2025-qh15",
            source_url="https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=179989",
            output_dir=tmp_path,
            gateway_document_id="123",
            max_bytes=1024 * 1024,
            expected_document_number="71/2025/QH15",
        )
    )

    response = result.register_with_api(
        api_client=api_client,
        admin_catalog_version="catalog_v2026_08",
        catalog_source_ref="catalog-source:vbpl.vn:law:71-2025-qh15",
        expected_document_number="71/2025/QH15",
    )

    assert response == {"snapshotRef": result.snapshot_ref}
    assert api_client.payloads == [
        {
            "snapshotRef": result.snapshot_ref,
            "catalogSourceRef": "catalog-source:vbpl.vn:law:71-2025-qh15",
            "adminCatalogVersion": "catalog_v2026_08",
            "documentId": "LAW-71-2025-QH15",
            "documentNumber": "71/2025/QH15",
            "sourceUrl": "https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=179989",
            "finalUrl": "https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=179989",
            "contentType": "text/html",
            "byteLength": result.byte_length,
            "contentSha256": result.content_sha256,
            "snapshotObjectKey": result.snapshot_object_key,
            "provenanceRef": result.provenance_ref,
            "retrievedAt": result.retrieved_at,
            "sourceEffectStatus": "Còn hiệu lực",
            "normalizationSource": "VBPL_GATEWAY_JSON",
            "documentIdentityVerified": True,
        }
    ]


def test_fetcher_rejects_source_url_host_mismatch(tmp_path: Path):
    fetcher = OfficialSourceSnapshotFetcher(vbpl_session=VbplSession())

    with pytest.raises(ValueError, match="catalog-authorized official source"):
        fetcher.fetch(
            OfficialSourceSnapshotRequest(
                document_id="LAW-TEST",
                catalog_source_ref="catalog-source:vbpl.vn:law:test",
                source_url="https://example.test/law",
                output_dir=tmp_path,
                gateway_document_id="123",
                max_bytes=1024,
            )
        )


def test_fetcher_requires_vbpl_gateway_document_id(tmp_path: Path):
    fetcher = OfficialSourceSnapshotFetcher(vbpl_session=VbplSession())

    with pytest.raises(ValueError, match="gateway_document_id"):
        fetcher.fetch(
            OfficialSourceSnapshotRequest(
                document_id="LAW-TEST",
                catalog_source_ref="catalog-source:vbpl.vn:law:test",
                source_url="https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=179989",
                output_dir=tmp_path,
                max_bytes=1024,
            )
        )


def test_fetcher_rejects_unsupported_catalog_source(tmp_path: Path):
    fetcher = OfficialSourceSnapshotFetcher(vbpl_session=VbplSession())

    with pytest.raises(ValueError, match="unsupported"):
        fetcher.fetch(
            OfficialSourceSnapshotRequest(
                document_id="LAW-TEST",
                catalog_source_ref="catalog-source:example.test:law:test",
                source_url="https://example.test/law",
                output_dir=tmp_path,
                max_bytes=1024,
            )
        )


def test_fetcher_enforces_bounded_response_size(tmp_path: Path):
    fetcher = OfficialSourceSnapshotFetcher(vbpl_session=VbplSession())

    with pytest.raises(RuntimeError, match="size limit"):
        fetcher.fetch(
            OfficialSourceSnapshotRequest(
                document_id="LAW-71-2025-QH15",
                catalog_source_ref="catalog-source:vbpl.vn:law:71-2025-qh15",
                source_url="https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=179989",
                output_dir=tmp_path,
                gateway_document_id="123",
                max_bytes=64,
            )
        )
