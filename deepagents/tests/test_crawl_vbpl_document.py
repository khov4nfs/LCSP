import importlib.util
import json
import sys
from pathlib import Path

import pytest


script_path = (
    Path(__file__).parents[1]
    / "runtime"
    / "legal"
    / "sources"
    / "scripts"
    / "crawl_vbpl_document.py"
)
spec = importlib.util.spec_from_file_location("crawl_vbpl_document", script_path)
assert spec and spec.loader
crawl_module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = crawl_module
spec.loader.exec_module(crawl_module)
VbplDocumentCrawler = crawl_module.VbplDocumentCrawler


class Response:
    headers = {"Content-Type": "application/json; charset=utf-8"}

    def raise_for_status(self):
        return None

    def iter_content(self, chunk_size):
        yield json.dumps(
            {
                "data": {
                    "docNum": "71/2025/QH15",
                    "title": "Luật mẫu",
                    "effFrom": "2026-01-01",
                    "effStatus": {"name": "Còn hiệu lực"},
                    "documentContent": {"content": "<h1>Điều 1</h1><p>Nội dung luật</p>"},
                }
            }
        ).encode()


class Session:
    def get(self, url, **kwargs):
        assert url.endswith("/123")
        assert kwargs["allow_redirects"] is False
        return Response()


def test_crawler_writes_html_text_and_manifest(tmp_path: Path):
    manifest_path = VbplDocumentCrawler(Session()).create_snapshot(
        document_id="LAW-71-2025-QH15",
        gateway_document_id="123",
        source_url="https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=179989",
        output_dir=tmp_path,
    )

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["sourceEffectStatus"] == "Còn hiệu lực"
    assert manifest["normalizationSource"] == "VBPL_GATEWAY_JSON"
    assert (tmp_path / manifest["snapshotFile"]).read_text(encoding="utf-8")
    assert (tmp_path / "LAW-71-2025-QH15.source.html").read_text(encoding="utf-8")
    assert (tmp_path / "LAW-71-2025-QH15.source.txt").read_text(encoding="utf-8") == "Điều 1\nNội dung luật\n"


def test_crawler_rejects_non_vbpl_source_url(tmp_path: Path):
    with pytest.raises(ValueError, match="vbpl.vn"):
        VbplDocumentCrawler(Session()).create_snapshot(
            document_id="LAW-TEST",
            gateway_document_id="123",
            source_url="https://example.test/law",
            output_dir=tmp_path,
        )
